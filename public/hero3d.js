// The home page backdrop, drawn live with WebGL: soft, heavily blurred gradient light drifting slowly behind
// the page, and a few floating panes of frosted glass that bend and blur that light, catch a moving highlight
// along their edges, and tilt in 3D with the pointer. Everything is tinted from the user's accent colour.
// Runs only on the home page (body.pre), at reduced resolution, pauses in background tabs, and draws one still
// frame for people who prefer reduced motion. Without WebGL the CSS gradients underneath stay as they are.
const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform float L; uniform vec3 A; uniform float AS;
// ---- the light: five big blurred blobs of colour moving on slow orbits
vec3 hue(vec3 c, float a) { // rotate a colour's hue (keeps the palette related to the accent)
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
float blob(vec2 p, vec2 c, float r) { vec2 d = p - c; return exp(-dot(d, d) / (r * r)); }
vec3 light(vec2 p, float soft) {
  float t = T * 0.06;
  vec3 base = mix(vec3(0.016, 0.02, 0.04), vec3(0.965, 0.97, 0.985), L);
  vec3 cs[5]; cs[0] = A; cs[1] = hue(A, 0.65); cs[2] = hue(A, -0.55); cs[3] = mix(A, vec3(1.0), 0.45); cs[4] = hue(A, 1.4);
  float r = 0.55 * soft;
  float w[5];
  w[0] = 1.0  * blob(p, vec2(-0.8 + 0.18 * sin(t * 1.3), 0.38 + 0.12 * cos(t * 1.1)), r * 1.25);
  w[1] = 0.85 * blob(p, vec2(0.88 + 0.15 * cos(t * 0.9), 0.3 + 0.16 * sin(t * 1.2)), r * 1.1);
  w[2] = 0.6  * blob(p, vec2(0.15 * sin(t * 0.7), -0.7 + 0.1 * cos(t)), r * 1.5);
  w[3] = 0.3  * blob(p, vec2(0.25 + 0.2 * cos(t * 1.4), 0.66), r * 0.9);
  w[4] = 0.45 * blob(p, vec2(-0.45 + 0.25 * cos(t * 0.6), -0.35 + 0.2 * sin(t * 0.8)), r * 1.2);
  vec3 col = base;
  for (int i = 0; i < 5; i++) {
    if (L > 0.5) col = mix(col, mix(cs[i], vec3(1.0), 0.42), w[i] * 0.5);   // light: pastel washes
    else col += cs[i] * w[i] * 0.3;                                          // dark: glowing light
  }
  return col;
}
// ---- glass panes: rounded rectangles floating at different depths
float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float pane(vec2 uv, int i, out vec2 local) {
  float t = T;
  vec2 c; vec2 b; float a; float depth;
  if (i == 0)      { c = vec2(-1.0 * AS, 0.2);  b = vec2(0.17, 0.23); a = -0.16; depth = 0.9; }
  else if (i == 1) { c = vec2(1.02 * AS, -0.05); b = vec2(0.16, 0.21);  a = 0.14;  depth = 1.2; }
  else if (i == 2) { c = vec2(-0.78 * AS, -0.5); b = vec2(0.09, 0.09); a = 0.32; depth = 0.6; }
  else             { c = vec2(0.78 * AS, 0.6);  b = vec2(0.09, 0.06); a = -0.2;  depth = 0.5; }
  float fi = float(i);
  c += vec2(sin(t * 0.21 + fi * 1.7), cos(t * 0.17 + fi * 2.3)) * 0.025 + M * 0.035 * depth; // drift + parallax
  a += sin(t * 0.13 + fi) * 0.05 + M.x * 0.05 * depth;
  // a little perspective: the pane leans away from the pointer
  vec2 q = uv - c;
  q *= 1.0 + vec2(M.y, -M.x).yx * 0.08 * depth * q.yx;
  local = rot(a) * q;
  return box(local, b, 0.075);
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * R) / R.y;
  vec2 p = uv + M * 0.02;
  vec3 col = light(p, 1.0);
  // panes, back to front
  for (int i = 0; i < 4; i++) {
    vec2 lp; float d = pane(uv, i, lp);
    float inside = 1.0 - smoothstep(-0.002, 0.003, d);
    if (inside <= 0.0) {
      // a soft shadow under the pane
      col *= 1.0 - mix(0.07, 0.06, L) * exp(-max(d, 0.0) * 22.0) * smoothstep(0.0, 0.02, d);
      col *= 1.0 - L * 0.05 * smoothstep(0.004, 0.0, d); // a hairline edge so light-mode glass reads
      continue;
    }
    // frosted: the light behind it, bent toward the edges and much softer
    float edge = clamp(-d / 0.09, 0.0, 1.0);
    vec2 n = normalize(lp + 1e-4) * (1.0 - edge);
    vec3 g = light(p + n * 0.06, 1.9);
    g = mix(g, vec3(1.0), mix(0.05, 0.22, L)); g *= mix(1.25, 1.0, L); // milky tint; a touch brighter than what's behind it
    // a highlight that sweeps slowly across the glass
    float sweep = smoothstep(0.05, 0.0, abs(lp.x * 0.8 + lp.y - mod(T * 0.12 + float(i) * 0.7, 2.4) + 1.2)) * 0.12;
    // bright rim, stronger along the top-left edge (light from above)
    float rim = smoothstep(0.0035, 0.0, abs(d + 0.0018)) * (0.25 + 0.75 * clamp(0.5 + lp.y * 2.0 - lp.x, 0.0, 1.0));
    float body = 0.5 + 0.5 * clamp(lp.y * 3.0, -1.0, 1.0); // lighter toward the top: the glass has thickness
    vec3 paneCol = g * mix(0.96, 1.04, body) + vec3(sweep * 0.6) + vec3(rim) * mix(0.3, 0.22, L);
    col = mix(col, paneCol, inside * mix(0.5, 0.8, L));
  }
  // fine grain so the gradients never band
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + T) * 43758.5453) - 0.5;
  col += grain * 0.012;
  // keep the middle calm for the headline, and a gentle vignette
  float mid = exp(-dot(uv * vec2(0.85, 1.6), uv * vec2(0.85, 1.6)) * 2.2);
  col = mix(col, mix(col * 0.7, col * 0.98 + 0.02, L), mid * 0.45);
  col *= mix(1.0 - 0.28 * dot(uv * 0.75, uv * 0.75), 1.0, L);
  gl_FragColor = vec4(col, 1.0);
}`;

function accentRgb() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
  const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#3b82f6'; c.fillStyle = raw;
  const hex = c.fillStyle; // the browser normalises any CSS colour to #rrggbb here
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x3b82f6;
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function startHero3D() {
  const box = document.querySelector('.backdrop');
  if (!box || box.querySelector('canvas.hero3d')) return;
  const cv = document.createElement('canvas'); cv.className = 'hero3d'; cv.setAttribute('aria-hidden', 'true');
  const gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return;
  const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { console.warn('[hero3d]', e.message); return; }
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(['R', 'T', 'M', 'L', 'A', 'AS'].map((k) => [k, gl.getUniformLocation(prog, k)]));
  box.prepend(cv); box.classList.add('gl');

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', (e) => { mouse.tx = (e.clientX / innerWidth - 0.5) * 2; mouse.ty = -(e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  let scale = 0.75, w = 0, h = 0, raf = 0, slow = 0, accent = accentRgb();
  const t0 = performance.now();
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
    mouse.x += (mouse.tx - mouse.x) * 0.035; mouse.y += (mouse.ty - mouse.y) * 0.035;
    size();
    const aspect = innerWidth / innerHeight;
    gl.uniform2f(U.R, w, h); gl.uniform1f(U.T, still.matches ? 20 : (now - t0) / 1000); gl.uniform2f(U.M, mouse.x, mouse.y);
    gl.uniform1f(U.L, document.documentElement.dataset.theme === 'light' ? 1 : 0);
    gl.uniform3f(U.A, accent[0], accent[1], accent[2]);
    gl.uniform1f(U.AS, Math.max(0.42, Math.min(1.0, aspect * 0.55))); // panes hug the sides on wide screens
    const a = performance.now();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (performance.now() - a > 20 && scale > 0.35) { if (++slow > 20) { scale -= 0.1; slow = 0; } } else slow = 0;
    if (!still.matches) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf && on()) raf = requestAnimationFrame(frame); };
  new MutationObserver(kick).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // a new theme or accent colour re-tints the scene
  new MutationObserver(() => { accent = accentRgb(); kick(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] });
  document.addEventListener('visibilitychange', kick);
  still.addEventListener?.('change', kick);
  kick();
}

/** The studio preview on the home page leans toward the pointer, like a pane of glass held in the hand. */
export function tiltPreview() {
  const win = document.querySelector('.land-art .hz-win');
  if (!win || matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(hover: none)').matches) return;
  let raf = 0, tx = 0, ty = 0, x = 0, y = 0;
  const step = () => {
    x += (tx - x) * 0.08; y += (ty - y) * 0.08;
    win.style.setProperty('--rx', (y * -5).toFixed(2) + 'deg'); win.style.setProperty('--ry', (x * 7).toFixed(2) + 'deg');
    win.style.setProperty('--gx', (50 + x * 30).toFixed(1) + '%'); win.style.setProperty('--gy', (40 + y * 30).toFixed(1) + '%');
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0;
  };
  addEventListener('pointermove', (e) => {
    if (!document.body.classList.contains('pre')) return;
    tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5;
    if (!raf) raf = requestAnimationFrame(step);
  }, { passive: true });
}
