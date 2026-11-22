// The home page backdrop: a real-time WebGL scene behind the hero. A flowing mesh-gradient aurora, glossy
// iridescent 3D shapes (melting blobs on the left, a spinning torus and a small orb on the right) that tilt with
// the pointer, and a glowing perspective grid floor running toward the horizon.
// Runs only on the home page (body.pre), at reduced resolution, pauses in background tabs, and draws a single
// still frame for people who prefer reduced motion. Without WebGL the CSS gradients stay as they are.
const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform float L; uniform float S;
// ---- noise for the aurora
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
// the colour of the sky in any direction: deep navy with drifting bands of indigo, blue, cyan and violet
vec3 sky(vec3 d) {
  vec2 q = d.xy * 1.6;
  float w = fbm(q + vec2(T * 0.035, -T * 0.02));
  float b = fbm(q * 1.7 + w * 2.2 + vec2(-T * 0.05, T * 0.03));
  vec3 c0 = mix(vec3(0.016, 0.024, 0.07), vec3(0.93, 0.95, 1.0), L);
  vec3 c1 = mix(vec3(0.16, 0.12, 0.62), vec3(0.62, 0.66, 1.0), L);   // indigo
  vec3 c2 = mix(vec3(0.07, 0.36, 0.95), vec3(0.55, 0.78, 1.0), L);   // blue
  vec3 c3 = mix(vec3(0.05, 0.75, 0.92), vec3(0.62, 0.92, 0.98), L);  // cyan
  vec3 c4 = mix(vec3(0.58, 0.2, 0.9), vec3(0.86, 0.72, 1.0), L);     // violet
  vec3 c = c0;
  c = mix(c, c1, smoothstep(0.3, 0.8, b) * 0.9);
  c = mix(c, c2, smoothstep(0.42, 0.9, w) * 0.8);
  c = mix(c, c3, smoothstep(0.5, 0.95, b * w * 1.9) * 0.6);
  c = mix(c, c4, smoothstep(0.45, 0.85, fbm(q * 0.8 - T * 0.02)) * 0.5);
  float top = smoothstep(-0.2, 0.9, d.y);
  return mix(c * (0.62 + 0.5 * top), c, L);
}
// ---- the 3D shapes
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdTorus(vec3 p, vec2 t) { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float map(vec3 p0, out float id) {
  float k = mix(1.7, 1.12, clamp((S - 1.05) / 2.0, 0.0, 1.0)); // smaller shapes on narrow screens
  vec3 p = p0 * k;
  float side = S * k;   // how far out to the sides the shapes sit (wider screens: further out)
  vec3 a = p - vec3(-side, 0.75, -0.6);
  float bl = length(a - vec3(0.0, sin(T * 0.7) * 0.25, 0.0)) - 1.05;
  bl = smin(bl, length(a - vec3(0.85 * cos(T * 0.5), -0.7 + 0.35 * sin(T * 0.9), 0.5 * sin(T * 0.5))) - 0.62, 0.55);
  bl = smin(bl, length(a - vec3(-0.6 + 0.3 * sin(T * 0.6), 0.95 * cos(T * 0.45), 0.3)) - 0.45, 0.5);
  vec3 b = p - vec3(side * 0.98, -0.55, -0.3);
  b.yz *= rot(T * 0.45 + 0.9); b.xy *= rot(T * 0.3);
  float to = sdTorus(b, vec2(0.82, 0.3));
  float orb = length(p - vec3(side * 0.72, 1.55 + 0.15 * sin(T * 1.1), -1.4)) - 0.32;
  float d = min(bl, min(to, orb));
  id = d == bl ? 0.0 : d == to ? 1.0 : 2.0;
  return d / k;
}
vec3 normal(vec3 p) { float i; vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(map(p + e.xyy, i) - map(p - e.xyy, i), map(p + e.yxy, i) - map(p - e.yxy, i), map(p + e.yyx, i) - map(p - e.yyx, i))); }
// iridescence locked to the brand: cyan → blue → violet → pink → back
vec3 irid(float t) {
  float x = fract(t) * 4.0;
  vec3 a = vec3(0.2, 0.85, 1.0), b = vec3(0.24, 0.42, 1.0), c = vec3(0.62, 0.36, 1.0), d = vec3(1.0, 0.45, 0.85);
  return x < 1.0 ? mix(a, b, x) : x < 2.0 ? mix(b, c, x - 1.0) : x < 3.0 ? mix(c, d, x - 2.0) : mix(d, a, x - 3.0);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * R) / R.y;
  vec3 ro = vec3(M.x * 0.6, M.y * 0.35, 6.0);
  vec3 rd = normalize(vec3(uv, -1.75));
  rd.xz *= rot(-M.x * 0.05); rd.yz *= rot(M.y * 0.04);
  vec3 col = sky(rd);
  // the grid floor, scrolling toward the viewer, fading into the haze
  if (rd.y < -0.02) {
    float t = (-2.6 - ro.y) / rd.y;
    vec2 g = (ro + rd * t).xz + vec2(0.0, T * 0.9);
    vec2 f = abs(fract(g * 0.5) - 0.5) / fwidthSafe(g);
    float line = 1.0 - min(min(f.x, f.y), 1.0);
    float fade = exp(-t * 0.055) * smoothstep(-0.02, -0.12, rd.y);
    vec3 gc = mix(mix(vec3(0.2, 0.55, 1.0), vec3(0.7, 0.35, 1.0), 0.5 + 0.5 * sin(g.x * 0.15 + T * 0.3)), vec3(0.3, 0.45, 0.9), L);
    col += gc * line * fade * mix(0.9, 0.45, L);
    col += gc * 0.12 * fade * (1.0 - L); // floor glow
  }
  // the horizon glow
  col += mix(vec3(0.15, 0.35, 0.9), vec3(0.4, 0.55, 1.0), L) * exp(-abs(rd.y + 0.03) * 22.0) * mix(0.35, 0.15, L);
  // ray-march the shapes
  float t = 0.0, id = 0.0, near = 9.0; bool hit = false;
  for (int i = 0; i < 80; i++) { vec3 p = ro + rd * t; float d = map(p, id); near = min(near, d / max(t, 0.5)); if (d < 0.002) { hit = true; break; } t += d; if (t > 20.0) break; }
  // a soft glow around each shape, which also hides the stair-steps on its edge
  if (!hit) col += mix(vec3(0.25, 0.45, 1.0), vec3(0.45, 0.55, 1.0), L) * exp(-near * 160.0) * 0.35;
  if (hit) {
    vec3 p = ro + rd * t, nr = normal(p), v = -rd;
    float fr = pow(1.0 - max(dot(nr, v), 0.0), 3.0);
    vec3 refl = sky(reflect(rd, nr));
    vec3 base = id < 0.5 ? irid(0.3 + 0.35 * dot(nr, vec3(0.3, 0.8, 0.2)) + T * 0.03)
              : id < 1.5 ? irid(0.1 + 0.4 * fr + T * 0.04) : vec3(0.75, 0.85, 1.0);
    vec3 ld = normalize(vec3(0.5, 0.8, 0.6));
    float dif = max(dot(nr, ld), 0.0), spec = pow(max(dot(reflect(-ld, nr), v), 0.0), 48.0);
    vec3 sh = base * (0.22 + 0.6 * dif) * mix(0.75, 0.9, L) + refl * (0.25 + 0.55 * fr) + vec3(1.0) * spec * 0.9;
    sh += irid(fr * 1.2 + T * 0.05 + 0.4) * fr * 0.55; // soap-film rim
    col = mix(col, sh, mix(0.92, 0.85, L));
  }
  // a soft vignette, and a calm centre so the headline stays readable
  float cx = smoothstep(0.75, 0.0, length(uv * vec2(0.9, 1.4)));
  col = mix(col, col * mix(0.72, 1.0, L) + mix(vec3(0.0), vec3(0.06), L), cx * 0.55);
  col *= mix(1.0 - 0.35 * dot(uv * 0.8, uv * 0.8), 1.0, L);
  gl_FragColor = vec4(col, 1.0);
}`;

export function startHero3D() {
  const box = document.querySelector('.backdrop');
  if (!box || box.querySelector('canvas.hero3d')) return;
  const cv = document.createElement('canvas'); cv.className = 'hero3d'; cv.setAttribute('aria-hidden', 'true');
  const gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return;
  gl.getExtension('OES_standard_derivatives');
  const hasDeriv = !!gl.getExtension('OES_standard_derivatives');
  const head = hasDeriv ? '#extension GL_OES_standard_derivatives : enable\n' : '';
  const fw = hasDeriv ? 'vec2 fwidthSafe(vec2 g) { return max(fwidth(g) * 1.2, vec2(1e-4)); }\n' : 'vec2 fwidthSafe(vec2 g) { return vec2(0.02); }\n';
  const src = head + FRAG.replace('// ---- noise for the aurora', fw + '// ---- noise');
  const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, src));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { console.warn('[hero3d]', e.message); return; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(['R', 'T', 'M', 'L', 'S'].map((k) => [k, gl.getUniformLocation(prog, k)]));
  box.prepend(cv); box.classList.add('gl');

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', (e) => { mouse.tx = (e.clientX / innerWidth - 0.5) * 2; mouse.ty = -(e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  let scale = 0.7, w = 0, h = 0, raf = 0, t0 = performance.now(), slow = 0;
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = Math.max(2, Math.round(innerWidth * dpr * scale)); h = Math.max(2, Math.round(innerHeight * dpr * scale));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
  }
  addEventListener('resize', size);
  const on = () => document.body.classList.contains('pre') && !document.hidden;
  function frame(now) {
    raf = 0;
    if (!on()) return;
    const t = (now - t0) / 1000;
    mouse.x += (mouse.tx - mouse.x) * 0.04; mouse.y += (mouse.ty - mouse.y) * 0.04;
    size();
    const aspect = innerWidth / innerHeight;
    gl.uniform2f(U.R, w, h); gl.uniform1f(U.T, still.matches ? 12 : t); gl.uniform2f(U.M, mouse.x, mouse.y);
    gl.uniform1f(U.L, document.documentElement.dataset.theme === 'light' ? 1 : 0);
    gl.uniform1f(U.S, Math.max(1.05, Math.min(3.7, aspect * 1.78)));
    const a = performance.now();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // a slow GPU gets a smaller canvas instead of a janky page
    if (performance.now() - a > 22 && scale > 0.3) { if (++slow > 20) { scale -= 0.1; slow = 0; } } else slow = 0;
    if (!still.matches) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && on()) raf = requestAnimationFrame(frame); };
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(kick).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', kick);
  still.addEventListener?.('change', kick);
  kick();
}
