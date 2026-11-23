// Background replacement keeps up with a person who moves. The segmenter only sees a crop that follows the
// person; if that crop lags, whatever just left it is cut away (an arm, a shoulder) for several frames.
// A stand-in segmenter treats red pixels as the person, a fake camera sweeps a red "person" across a grey room,
// and every frame we measure how much of the person survives the cutout.
const { chromium } = require('playwright');
const BASE = process.env.GATHER_URL || 'http://localhost:8080';
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(`${BASE}/ui-kit.html`);
    const r = await page.evaluate(async () => {
      const W = 640, H = 360;
      // Stand-in for MediaPipe: background confidence 0 on red pixels, 1 elsewhere. Same API as ImageSegmenter.
      const probe = document.createElement('canvas'); probe.width = probe.height = 256;
      const pg = probe.getContext('2d', { willReadFrequently: true });
      globalThis.__gatherTestSegmenter = {
        segmentForVideo(img) {
          pg.drawImage(img, 0, 0, 256, 256);
          const d = pg.getImageData(0, 0, 256, 256).data, bg = new Float32Array(256 * 256);
          for (let i = 0; i < bg.length; i++) bg[i] = d[i * 4] > 150 && d[i * 4 + 1] < 90 ? 0 : 1;
          return { confidenceMasks: [{ getAsFloat32Array: () => bg }], close() {} };
        },
      };
      // The camera: a 90×200 red person sweeping across the frame and back every ~3.3 s (up to ~440 px/s: a quick lean).
      const cam = document.createElement('canvas'); cam.width = W; cam.height = H;
      const cg = cam.getContext('2d');
      let t0 = performance.now(), personX = 40;
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        personX = 40 + (W - 170) * (0.5 - 0.5 * Math.cos(t * Math.PI * 0.6));
        cg.fillStyle = '#8a8f96'; cg.fillRect(0, 0, W, H);
        cg.fillStyle = '#e01010'; cg.fillRect(personX, 120, 90, 200);
      };
      draw(); const camTimer = setInterval(draw, 1000 / 30);
      const track = cam.captureStream(30).getVideoTracks()[0];
      const { createVideoFx } = await import('/fx.js');
      // "Picture" mode over a solid blue background: kept person = red, cut-away person = blue.
      const blue = document.createElement('canvas'); blue.width = W; blue.height = H;
      const bctx = blue.getContext('2d'); bctx.fillStyle = '#0000ff'; bctx.fillRect(0, 0, W, H);
      const fx = await createVideoFx(track, { effect: 'image', bgImage: blue });
      await new Promise((res) => setTimeout(res, 1500)); // settle
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const og = out.getContext('2d', { willReadFrequently: true });
      // Position-free measures (camera latency doesn't matter): the person is always 90×200 px, so
      //   kept  = red pixels in the output / 18000   (person cut away shows the blue picture instead)
      //   ghost = grey room pixels left in the output / 18000   (background wrongly kept as person)
      const kept = [], ghost = [];
      for (let f = 0; f < 120; f++) {
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
      clearInterval(camTimer); fx.stop();
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      return { mean: mean(kept), ghost: mean(ghost), worst: Math.min(...kept), bad: kept.filter((k) => k < 0.85).length, frames: kept.length };
    });
    console.log(`person kept: mean ${(r.mean * 100).toFixed(1)}% · worst frame ${(r.worst * 100).toFixed(1)}% · frames under 85%: ${r.bad}/${r.frames} · ghost background: ${(r.ghost * 100).toFixed(1)}% of a person`);
    check('a moving person stays in the picture (mean ≥ 95%)', r.mean >= 0.95, (r.mean * 100).toFixed(1) + '%');
    check('no stretch of frames where they are cut away (≤ 5 frames under 85%)', r.bad <= 5, `${r.bad} frames`);
    check('little background is left behind as a ghost (≤ 10% of a person)', r.ghost <= 0.1, (r.ghost * 100).toFixed(1) + '%');
    check('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
