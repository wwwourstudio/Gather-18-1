// gather — camera and microphone processing, all in the browser.
// Video: light correction, broadcast-grade AI background blur / replacement (3-channel RGB color guided filter,
//        hair-aware matte choke, per-pixel motion-adaptive temporal stabilization, foreground color decontamination /
//        halo unmixing, and subtle ambient light wrap) and chroma-key green screen, composited in WebGL2.
// Audio: AI noise removal (RNNoise) and input gain, sent as an ordinary audio track.

// ------------------------------------------------------------------ audio
let rnMod = null, rnWasm = null;
const rnReady = new WeakSet();
async function rnnoiseNode(ctx) {
  if (ctx.sampleRate !== 48000) throw new Error('AI noise removal needs 48 kHz audio.');
  rnMod ||= import('/vendor/noise/index.js');
  const m = await rnMod;
  rnWasm ||= m.loadRnnoise({ url: '/vendor/noise/rnnoise.wasm', simdUrl: '/vendor/noise/rnnoise_simd.wasm' });
  const wasmBinary = await rnWasm;
  if (!rnReady.has(ctx)) { await ctx.audioWorklet.addModule('/vendor/noise/rnnoise/workletProcessor.js'); rnReady.add(ctx); }
  return new m.RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
}

/** mic track → [RNNoise] → gain → new track. The raw track's `enabled` still mutes everything. */
export async function createAudioChain(ctx, rawTrack, { aiNoise = false, gain = 1 } = {}) {
  const src = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
  const g = ctx.createGain(); g.gain.value = gain;
  const dest = ctx.createMediaStreamDestination();
  let rn = null, note = '';
  if (aiNoise) {
    try { rn = await rnnoiseNode(ctx); src.connect(rn); rn.connect(g); }
    catch (e) { note = e.message; src.connect(g); }
  } else src.connect(g);
  g.connect(dest);
  return {
    track: dest.stream.getAudioTracks()[0], note, ai: !!rn,
    setGain(v) { g.gain.value = v; },
    dispose() { try { src.disconnect(); rn?.disconnect(); g.disconnect(); } catch {} try { rn?.destroy(); } catch {} },
  };
}

// ------------------------------------------------------------------ video
// Broadcast-grade multi-pass WebGL2 matting pipeline:
//   1. mask      Per-pixel motion-adaptive temporal stabilization on BOTH person (R) and hair (G) confidence masks.
//                Static background/edges lock rock-solid (zero shimmer); moving hands/shoulders update in 1 frame.
//   2. rgb-gf    Full 3-channel RGB Color Guided Filter (He, Sun & Tang 2013) solving the 3×3 RGB covariance system
//                analytically per pixel. Separates hair, glasses, skin, and dark clothes from identically-bright walls.
//   3. matte     Full-resolution hair-aware matte refinement: crisp inward edge choke on clothes/shoulders (eliminating
//                lumpy wall blobs), gentle strand-preserving ramp on hair, plus local color-edge snapping.
//   4. pre/blur  Premultiplied quarter-res background Gaussian blur (person strictly weighted out → zero blur halo).
//   5. final     Dual-ring foreground color decontamination (estimates pure interior F & exterior B_orig to mathematically
//                unmix room-wall fringe from semi-transparent edge pixels), sub-pixel edge anti-aliasing, subtle ambient
//                light wrap, chroma-key mode, and light correction.
const VS = `#version 300 es
in vec2 p; out vec2 uv; out vec2 st;
// uv samples uploaded images (row 0 at the top); st samples textures this pipeline rendered itself.
void main() { st = (p + 1.0) * 0.5; uv = vec2(st.x, 1.0 - st.y); gl_Position = vec4(p, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float;
in vec2 uv; in vec2 st; out vec4 o;
`;

// Copy current frame into an FBO so the next frame can measure per-pixel RGB motion.
const COPY_FRAME_FS = HEAD + `
uniform sampler2D uFrame;
void main() { o = vec4(texture(uFrame, uv).rgb, 1.0); }`;

// Pass 1: Per-pixel motion-adaptive temporal filter for [person, hair] masks.
const MASK_FS = HEAD + `
uniform sampler2D uRaw, uPrev, uFrame, uPrevFrame;
uniform int uCh, uHasHair, uHasPrevFrame;
uniform float uFirst, uMotion;
void main() {
  vec4 r = texture(uRaw, uv);
  float raw = uCh == 3 ? r.a : r.r;
  float rawHair = uHasHair == 1 ? r.g : 0.0;
  vec2 prev = texture(uPrev, st).rg;
  // Measure local RGB change right at this pixel so moving limbs snap instantly while static edges stay silky still.
  float pixMotion = 0.0;
  if (uHasPrevFrame == 1) {
    vec3 curC = texture(uFrame, uv).rgb;
    vec3 prevC = texture(uPrevFrame, st).rgb;
    pixMotion = smoothstep(0.025, 0.14, length(curC - prevC));
  }
  float mot = max(pixMotion, clamp(uMotion * 1.15, 0.0, 1.0));
  float maskDelta = abs(raw - prev.x);
  // Still pixels blend strongly (0.20) to kill model flicker; moving pixels or clear transitions snap (0.88..1.0).
  float lo = mix(0.20, 0.86, mot);
  float k = uFirst > 0.5 ? 1.0 : clamp(lo + smoothstep(0.14, 0.48, maskDelta) * 0.72, lo, 1.0);
  float m = mix(prev.x, raw, k);
  float kh = uFirst > 0.5 ? 1.0 : clamp(mix(0.24, 0.85, mot) + abs(rawHair - prev.y) * 1.2, 0.24, 1.0);
  float h = mix(prev.y, rawHair, kh);
  o = vec4(m, h, 0.0, 1.0);
}`;

