// Background blur / replacement keeps the person whole and in sync while they move.
// A stand-in segmenter treats red pixels as the person (and, like the real model on a laptop, takes ~25 ms a
// frame); a fake camera moves a red "person" across a grey room. Every output frame we measure:
//   kept  = how much of the person survives the cutout (cut-away person shows the blue replacement instead)
//   ghost = how much grey room is left behind where the person just was (a lagging mask)
// The person is always 90×200 px, so both are counted over the whole frame: camera latency doesn't matter.
const { chromium } = require('playwright');
const BASE = process.env.GATHER_URL || 'http://localhost:8080';
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };

async function scenario(page, { move, segMs, frames = 120 }) {
  return page.evaluate(async ({ move, segMs, frames }) => {
    const W = 640, H = 360;
    const probe = document.createElement('canvas'); probe.width = probe.height = 256;
    const pg = probe.getContext('2d', { willReadFrequently: true });
    globalThis.__gatherTestSegmenter = {
      segmentForVideo(img) {
        const t0 = performance.now(); while (performance.now() - t0 < segMs) { /* model cost */ }
        pg.drawImage(img, 0, 0, 256, 256);
        const d = pg.getImageData(0, 0, 256, 256).data, bg = new Float32Array(256 * 256);
        for (let i = 0; i < bg.length; i++) bg[i] = d[i * 4] > 150 && d[i * 4 + 1] < 90 ? 0 : 1;
        return { confidenceMasks: [{ getAsFloat32Array: () => bg }], close() {} };
      },
    };
    const cam = document.createElement('canvas'); cam.width = W; cam.height = H;
    const cg = cam.getContext('2d');
    const t0 = performance.now();
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const x = move === 'sweep'
        ? 40 + (W - 170) * (0.5 - 0.5 * Math.cos(t * Math.PI * 0.6))   // across the frame and back, ~3.3 s
        : 275 + 35 * Math.sin(t * Math.PI * 2 * 1.7) + 12 * Math.sin(t * Math.PI * 2 * 4.1); // small quick sways
      cg.fillStyle = '#8a8f96'; cg.fillRect(0, 0, W, H);
      cg.fillStyle = '#e01010'; cg.fillRect(x, 120, 90, 200);
    };
    draw(); const camTimer = setInterval(draw, 1000 / 30);
    const track = cam.captureStream(30).getVideoTracks()[0];
    const { createVideoFx } = await import('/fx.js?' + Math.random());
    const blue = document.createElement('canvas'); blue.width = W; blue.height = H;
    const bctx = blue.getContext('2d'); bctx.fillStyle = '#0000ff'; bctx.fillRect(0, 0, W, H);
    const fx = await createVideoFx(track, { effect: 'image', bgImage: blue });
    await new Promise((res) => setTimeout(res, 1500));
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const og = out.getContext('2d', { willReadFrequently: true });
    const kept = [], ghost = [];
    for (let f = 0; f < frames; f++) {
      await new Promise((res) => setTimeout(res, 33));
      og.drawImage(fx.canvas, 0, 0, W, H);
      const d = og.getImageData(0, 0, W, H).data;
      let red = 0, grey = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2];
        if (R > 120 && G < 90 && B < 90) red++;
        else if (Math.abs(R - G) < 24 && Math.abs(G - B) < 24 && R > 90 && R < 190) grey++;
      }
      kept.push(Math.min(1, red / 18000)); ghost.push(grey / 18000);
    }
    clearInterval(camTimer); fx.stop(); delete globalThis.__gatherTestSegmenter;
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { mean: mean(kept), ghost: mean(ghost), worstGhost: Math.max(...ghost), worst: Math.min(...kept), bad: kept.filter((k) => k < 0.85).length, frames: kept.length };
  }, { move, segMs, frames });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(`${BASE}/ui-kit.html`);
    for (const [name, opts] of [['sweeping across the frame', { move: 'sweep', segMs: 4 }], ['small quick movements, slow model (25 ms)', { move: 'sway', segMs: 25 }]]) {
      const r = await scenario(page, opts);
      console.log(`${name}: person kept ${(r.mean * 100).toFixed(1)}% (worst ${(r.worst * 100).toFixed(1)}%), frames under 85%: ${r.bad}/${r.frames}, ghost ${(r.ghost * 100).toFixed(1)}% (worst ${(r.worstGhost * 100).toFixed(1)}%)`);
      check(`${name}: the person stays whole (mean ≥ 97%)`, r.mean >= 0.97, (r.mean * 100).toFixed(1) + '%');
      check(`${name}: never cut away (no frame under 85%)`, r.bad === 0, `${r.bad} frames`);
      check(`${name}: no trailing ghost (mean ≤ 3% of a person)`, r.ghost <= 0.03, (r.ghost * 100).toFixed(1) + '%');
    }
    check('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
