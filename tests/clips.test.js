// Clip & post: the studio keeps the last minute of the program, so a marked moment holds the real highlight, and
// exporting it saves a playable video (9:16 or 16:9). Before this, export threw (it drew a <div>) and recorded the
// next 5 s instead of the marked moment.
const { chromium } = require('playwright');
const fs = require('node:fs');
const SP = process.argv[2] || '/tmp';
const BASE = process.env.GATHER_URL || 'http://localhost:8080';
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const errs = [];
  try {
    const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage(); a.on('pageerror', (e) => errs.push(e.message));
    await a.goto(BASE + '/'); await a.click('#enterStage'); await a.click('#wGo'); await a.waitForSelector('#enterDlg[open]'); await a.fill('#enterName', 'Alex Host'); await a.click('#enterGo');
    await a.waitForFunction(() => !!window.__gather?.studio && !document.querySelector('#enterDlg')?.open, null, { timeout: 15000 }); await a.keyboard.press('Escape');

    check('the clip buffer starts for the host', await a.waitForFunction(() => window.__gatherClips?.running, null, { timeout: 10000 }).then(() => true).catch(() => false));
    await a.waitForTimeout(12000); // a couple of segments before the mark
    await a.hover('#stage', { position: { x: 400, y: 300 } }); await a.click('#stageClipBtn');
    check('Mark clip adds a moment that’s capturing', await a.evaluate(() => window.__gatherClips.moments[0]?.state === 'capturing'));
    const ready = await a.waitForFunction(() => window.__gatherClips.moments[0]?.state === 'ready', null, { timeout: 20000 }).then(() => true).catch(() => false);
    const info = await a.evaluate(() => { const m = window.__gatherClips.moments[0]; return { state: m.state, segs: m.blobs.length, bytes: m.blobs.reduce((t, b) => t + b.size, 0), dur: m.dur }; });
    check('the moment holds the video from before the mark', ready && info.segs >= 3 && info.bytes > 50_000 && info.dur >= 15, JSON.stringify(info));

    await a.click('[data-tab="layouts"]').catch(() => {}); // Stage panel holds Clip & post
    await a.evaluate(() => { document.querySelector('#clipPostSec')?.closest('[data-panel]') && (document.querySelector('#clipPostSec').closest('[data-panel]').hidden = false); document.querySelector('#clipPostSec').open = true; });
    const [dl] = await Promise.all([a.waitForEvent('download', { timeout: 90000 }), a.click('#momentList .clip-row button:has-text("9:16")')]);
    const file = await dl.path(); const size = fs.statSync(file).size;
    fs.copyFileSync(file, SP + '/clip-9x16.webm');
    check('9:16 export saves a real video file', /gather-short-.*\.webm$/.test(dl.suggestedFilename()) && size > 100_000, `${dl.suggestedFilename()} ${size} bytes`);

    // the saved clip plays and is vertical
    const meta = await a.evaluate(async (b64) => {
      const v = document.createElement('video'); v.muted = true; v.src = 'data:video/webm;base64,' + b64;
      await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 8000); });
      return { w: v.videoWidth, h: v.videoHeight };
    }, fs.readFileSync(file).toString('base64'));
    check('the clip is 540x960', meta.w === 540 && meta.h === 960, JSON.stringify(meta));

    // Instant replay: the last 30 s play on stage, then the scene comes back by itself.
    await a.evaluate(() => document.querySelector('#stageReplayBtn').click());
    const started = await a.waitForFunction(() => window.__gather.local.pres?.kind === 'replay', null, { timeout: 5000 }).then(() => true).catch(() => false);
    const scene = await a.evaluate(() => window.__gather.state.elements.some((e) => e.type === 'media'));
    check('Replay plays the last 30 s on stage', started && scene);
    const ended = await a.waitForFunction(() => !window.__gather.local.pres, null, { timeout: 60000 }).then(() => true).catch(() => false);
    check('…and hands the stage back by itself', ended && !(await a.evaluate(() => window.__gather.state.elements.some((e) => e.type === 'media' && !e.hidden))));
    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  await browser.close();
  console.log('errors', JSON.stringify(errs));
  process.exit(ok ? 0 : 1);
})();
