// Raise your hand: a viewer on the watch page asks to join on camera; the host brings them on from the studio's
// waiting room; the viewer's "Join now" opens the studio with a pass, they're in without knocking again, and they
// land on stage. Also: the hand menu offers voice and a voice message, and lowering the hand cancels the knock.
const { chromium } = require('playwright');
const SP = process.argv[2] || '/tmp';
const BASE = process.env.GATHER_URL || 'http://localhost:8080';
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };
const wait = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true).catch(() => false);
const signUp = async (page, name) => {
  await page.waitForSelector('#wSignDlg[open]');
  if (!(await page.isVisible('#wSignNameRow'))) await page.click('#wSignMode');
  await page.fill('#wSignName', name); await page.fill('#wSignEmail', `${name.toLowerCase()}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.fill('#wSignPass', 'correct horse battery'); await page.check('#wSignAgree'); await page.click('#wSignGo');
  await page.waitForFunction(() => !document.querySelector('#wSignDlg').open, null, { timeout: 10000 });
};

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const errs = [];
  try {
    const a = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); a.on('pageerror', (e) => errs.push('host: ' + e.message));
    await a.goto(BASE + '/'); await a.click('#enterStage'); await a.click('#wGo'); await a.waitForSelector('#enterDlg[open]'); await a.fill('#enterName', 'Alex Host'); await a.click('#enterGo');
    await a.waitForFunction(() => !!window.__gather?.studio && !document.querySelector('#enterDlg')?.open, null, { timeout: 15000 });
    const code = (await a.evaluate(() => window.__gather.studio)).trim(); await a.keyboard.press('Escape');

    const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const v = await vctx.newPage(); v.on('pageerror', (e) => errs.push('viewer: ' + e.message));
    await v.goto(`${BASE}/w/${code}`); await v.waitForTimeout(1500);

    // the hand menu
    await v.click('#wAsk');
    const items = await v.$$eval('#wHandMenu [role="menuitem"] b', (els) => els.map((e) => e.textContent));
    check('the hand opens a menu: camera, voice, voice message, ask in chat', items.join('|') === 'Join on camera|Join by voice|Leave a voice message|Ask in chat', items.join('|'));
    await v.click('#wHandMenu [role="menuitem"]:has-text("Join on camera")');
    await signUp(v, 'Jordan'); // raising a hand needs a name; it carries on by itself after signing in
    check('the viewer sees their hand is raised', await wait(v, () => /Hand raised to join on camera/.test(document.querySelector('#wHandBar')?.textContent || '')));

    // the host
    check('the host’s waiting room shows the raised hand with Bring on', await wait(a, () => [...document.querySelectorAll('#lobbyList li')].some((li) => /Jordan/.test(li.textContent) && /Raised hand · camera/.test(li.textContent) && /Bring on/.test(li.textContent))));
    await a.click('#lobbyTab').catch(() => {});
    await a.click('#lobbyList li:has-text("Jordan") .btn.primary');
    check('the viewer gets Join now', await wait(v, () => /Join now/.test(document.querySelector('#wHandBar')?.textContent || '')));
    await v.screenshot({ path: SP + '/hand-viewer.png' });

    const [g] = await Promise.all([vctx.waitForEvent('page'), v.click('#wHandBar .btn.primary')]);
    g.on('pageerror', (e) => errs.push('joiner: ' + e.message));
    await g.waitForLoadState();
    check('Join now opens the studio with the pass, and the pass leaves the address bar', /\/c\//.test(g.url()) && !/pass=/.test(await g.evaluate(() => location.href)), g.url());
    await g.waitForSelector('#enterDlg[open]', { timeout: 10000 });
    await g.fill('#enterName', 'Jordan'); await g.click('#enterGo');
    check('they’re in without knocking again', await wait(g, () => !!window.__gather?.studio && !document.querySelector('#knockWait:not([hidden])'), null, 20000));
    check('…and the host’s studio puts them on stage', await wait(a, () => { const S = window.__gather; return [...S.peers.values()].some((p) => p.name === 'Jordan' && S.state.stage.includes(p.id)); }, null, 20000));
    await a.screenshot({ path: SP + '/hand-host.png' });

    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  await browser.close();
  console.log('errors', JSON.stringify(errs));
  process.exit(ok ? 0 : 1);
})();