// Pass 2a: Pack RGB Color Guided Filter channels across 3 compact RGBA16F buffers:
//   pack0: (R, G, B, p)
//   pack1: (R*R, R*G, R*B, G*G)
//   pack2: (G*B, B*B, R*p, G*p)
//   pack3: (B*p, 0, 0, 1)
// Pre-cleaning p with a gentle confidence curve keeps weak wall ghosts out while preserving soft hair probabilities.
const GF_PACK0_FS = HEAD + `
uniform sampler2D uFrame, uMask;
void main() {
  vec3 c = texture(uFrame, uv).rgb;
  vec2 mh = texture(uMask, st).rg;
  // Hair keeps softer transitions; body drops weak noisy wall detections early.
  float hair = clamp(mh.y, 0.0, 1.0);
  float lo = mix(0.28, 0.14, hair);
  float hi = mix(0.76, 0.82, hair);
  float p = smoothstep(lo, hi, mh.x);
  o = vec4(c, p);
}`;
const GF_PACK1_FS = HEAD + `
uniform sampler2D uPack0;
void main() {
  vec3 c = texture(uPack0, st).rgb;
  o = vec4(c.r * c.r, c.r * c.g, c.r * c.b, c.g * c.g);
}`;
const GF_PACK2_FS = HEAD + `
uniform sampler2D uPack0;
void main() {
  vec4 v = texture(uPack0, st);
  o = vec4(v.g * v.b, v.b * v.b, v.r * v.a, v.g * v.a);
}`;
const GF_PACK3_FS = HEAD + `
uniform sampler2D uPack0;
void main() {
  vec4 v = texture(uPack0, st);
  o = vec4(v.b * v.a, 0.0, 0.0, 1.0);
}`;

const BOX_FS = HEAD + `
uniform sampler2D uSrc; uniform vec2 uStep; uniform int uR;
void main() {
  vec4 s = vec4(0.0);
  for (int i = -12; i <= 12; i++) {
    if (i < -uR || i > uR) continue;
    s += texture(uSrc, st + uStep * float(i));
  }
  o = s / float(2 * uR + 1);
}`;

// Pass 2b: Analytical 3×3 symmetric covariance inversion for full RGB Color Guided Filter.
// Outputs (a_r, a_g, a_b, b) where locally alpha ≈ dot(a, RGB) + b.
const GF_COEF_RGB_FS = HEAD + `
uniform sampler2D uM0, uM1, uM2, uM3;
uniform float uEps;
void main() {
  vec4 m0 = texture(uM0, st); // meanR, meanG, meanB, meanP
  vec4 m1 = texture(uM1, st); // meanRR, meanRG, meanRB, meanGG
  vec4 m2 = texture(uM2, st); // meanGB, meanBB, meanRP, meanGP
  vec4 m3 = texture(uM3, st); // meanBP
  vec3 mu = m0.rgb;
  float mp = m0.a;

  float crr = max(m1.x - mu.r * mu.r, 0.0) + uEps;
  float crg = m1.y - mu.r * mu.g;
  float crb = m1.z - mu.r * mu.b;
  float cgg = max(m1.w - mu.g * mu.g, 0.0) + uEps;
  float cgb = m2.x - mu.g * mu.b;
  float cbb = max(m2.y - mu.b * mu.b, 0.0) + uEps;

  vec3 covIp = vec3(m2.z - mu.r * mp, m2.w - mu.g * mp, m3.x - mu.b * mp);

  // Cofactors of symmetric 3×3 matrix (Sigma + eps * I)
  float cof00 = cgg * cbb - cgb * cgb;
  float cof01 = crb * cgb - crg * cbb;
  float cof02 = crg * cgb - crb * cgg;
  float cof11 = crr * cbb - crb * crb;
  float cof12 = crb * crg - crr * cgb;
  float cof22 = crr * cgg - crg * crg;

  float det = crr * cof00 + crg * cof01 + crb * cof02;
  float invDet = 1.0 / max(det, 1e-8);

  vec3 a = vec3(
    cof00 * covIp.r + cof01 * covIp.g + cof02 * covIp.b,
    cof01 * covIp.r + cof11 * covIp.g + cof12 * covIp.b,
    cof02 * covIp.r + cof12 * covIp.g + cof22 * covIp.b
  ) * invDet;
  float b = mp - dot(a, mu);
  o = vec4(a, b);
}`;

// Pass 3: Full-resolution hair-aware matte builder.
// Evaluates full-color guided matte (or RGB joint bilateral fallback), applies tight inward choke on solid
// shoulders/clothes so ZERO wall halos protrude, while keeping hair soft and feathery.
const MATTE_FS = HEAD + `
uniform sampler2D uFrame, uMask, uCoef;
uniform int uGuided;
uniform vec2 uTex, uMaskTex;
uniform float uFeather;

float bilateralMask() {
  vec3 cc = texture(uFrame, uv).rgb;
  float s = 0.0, ws = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 off = vec2(float(i), float(j));
      vec2 t = st + off * uMaskTex;
      vec3 d = texture(uFrame, vec2(t.x, 1.0 - t.y)).rgb - cc;
      float w = exp(-dot(off, off) * 0.28 - dot(d, d) * 68.0);
      s += texture(uMask, t).r * w;
      ws += w;
    }
  }
  return s / max(ws, 1e-5);
}

void main() {
  vec3 raw = texture(uFrame, uv).rgb;
  vec2 mh = texture(uMask, st).rg;
  float rawM = mh.x;
  float hair = smoothstep(0.18, 0.58, mh.y);

  float m;
  if (uGuided == 1) {
    vec4 cf = texture(uCoef, st);
    float gm = clamp(dot(cf.rgb, raw) + cf.a, 0.0, 1.0);
    // Guard against guided overshoot far outside or inside the subject.
    float loGuard = smoothstep(0.06, 0.24, rawM);
    float hiGuard = smoothstep(0.84, 0.98, rawM);
    m = mix(gm * loGuard, max(gm, hiGuard), hiGuard);
  } else {
    m = bilateralMask();
  }

  // Slight inward morphological choke on non-hair silhouette edges: stops low-res shoulder/hoodie bloat.
  if (hair < 0.7 && m > 0.03 && m < 0.94) {
    vec2 stepU = uMaskTex * 0.85;
    float nMin = min(
      min(texture(uMask, st + vec2(stepU.x, 0.0)).r, texture(uMask, st - vec2(stepU.x, 0.0)).r),
      min(texture(uMask, st + vec2(0.0, stepU.y)).r, texture(uMask, st - vec2(0.0, stepU.y)).r)
    );
    // Only pull inward where the raw mask is already dropping off at the outer rim.
    float chokeAmt = (1.0 - hair) * 0.28 * (1.0 - smoothstep(0.45, 0.82, nMin));
    m = max(0.0, m - chokeAmt * 0.34);
  }

  // Hair-aware edge ramp: tight & crisp on clothes/shoulders, softer & finer on hair strands.
  float fBase = clamp(uFeather, 0.03, 0.28);
  float mid = mix(0.54, 0.45, hair);
  float fLo = mix(fBase * 0.72, fBase * 1.35, hair);
  float fHi = mix(fBase * 0.65, fBase * 1.15, hair);
  float a = smoothstep(mid - fLo, mid + fHi, m);

  // Clean floor & ceiling so background is 100% pure and interior skin/clothes are 100% solid.
  a = a < 0.015 ? 0.0 : (a > 0.985 ? 1.0 : a);
  o = vec4(a, hair, m, 1.0);
}`;

