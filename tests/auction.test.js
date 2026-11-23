// Live auction, giveaway, shoutout and raid, end to end in two browsers: the host runs them from the studio
// panels, a viewer bids / enters from the action bar under the video on the watch page.
const { chromium } = require('playwright');
const SP = process.argv[2] || '/tmp';
const BASE = process.env.GATHER_URL || 'http://localhost:8080';
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };
const wait = (p, fn, arg, ms = 12000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
const signUp = async (page, name) => {
  if (!(await page.isVisible('#wSignDlg'))) await page.click('#wMe');
  await page.waitForSelector('#wSignDlg[open]');
  if (!(await page.isVisible('#wSignNameRow'))) await page.click('#wSignMode');
  await page.fill('#wSignName', name); await page.fill('#wSignEmail', `${name.toLowerCase()}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.fill('#wSignPass', 'correct horse battery'); await page.check('#wSignAgree'); await page.click('#wSignGo');
  await page.waitForFunction(() => !document.querySelector('#wSignDlg').open, null, { timeout: 10000 });
};

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const errs = [];
  const mk = async (vp = { width: 1440, height: 900 }) => { const p = await (await browser.newContext({ viewport: vp })).newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p; };
  try {
    const a = await mk();
    await a.goto(BASE + '/'); await a.click('#enterStage'); await a.click('#wGo'); await a.waitForSelector('#enterDlg[open]'); await a.fill('#enterName', 'Alex Host'); await a.click('#enterGo');
    await a.waitForFunction(() => !!window.__gather?.studio && !document.querySelector('#enterDlg')?.open, null, { timeout: 15000 }); const code = (await a.evaluate(() => window.__gather.studio)).trim(); await a.keyboard.press('Escape');

    const v = await mk({ width: 390, height: 844 });
    await v.goto(`${BASE}/w/${code}`);
    await signUp(v, 'Jordan');

    // 1 Auction from the Shop panel; the viewer bids from the bar under the video.
    await a.click('[data-tab="shop"]');
    check('the Shop panel has jump chips for the new sections', await a.isVisible('.panel[data-panel="shop"] .ph-chip[data-sec="shop-auction"]'));
    await a.fill('#auTitle', 'Signed vinyl'); await a.fill('#auStart', '$10'); await a.fill('#auInc', '$5'); await a.selectOption('#auSec', '120'); await a.click('#auGo');
    check('host: auction is live in the panel', await wait(a, () => !document.querySelector('#auLive').hidden));
    check('viewer: the auction appears under the video', await wait(v, () => /Signed vinyl · \$10/.test(document.querySelector('#wActs')?.textContent || '')));
    await v.click('#wActs [data-kind="auction"] .btn.primary'); // Bid $10
    check('viewer: bidding makes them the leader', await wait(v, () => /You’re winning/.test(document.querySelector('#wActs').textContent)));
    check('host: the panel shows who leads', await wait(a, () => /Jordan leads/.test(document.querySelector('#auLeader').textContent)));
    await a.screenshot({ path: SP + '/auction-host.png' });
    await v.screenshot({ path: SP + '/auction-viewer.png' });
    await a.click('#auEnd');
    check('viewer: wins and can pay', await wait(v, () => /You won!/.test(document.querySelector('#wActs').textContent) && /Pay \$10/.test(document.querySelector('#wActs').textContent)));
    check('the win is announced in the watch chat', await wait(v, () => /SOLD! Jordan won Signed vinyl/.test(document.querySelector('#wMsgs')?.textContent || '')));

    // Sales this show: the win lands in the host's live seller report, and the CSV carries the line.
    await a.click('#salesRefresh');
    check('host: sales panel counts the auction win', await wait(a, () => /1 · \$10/.test([...document.querySelectorAll('#salesTiles .sales-tile')].find((t) => /Auctions/.test(t.textContent))?.textContent || '')));
    check('host: sales total and top buyer', await wait(a, () => /\$10/.test(document.querySelector('#salesTiles .sales-tile .num')?.textContent || '') && /Jordan · \$10/.test(document.querySelector('#salesBuyers')?.textContent || '')));
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#salesCsv')]);
    const csv = require('node:fs').readFileSync(await dl.path(), 'utf8');
    check('host: the CSV has the auction line', /Auction win,Jordan,Signed vinyl,10\.00,awaiting payment/.test(csv), csv.slice(0, 200));
    await a.screenshot({ path: SP + '/sales-host.png' });

    // 2 Giveaway.
    await a.fill('#gwPrize', 'Free hoodie'); await a.click('#gwGo');
    check('viewer: can enter the giveaway', await wait(v, () => !!document.querySelector('#wActs [data-kind="giveaway"] .btn.primary')));
    await v.click('#wActs [data-kind="giveaway"] .btn.primary');
    check('host: the entry is counted', await wait(a, () => document.querySelector('#gwCount').textContent === '1'));
    await a.click('#gwDraw');
    check('viewer: the only entrant wins', await wait(v, () => /You won! The host will be in touch/.test(document.querySelector('#wActs').textContent)));

    // 3 Shoutout and raid from the Play panel.
    await a.click('[data-tab="show"]'); await a.click('.aud-seg:visible [data-aud="gaming"]');
    await a.fill('#soName', 'PixelPete'); await a.fill('#soUrl', '/w/pixelpete'); await a.fill('#soGame', 'Rocket League'); await a.click('#soGo');
    check('viewer: shoutout with a follow link', await wait(v, () => { const r = document.querySelector('#wActs [data-kind="shoutout"]'); return r && /PixelPete/.test(r.textContent) && r.querySelector('a')?.getAttribute('href') === '/w/pixelpete'; }));
    await a.click('#soRaid');
    check('viewer: the raid counts down', await wait(v, () => /Heading to PixelPete/.test(document.querySelector('#wActs').textContent)));
    await v.screenshot({ path: SP + '/raid-viewer.png' });
    await v.click('#wActs [data-kind="raid"] .btn.primary'); // Go now
    check('viewer: “Go now” goes to the raided show', await wait(v, () => location.pathname === '/w/pixelpete' && /raid=/.test(location.search)));

    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  await browser.close();
  console.log('errors', JSON.stringify(errs));
  process.exit(ok ? 0 : 1);
})();