// Pass 4: Premultiplied background pre-pass for halo-free Gaussian background blur.
const PRE_FS = HEAD + `
uniform sampler2D uFrame, uMatte, uMask;
uniform int uUseMask;
void main() {
  vec3 f = texture(uFrame, uv).rgb;
  float m = uUseMask == 0 ? 0.0 : max(texture(uMatte, st).r, texture(uMask, st).r);
  float w = 1.0 - smoothstep(0.04, 0.42, m); // generous exclusion: person never bleeds into blurred backdrop
  o = vec4(f * w, w);
}`;

const BLUR_FS = HEAD + `
uniform sampler2D uSrc; uniform vec2 uDir;
void main() {
  vec4 c = texture(uSrc, st) * 0.2270270270;
  c += (texture(uSrc, st + uDir * 1.3846153846) + texture(uSrc, st - uDir * 1.3846153846)) * 0.3162162162;
  c += (texture(uSrc, st + uDir * 3.2307692308) + texture(uSrc, st - uDir * 3.2307692308)) * 0.0702702703;
  o = c;
}`;

// Pass 5: Final Broadcast Compositor
//   - Sub-pixel edge anti-aliasing on the full-res matte
//   - Dual-ring Foreground Color Decontamination (eliminates room-wall halos around hair, ears, shoulders, hoodie!)
//   - Chroma key with hue-aware spill removal
//   - Subtle studio light wrap + brightness/contrast/saturation
const FINAL_FS = HEAD + `
uniform sampler2D uFrame, uBg, uMatte, uBlur;
uniform int uMode;      // 0 none, 1 chroma key, 2 AI mask
uniform int uBgKind;    // 0 blurred camera, 1 picture
uniform vec2 uKey, uKeyC, uTex; uniform vec3 uKeyRGB;
uniform float uTol, uSoft, uSpill, uWrap, uBright, uContrast, uSat;

vec2 cbcr(vec3 c) { return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float keyScore(vec3 c) {
  vec2 v = cbcr(c) / max(luma(c), 0.05);
  float kk = max(dot(uKeyC, uKeyC), 1e-4);
  float q = dot(v, uKeyC) / kk;
  return q - 0.9 * length(v - uKeyC * q) / sqrt(kk);
}
float keyA(vec2 t) { float lo = 0.18 + uTol * 2.0; return 1.0 - smoothstep(lo, lo + 0.12 + uSoft * 3.0, keyScore(texture(uFrame, t).rgb)); }
float limitTo(float x, float y, float amount) { return mix(max(x, y), (x + y) * 0.5, amount); }
vec3 rgbOf(float y, vec2 v) { return vec3(y + 1.402 * v.y, y - 0.344136 * v.x - 0.714136 * v.y, y + 1.772 * v.x); }
vec3 despill(vec3 c, float amount) {
  float y = luma(c);
  vec2 v = cbcr(c) / max(y, 0.05);
  float q = dot(v, uKeyC) / max(dot(uKeyC, uKeyC), 1e-4);
  float align = dot(normalize(v + vec2(1e-5)), normalize(uKeyC + vec2(1e-5)));
  float w = smoothstep(-0.1, 0.7, align);
  if (q > 0.0) c = clamp(rgbOf(y, (v - uKeyC * q * amount * w) * max(y, 0.05)), 0.0, 1.0);
  if (uKeyRGB.g >= uKeyRGB.r && uKeyRGB.g >= uKeyRGB.b) c.g = min(c.g, mix(c.g, limitTo(c.r, c.b, amount), min(1.0, amount * 1.5)));
  else if (uKeyRGB.b >= uKeyRGB.r) c.b = min(c.b, mix(c.b, limitTo(c.r, c.g, amount), min(1.0, amount * 1.5)));
  else c.r = min(c.r, mix(c.r, limitTo(c.g, c.b, amount), min(1.0, amount * 1.5)));
  return c;
}

// Broadcast foreground color decontamination (halo removal):
// Samples nearby pure interior foreground (alpha > 0.88) and pure exterior room background (alpha < 0.08)
// in two concentric rings around any boundary pixel, then unmixes & replaces contaminated fringe color!
vec3 decontaminateEdge(vec3 raw, float a, float hair) {
  vec3 fgSum = vec3(0.0); float fgW = 0.0;
  vec3 bgSum = vec3(0.0); float bgW = 0.0;

  // 8-direction inner ring (2.2px) + 8-direction outer ring (5.0px)
  const vec2 DIRS[8] = vec2[8](
    vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0),
    vec2(0.7071, 0.7071), vec2(-0.7071, 0.7071), vec2(0.7071, -0.7071), vec2(-0.7071, -0.7071)
  );
  for (int ring = 0; ring < 2; ring++) {
    float rad = ring == 0 ? 2.4 : 5.2;
    float rw = ring == 0 ? 1.0 : 0.55;
    for (int i = 0; i < 8; i++) {
      vec2 dSt = DIRS[i] * rad * uTex;
      vec2 sSt = clamp(st + dSt, vec2(0.001), vec2(0.999));
      vec2 sUv = vec2(sSt.x, 1.0 - sSt.y);
      float sa = texture(uMatte, sSt).r;
      vec3 sc = texture(uFrame, sUv).rgb;
      if (sa > 0.80) {
        float w = smoothstep(0.80, 0.99, sa) * rw;
        fgSum += sc * w; fgW += w;
      } else if (sa < 0.14) {
        float w = smoothstep(0.14, 0.01, sa) * rw;
        bgSum += sc * w; bgW += w;
      }
    }
  }

  vec3 clean = raw;
  // 1) Mathematical optical unmixing: C = a * F + (1 - a) * B_orig  =>  F = (C - (1 - a) * B_orig) / a
  if (bgW > 0.05) {
    vec3 bOrig = bgSum / bgW;
    vec3 unmixed = clamp((raw - (1.0 - a) * bOrig) / max(a, 0.28), 0.0, 1.0);
    // Avoid wild amplification on dark pixels by blending gently with raw
    clean = mix(raw, unmixed, smoothstep(0.95, 0.20, a) * 0.72);
  }
  // 2) Pull edge RGB directly toward pure interior foreground color (kills stubborn bright wall glow on hoodie/hair)
  if (fgW > 0.05) {
    vec3 fIn = fgSum / fgW;
    float pull = smoothstep(0.96, 0.06, a) * mix(0.88, 0.62, hair);
    clean = mix(clean, fIn, pull);
  }
  return clean;
}

void main() {
  vec3 raw = texture(uFrame, uv).rgb;
  vec3 c = raw;
  float a = 1.0;
  float hair = 0.0;

  if (uMode == 1) {
    float ctr = keyA(uv), sum = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) sum += keyA(uv + vec2(float(i), float(j)) * uTex);
    a = smoothstep(0.08, 0.92, mix(ctr, sum / 9.0, 0.6));
    c = despill(c, mix(1.0, uSpill, a));
  } else if (uMode == 2) {
    vec4 mt = texture(uMatte, st);
    float a0 = mt.r;
    hair = mt.g;
    // Sub-pixel 5-tap edge anti-aliasing on boundary pixels only (silky diagonal shoulders & glasses, zero blur inside)
    if (a0 > 0.005 && a0 < 0.995) {
      float aL = texture(uMatte, st - vec2(uTex.x, 0.0)).r;
      float aR = texture(uMatte, st + vec2(uTex.x, 0.0)).r;
      float aU = texture(uMatte, st + vec2(0.0, uTex.y)).r;
      float aD = texture(uMatte, st - vec2(0.0, uTex.y)).r;
      a = a0 * 0.52 + (aL + aR + aU + aD) * 0.12;
      // Foreground color decontamination removes the warm/bright room-wall halo!
      c = decontaminateEdge(raw, a, hair);
    } else {
      a = a0;
    }
  }

  vec3 bg;
  if (uBgKind == 1) bg = texture(uBg, uv).rgb;
  else { vec4 b = texture(uBlur, st); bg = b.a > 0.004 ? b.rgb / b.a : raw; }

  if (uMode != 0 && a > 0.002 && a < 0.998) {
    vec3 wrapSrc = uBgKind == 1 ? textureLod(uBg, uv, 4.5).rgb : bg;
    float edge = clamp(4.0 * a * (1.0 - a), 0.0, 1.0);
    // Subtle studio ambient light wrap makes the cutout sit physically in the scene
    c = mix(c, wrapSrc, uWrap * edge * mix(0.32, 0.48, hair));
  }

  vec3 outc = mix(bg, c, a);
  outc = (outc - 0.5) * uContrast + 0.5 + uBright;
  float l = luma(outc);
  o = vec4(clamp(mix(vec3(l), outc, uSat), 0.0, 1.0), 1.0);
}`;

function keyColour(hex) {
  const n = parseInt(String(hex || '#00ff00').slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const cb = -0.168736 * r - 0.331264 * g + 0.5 * b, cr = 0.5 * r - 0.418688 * g - 0.081312 * b, y = Math.max(0.05, 0.299 * r + 0.587 * g + 0.114 * b);
  return { rgb: [r, g, b], cbcr: [cb, cr], chroma: [cb / y, cr / y] };
}

// MediaPipe Tasks multiclass selfie segmenter (0=bg, 1=hair, 2=body-skin, 3=face-skin, 4=clothes, 5=accessories).
const TASKS_WASM = 'https://unpkg.com/@mediapipe/tasks-vision@1.2.2/wasm';
const TASKS_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite';
let tasksLoad = null;
function loadTasksSegmenter() {
  if (globalThis.__gatherTestSegmenter) return Promise.resolve(globalThis.__gatherTestSegmenter);
  tasksLoad ||= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('/vendor/tasks-vision/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(TASKS_WASM);
    const make = (delegate) => ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: TASKS_MODEL, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })().catch((e) => { tasksLoad = null; throw e; });
  return tasksLoad;
}

let segLoad = null;
function loadSegmenter() {
  segLoad ||= new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/selfie/selfie_segmentation.js';
    sc.onload = () => {
      try {
        const seg = new window.SelfieSegmentation({ locateFile: (f) => '/vendor/selfie/' + f });
        seg.setOptions({ modelSelection: 0, selfieMode: false });
        res(seg);
      } catch (e) { rej(e); }
    };
    sc.onerror = () => { segLoad = null; rej(new Error('Could not load the background model.')); };
    document.head.append(sc);
  });
  return segLoad;
}

/**
 * opts: { effect: 'none'|'blur'|'image'|'green', bgImage: HTMLImageElement|null, key: '#00ff00', tol: .1, soft: .08,
 *         spill: .85, edge: .1, wrap: .28, blur: 1, bright: 0, contrast: 1, sat: 1 }
 */
export function needsProcessing(o) {
  return (o.effect && o.effect !== 'none') || Math.abs(o.bright || 0) > 0.001 || Math.abs((o.contrast ?? 1) - 1) > 0.001 || Math.abs((o.sat ?? 1) - 1) > 0.001;
}
const DEFAULTS = { effect: 'none', key: '#00ff00', tol: 0.1, soft: 0.08, spill: 0.85, edge: 0.09, wrap: 0.28, blur: 1, bright: 0, contrast: 1, sat: 1, bgImage: null };

/**
 * Standalone WebGL2 compositor: accepts frames & person/hair masks, renders into `canvas`.
 */
export function createFxRenderer(W, H, opts = {}) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('This browser cannot run video effects (WebGL2 is unavailable).');
  const floatOk = !!gl.getExtension('EXT_color_buffer_float');
  const compile = (fs) => {
    const sh = (type, src) => {
      const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
      return x;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u = {};
    return { prog, u: (n) => (u[n] ??= gl.getUniformLocation(prog, n)) };
  };
  const P = {
    copyFrame: compile(COPY_FRAME_FS),
    mask: compile(MASK_FS),
    pack0: compile(GF_PACK0_FS),
    pack1: compile(GF_PACK1_FS),
    pack2: compile(GF_PACK2_FS),
    pack3: compile(GF_PACK3_FS),
    box: compile(BOX_FS),
    coefRgb: compile(GF_COEF_RGB_FS),
    matte: compile(MATTE_FS),
    pre: compile(PRE_FS),
    blur: compile(BLUR_FS),
    final: compile(FINAL_FS),
  };
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (w, h, { float = false, mip = false } = {}) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, float && floatOk ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, float && floatOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    return t;
  };
  const target = (w, h, float) => {
    const tex = texture(w, h, { float });
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  };

  const tFrame = texture(), tBg = texture(0, 0, { mip: true }), tMaskRaw = texture();
  const qw = Math.max(16, Math.round(W / 4)), qh = Math.max(16, Math.round(H / 4));
  const pre = target(qw, qh, true), blurA = target(qw, qh, true), blurB = target(qw, qh, true);

  // Full 3-channel RGB Guided Filter at 480px wide (fast on GPU, laser-sharp RGB edge separation)
  const gw = Math.min(W, 480), gh = Math.max(16, Math.round(gw * H / W));
  const guided = floatOk;
  const gf0 = guided ? target(gw, gh, true) : null;
  const gf1 = guided ? target(gw, gh, true) : null;
  const gf2 = guided ? target(gw, gh, true) : null;
  const gf3 = guided ? target(gw, gh, true) : null;
  const gfTmp = guided ? target(gw, gh, true) : null;
  const gfCoef = guided ? target(gw, gh, true) : null;

  // Full-resolution refined matte target (enables dual-ring foreground color decontamination!)
  const matteTgt = target(W, H, false);
  // Previous camera frame thumbnail for per-pixel motion-adaptive temporal filtering
  const prevFrameTgt = target(gw, gh, false);
  let hasPrevFrame = false;

  let maskA = null, maskB = null, maskW = 0, maskH = 0, maskFirst = true, haveMask = false, maskCh = 0;
  const imgC = document.createElement('canvas'); imgC.width = W; imgC.height = H; const imgG = imgC.getContext('2d');
  let o = { ...DEFAULTS, ...opts };

  const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
  const upload = (tex, src) => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
  const pass = (p, tgt, w, h) => { gl.useProgram(p.prog); gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null); gl.viewport(0, 0, w, h); };
  const draw = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  function paintBg() {
    imgG.fillStyle = '#0b1530'; imgG.fillRect(0, 0, W, H);
    const im = o.bgImage;
    if (im && (im.naturalWidth || im.width)) {
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      const k = Math.max(W / iw, H / ih);
      imgG.drawImage(im, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
    } else {
      const g = imgG.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#12264f'); g.addColorStop(1, '#2d2f70');
      imgG.fillStyle = g; imgG.fillRect(0, 0, W, H);
    }
    upload(tBg, imgC); gl.generateMipmap(gl.TEXTURE_2D);
  }
  function set(next) {
    o = { ...o, ...next };
    if ('bgImage' in next || ((o.effect === 'image' || o.effect === 'green') && !tBg.painted)) { paintBg(); tBg.painted = true; }
  }
  set({});

  // Stray-detection cleanup: strips detached background islands (lamps, chair backs, posters) while preserving
  // BOTH the full soft person probability (R) and hair confidence (G) at crisp 480×270 resolution.
  const cw = 480, ch = Math.max(16, Math.round(cw * H / W));
  const cc = document.createElement('canvas'); cc.width = cw; cc.height = ch;
  const cg = cc.getContext('2d', { willReadFrequently: true });
  const label = new Int32Array(cw * ch), stack = new Int32Array(cw * ch);
  function cleanMask(src, channel, hairChannel = -1) {
    cg.clearRect(0, 0, cw, ch); cg.drawImage(src, 0, 0, cw, ch);
    const im = cg.getImageData(0, 0, cw, ch), d = im.data, n = cw * ch;
    label.fill(0);
    const areas = [0], bottom = [false], sums = [0];
    for (let i = 0; i < n; i++) {
      if (label[i] || d[i * 4 + channel] < 96) continue;
      const id = areas.length; let top = 0, area = 0, low = false, sum = 0;
      stack[top++] = i; label[i] = id;
      while (top) {
        const j = stack[--top]; area++; sum += d[j * 4 + channel];
        const x = j % cw, y = (j - x) / cw;
        if (y === ch - 1) low = true;
        if (x > 0 && !label[j - 1] && d[(j - 1) * 4 + channel] >= 96) { label[j - 1] = id; stack[top++] = j - 1; }
        if (x < cw - 1 && !label[j + 1] && d[(j + 1) * 4 + channel] >= 96) { label[j + 1] = id; stack[top++] = j + 1; }
        if (y > 0 && !label[j - cw] && d[(j - cw) * 4 + channel] >= 96) { label[j - cw] = id; stack[top++] = j - cw; }
        if (y < ch - 1 && !label[j + cw] && d[(j + cw) * 4 + channel] >= 96) { label[j + cw] = id; stack[top++] = j + cw; }
      }
      areas.push(area); bottom.push(low); sums.push(sum);
    }
    const biggest = Math.max(0, ...areas);
    const keep = areas.map((a, id) => id > 0 && (a >= biggest * 0.18 || sums[id] / a >= 218 || (bottom[id] && a >= n * 0.004)));
    for (let i = 0; i < n; i++) {
      const id = label[i];
      const alive = !id || keep[id];
      const v = alive ? d[i * 4 + channel] : 0;
      const hv = alive && hairChannel >= 0 ? d[i * 4 + hairChannel] : 0;
      d[i * 4] = v;
      d[i * 4 + 1] = hv;
      d[i * 4 + 2] = 0;
      d[i * 4 + 3] = 255;
    }
    // Strip soft fringe touching dropped background islands
    for (let p = 0; p < 3; p++) {
      for (let i = 0; i < n; i++) {
        if (label[i] || d[i * 4] === 0) continue;
        const x = i % cw;
        const near = (j) => (label[j] > 0 && !keep[label[j]]) || (label[j] < 0 && label[j] !== -2 - p);
        if ((x > 0 && near(i - 1)) || (x < cw - 1 && near(i + 1)) || (i >= cw && near(i - cw)) || (i < n - cw && near(i + cw))) {
          d[i * 4] = 0; d[i * 4 + 1] = 0; label[i] = -2 - p;
        }
      }
    }
    cg.putImageData(im, 0, 0);
    return cc;
  }

  function setMask(rawSrc, rawChannel, motion = 0, hairChannel = -1, frameSrc = null) {
    if (frameSrc) upload(tFrame, frameSrc);
    const src = cleanMask(rawSrc, rawChannel, hairChannel), channel = 0;
    const w = src.width || src.videoWidth, h = src.height || src.videoHeight;
    if (!w || !h) return;
    if (w !== maskW || h !== maskH) {
      maskW = w; maskH = h;
      maskA = target(w, h, true);
      maskB = target(w, h, true);
      maskFirst = true;
    }
    maskCh = channel;
    upload(tMaskRaw, src);
    pass(P.mask, maskB, maskW, maskH);
    bind(0, tMaskRaw); bind(1, maskA.tex); bind(2, tFrame); bind(3, prevFrameTgt.tex);
    gl.uniform1i(P.mask.u('uRaw'), 0);
    gl.uniform1i(P.mask.u('uPrev'), 1);
    gl.uniform1i(P.mask.u('uFrame'), 2);
    gl.uniform1i(P.mask.u('uPrevFrame'), 3);
    gl.uniform1i(P.mask.u('uCh'), channel);
    gl.uniform1i(P.mask.u('uHasHair'), hairChannel >= 0 ? 1 : 0);
    gl.uniform1i(P.mask.u('uHasPrevFrame'), hasPrevFrame && frameSrc ? 1 : 0);
    gl.uniform1f(P.mask.u('uFirst'), maskFirst ? 1 : 0);
    gl.uniform1f(P.mask.u('uMotion'), Math.max(0, Math.min(1, motion)));
    draw();
    [maskA, maskB] = [maskB, maskA];
    maskFirst = false; haveMask = true;
  }

  const boxBlur = (tgt, r) => {
    pass(P.box, gfTmp, gw, gh);
    bind(0, tgt.tex);
    gl.uniform1i(P.box.u('uSrc'), 0);
    gl.uniform2f(P.box.u('uStep'), 1 / gw, 0);
    gl.uniform1i(P.box.u('uR'), r);
    draw();
    pass(P.box, tgt, gw, gh);
    bind(0, gfTmp.tex);
    gl.uniform1i(P.box.u('uSrc'), 0);
    gl.uniform2f(P.box.u('uStep'), 0, 1 / gh);
    gl.uniform1i(P.box.u('uR'), r);
    draw();
  };

  /** Composite one frame from `src` (video, image or canvas) into `canvas`. */
  function render(src) {
    upload(tFrame, src);
    const ai = o.effect === 'blur' || o.effect === 'image';
    const mode = o.effect === 'green' ? 1 : ai && haveMask ? 2 : 0;
    const bgKind = o.effect === 'image' || (o.effect === 'green' && o.bgImage) ? 1 : 0;
    const useGuided = mode === 2 && guided && maskA;

    if (mode === 2 && maskA) {
      if (useGuided) {
        // Tight 9×9 RGB Color Guided Filter (r = 4) — laser-sharp RGB separation with zero wall bleed
        const r = Math.max(2, Math.min(8, Math.round((o.radius ?? 4) * gw / 480)));
        pass(P.pack0, gf0, gw, gh); bind(0, tFrame); bind(1, maskA.tex);
        gl.uniform1i(P.pack0.u('uFrame'), 0); gl.uniform1i(P.pack0.u('uMask'), 1); draw();

        pass(P.pack1, gf1, gw, gh); bind(0, gf0.tex); gl.uniform1i(P.pack1.u('uPack0'), 0); draw();
        pass(P.pack2, gf2, gw, gh); bind(0, gf0.tex); gl.uniform1i(P.pack2.u('uPack0'), 0); draw();
        pass(P.pack3, gf3, gw, gh); bind(0, gf0.tex); gl.uniform1i(P.pack3.u('uPack0'), 0); draw();

        boxBlur(gf0, r);
        boxBlur(gf1, r);
        boxBlur(gf2, r);
        boxBlur(gf3, r);

        pass(P.coefRgb, gfCoef, gw, gh);
        bind(0, gf0.tex); bind(1, gf1.tex); bind(2, gf2.tex); bind(3, gf3.tex);
        gl.uniform1i(P.coefRgb.u('uM0'), 0);
        gl.uniform1i(P.coefRgb.u('uM1'), 1);
        gl.uniform1i(P.coefRgb.u('uM2'), 2);
        gl.uniform1i(P.coefRgb.u('uM3'), 3);
        gl.uniform1f(P.coefRgb.u('uEps'), o.eps ?? 0.0005);
        draw();

        boxBlur(gfCoef, r);
      }

      // Build full-resolution hair-aware matte into matteTgt
      pass(P.matte, matteTgt, W, H);
      bind(0, tFrame); bind(1, maskA.tex); bind(2, useGuided ? gfCoef.tex : maskA.tex);
      gl.uniform1i(P.matte.u('uFrame'), 0);
      gl.uniform1i(P.matte.u('uMask'), 1);
      gl.uniform1i(P.matte.u('uCoef'), 2);
      gl.uniform1i(P.matte.u('uGuided'), useGuided ? 1 : 0);
      gl.uniform2f(P.matte.u('uTex'), 1 / W, 1 / H);
      gl.uniform2f(P.matte.u('uMaskTex'), 1 / (maskW || W), 1 / (maskH || H));
      gl.uniform1f(P.matte.u('uFeather'), o.edge);
      draw();
    }

    if (mode !== 0 && bgKind === 0) {
      pass(P.pre, pre, qw, qh);
      bind(0, tFrame); bind(1, matteTgt.tex); bind(2, maskA ? maskA.tex : tMaskRaw);
      gl.uniform1i(P.pre.u('uFrame'), 0);
      gl.uniform1i(P.pre.u('uMatte'), 1);
      gl.uniform1i(P.pre.u('uMask'), 2);
      gl.uniform1i(P.pre.u('uUseMask'), mode === 2 ? 1 : 0);
      draw();
      let src2 = pre;
      const strength = Math.max(0.2, o.blur ?? 1);
      for (const s of [1, 2, 4]) {
        for (const [dst, dir] of [[blurA, [s * strength / qw, 0]], [blurB, [0, s * strength / qh]]]) {
          pass(P.blur, dst, qw, qh); bind(0, src2.tex);
          gl.uniform1i(P.blur.u('uSrc'), 0); gl.uniform2f(P.blur.u('uDir'), dir[0], dir[1]);
          draw(); src2 = dst;
        }
      }
    }

    const F = P.final;
    pass(F, null, W, H);
    bind(0, tFrame); bind(1, tBg); bind(2, matteTgt.tex); bind(3, blurB.tex);
    gl.uniform1i(F.u('uFrame'), 0); gl.uniform1i(F.u('uBg'), 1); gl.uniform1i(F.u('uMatte'), 2); gl.uniform1i(F.u('uBlur'), 3);
    gl.uniform1i(F.u('uMode'), mode); gl.uniform1i(F.u('uBgKind'), bgKind);
    const key = keyColour(o.key);
    gl.uniform2f(F.u('uKey'), ...key.cbcr);
    gl.uniform2f(F.u('uKeyC'), ...key.chroma);
    gl.uniform3f(F.u('uKeyRGB'), ...key.rgb);
    gl.uniform2f(F.u('uTex'), 1 / W, 1 / H);
    gl.uniform1f(F.u('uTol'), o.tol); gl.uniform1f(F.u('uSoft'), o.soft); gl.uniform1f(F.u('uSpill'), o.spill);
    gl.uniform1f(F.u('uWrap'), o.wrap); gl.uniform1f(F.u('uBright'), o.bright); gl.uniform1f(F.u('uContrast'), o.contrast); gl.uniform1f(F.u('uSat'), o.sat);
    draw();

    // Save frame into prevFrameTgt for next frame's per-pixel motion comparison
    if (ai) {
      pass(P.copyFrame, prevFrameTgt, gw, gh);
      bind(0, tFrame); gl.uniform1i(P.copyFrame.u('uFrame'), 0);
      draw();
      hasPrevFrame = true;
    }
  }

  return { canvas, gl, set, setMask, render, guided, get haveMask() { return haveMask; }, get maskChannel() { return maskCh; } };
}

// A green or blue screen sits behind the person, so it fills the top and sides of the picture; the bottom edge
// is mostly the person (a blue shirt there must never be taken for a screen).
const BORDER = (x, y) => (x < 8 || x > 87 || y < 7) && y < 44;
function sampleBorder(src) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 54;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, 96, 54);
  const d = g.getImageData(0, 0, 96, 54).data, px = [];
  for (let y = 0; y < 54; y++) for (let x = 0; x < 96; x++) if (BORDER(x, y)) { const i = (y * 96 + x) * 4; px.push([d[i], d[i + 1], d[i + 2]]); }
  return px;
}
const isScreenish = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx > 40 && (mx - mn) / mx > 0.35 && (g === mx || b === mx) && Math.max(g, b) > r * 1.25;
};
const near = (p, k) => { const s = p[0] + p[1] + p[2] + 1, ks = k[0] + k[1] + k[2] + 1; return s >= 60 && Math.hypot(p[0] / s - k[0] / ks, p[1] / s - k[1] / ks) < 0.07; };

/** Estimate the screen colour from the top and sides of the frame, or null when no screen fills them. */
export function estimateKey(src) {
  const px = sampleBorder(src), picks = px.filter(isScreenish);
  if (picks.length < px.length * 0.3) return null;
  const med = (k) => picks.map((p) => p[k]).sort((a, b) => a - b)[picks.length >> 1];
  const key = [med(0), med(1), med(2)];
  if (px.filter((p) => near(p, key)).length < px.length * 0.3) return null;
  return '#' + key.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Share of the top and sides of the picture that match the screen colour (0–1). Under 0.3: no screen in view. */
export function screenCoverage(src, keyHex) {
  const k = [1, 3, 5].map((i) => parseInt(keyHex.slice(i, i + 2), 16)), px = sampleBorder(src);
  return px.filter((p) => near(p, k)).length / px.length;
}

export async function createVideoFx(srcTrack, opts) {
  const s = srcTrack.getSettings();
  const W = s.width || 1280, H = s.height || 720;
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.srcObject = new MediaStream([srcTrack]);
  await video.play().catch(() => {});
  const r = createFxRenderer(W, H, opts);
  let o = { ...DEFAULTS, ...opts };
  let seg = null, segBusy = false, stopped = false, note = '', maskChannel = -1;

  // Aspect-preserving 1:1 square crop fed to MediaPipe's 256×256 multiclass selfie model.
  // Never squashes 16:9 horizontally (squashing distorted heads/shoulders and degraded edge accuracy).
  let tseg = null, frameNo = 0, lastTs = 0, segCost = 0, segNext = 0;
  let roi = { x: 0, y: 0, w: W, h: H };
  const SEG = 256, cropC = document.createElement('canvas'); cropC.width = cropC.height = SEG;
  const cropG = cropC.getContext('2d', { willReadFrequently: true });
  const segC = document.createElement('canvas'); segC.width = segC.height = SEG;
  const segG = segC.getContext('2d'); const segImg = segG.createImageData(SEG, SEG);
  const FW = Math.min(W, 640), FH = Math.round(FW * H / W), fullC = document.createElement('canvas'); fullC.width = FW; fullC.height = FH;
  const fullG = fullC.getContext('2d');
  let needFull = false, snapNext = false;

  function nextRoi(full, bb, k = 0.65) {
    if (full || !bb) return { x: 0, y: 0, w: W, h: H };
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    let side = Math.max(bb.w * 1.48, bb.h * 1.38, H * 0.45);
    let w = Math.min(W, side), h = Math.min(H, side);
    if (side > H) { h = H; w = Math.min(W, Math.max(h, bb.w * 1.48)); }
    const x = Math.max(0, Math.min(W - w, cx - w / 2)), y = Math.max(0, Math.min(H - h, cy - h / 2));
    return { x: roi.x + (x - roi.x) * k, y: roi.y + (y - roi.y) * k, w: roi.w + (w - roi.w) * k, h: roi.h + (h - roi.h) * k };
  }

  function tasksStep() {
    frameNo++;
    const motion = cameraMotion();
    const full = needFull || motion > 0.35 || frameNo === 1 || frameNo % 36 === 0;
    needFull = false;
    const r0 = full ? { x: 0, y: 0, w: W, h: H } : roi;

    // Aspect-preserving fit inside 256×256 square (letterboxed cleanly when r0.w != r0.h)
    const scale = Math.min(SEG / r0.w, SEG / r0.h);
    const dw = Math.max(1, Math.round(r0.w * scale));
    const dh = Math.max(1, Math.round(r0.h * scale));
    const dx = Math.floor((SEG - dw) / 2);
    const dy = Math.floor((SEG - dh) / 2);
    cropG.fillStyle = '#080b12';
    cropG.fillRect(0, 0, SEG, SEG);
    cropG.drawImage(src, r0.x, r0.y, r0.w, r0.h, dx, dy, dw, dh);

    const ts = Math.max(lastTs + 1, performance.now()); lastTs = ts;
    const res = tseg.segmentForVideo(cropC, ts);
    let minX = SEG, minY = SEG, maxX = -1, maxY = -1;
    let hasHair = false;
    try {
      const masks = res?.confidenceMasks;
      const bgMask = masks?.[0];
      if (!bgMask) return;
      const bg = bgMask.getAsFloat32Array();
      // Multiclass selfie model class 1 is Hair — preserve it in G channel so hair gets fine strand refinement!
      const hairArr = masks.length >= 2 ? masks[1].getAsFloat32Array() : null;
      hasHair = !!hairArr;
      const d = segImg.data;
      for (let i = 0; i < SEG * SEG; i++) {
        const v = Math.max(0, Math.min(1, 1 - bg[i]));
        const h = hairArr ? Math.max(0, Math.min(1, hairArr[i])) : 0;
        const idx = i * 4;
        d[idx] = v * 255;
        d[idx + 1] = h * 255;
        d[idx + 2] = 0;
        d[idx + 3] = 255;
        if (v > 0.5) {
          const x = i % SEG, y = (i - x) / SEG;
          if (x >= dx && x < dx + dw && y >= dy && y < dy + dh) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
    } finally {
      res?.close?.();
    }
    segG.putImageData(segImg, 0, 0);
    fullG.clearRect(0, 0, FW, FH);
    // Project only the active (non-letterboxed) region back onto fullC
    fullG.drawImage(segC, dx, dy, dw, dh, r0.x * FW / W, r0.y * FH / H, r0.w * FW / W, r0.h * FH / H);
    r.setMask(fullC, 0, motion, hasHair ? 1 : -1, src);

    if (!full && maxX >= 0) {
      const e = 3;
      needFull =
        (minX <= dx + e && r0.x > 1) ||
        (minY <= dy + e && r0.y > 1) ||
        (maxX >= dx + dw - 1 - e && r0.x + r0.w < W - 1) ||
        (maxY >= dy + dh - 1 - e && r0.y + r0.h < H - 1);
    }
    const bb = maxX < 0 ? null : {
      x: r0.x + ((minX - dx) / dw) * r0.w,
      y: r0.y + ((minY - dy) / dh) * r0.h,
      w: ((maxX - minX + 1) / dw) * r0.w,
      h: ((maxY - minY + 1) / dh) * r0.h,
    };
    if (full && bb) roi = nextRoi(false, bb, motion > 0.35 || snapNext ? 1 : 0.72);
    else roi = nextRoi(!bb, bb);
    snapNext = needFull;
  }

  // Global camera motion estimate (0..1) complementing per-pixel GPU motion detection.
  const motC = document.createElement('canvas'); motC.width = 32; motC.height = 18;
  const motG = motC.getContext('2d', { willReadFrequently: true });
  let motPrev = null;
  function cameraMotion() {
    try {
      motG.drawImage(src, 0, 0, 32, 18);
      const d = motG.getImageData(0, 0, 32, 18).data, cur = new Float32Array(32 * 18);
      let sum = 0;
      for (let i = 0; i < cur.length; i++) {
        cur[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
        if (motPrev) sum += Math.abs(cur[i] - motPrev[i]);
      }
      const had = !!motPrev; motPrev = cur;
      return had ? Math.max(0, Math.min(1, (sum / cur.length - 1.5) / 10)) : 0;
    } catch { return 0; }
  }

  const probe = document.createElement('canvas'); probe.width = 32; probe.height = 18;
  const probeG = probe.getContext('2d', { willReadFrequently: true });
  async function ensureSeg() {
    if (seg || tseg || !['blur', 'image'].includes(o.effect)) return;
    try { tseg = await loadTasksSegmenter(); return; } catch (e) { console.warn('[fx] newer segmenter unavailable, using the classic one:', e?.message || e); }
    try {
      seg = await loadSegmenter();
      seg.onResults((res) => {
        const m = res.segmentationMask;
        if (maskChannel < 0) {
          probeG.clearRect(0, 0, 32, 18); probeG.drawImage(m, 0, 0, 32, 18);
          const d = probeG.getImageData(0, 0, 32, 18).data; let minA = 255;
          for (let i = 3; i < d.length; i += 4) minA = Math.min(minA, d[i]);
          maskChannel = minA < 250 ? 3 : 0;
        }
        r.setMask(m, maskChannel, cameraMotion(), -1, pendingSnap || src);
        if (pendingSnap) { r.render(pendingSnap); pendingSnap = null; }
      });
    } catch (e) { note = e.message; }
  }
  function apply(next) { o = { ...o, ...next }; r.set(next); ensureSeg(); }
  apply({});

  let lastFrameAt = 0, pendingSnap = null, flip = false;
  const snapA = document.createElement('canvas'), snapB = document.createElement('canvas');
  for (const c of [snapA, snapB]) { c.width = W; c.height = H; }
  let src = video;
  function snapshot() { const c = flip ? snapA : snapB; flip = !flip; c.getContext('2d').drawImage(video, 0, 0, W, H); return c; }
  function frame() {
    if (stopped || video.readyState < 2) return;
    lastFrameAt = performance.now();
    const ai = o.effect === 'blur' || o.effect === 'image';
    if (ai && tseg) {
      if (performance.now() < segNext) return;
      const snap = snapshot(); src = snap; const t0 = performance.now();
      try { tasksStep(); } catch (e) { console.warn('[fx] segmenter:', e?.message || e); }
      r.render(snap);
      const cost = performance.now() - t0;
      segCost = segCost ? segCost * 0.8 + cost * 0.2 : cost;
      segNext = performance.now() + Math.max(0, segCost * 1.4 - 1000 / 60);
      return;
    }
    if (ai && seg) {
      if (segBusy) return;
      const snap = snapshot(); src = snap; pendingSnap = snap; segBusy = true;
      seg.send({ image: snap }).catch(() => { pendingSnap = null; }).finally(() => { segBusy = false; });
      return;
    }
    src = video;
    r.render(video);
  }
  if (video.requestVideoFrameCallback) {
    const onFrame = () => { if (stopped) return; frame(); video.requestVideoFrameCallback(onFrame); };
    video.requestVideoFrameCallback(onFrame);
  }
  const timer = setInterval(() => { if (performance.now() - lastFrameAt > 60) frame(); }, 1000 / 30);
  const track = r.canvas.captureStream(30).getVideoTracks()[0];
  track.contentHint = 'motion';
  return {
    track, canvas: r.canvas,
    get note() { return note; },
    set: apply,
    /** Pick the green/blue screen colour from what the camera sees right now. */
    autoKey() { return video.readyState >= 2 ? estimateKey(video) : null; },
    /** How much of the frame is the screen colour right now, or -1 before the camera has a frame. */
    coverage(keyHex) { return video.readyState >= 2 ? screenCoverage(video, keyHex) : -1; },
    stop() { stopped = true; clearInterval(timer); track.stop(); video.srcObject = null; },
  };
}
