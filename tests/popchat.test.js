// Pop-out chat: the host opens the viewer chat in its own window (or on a phone by QR). The window is the watch
// page's chat only (/w/<studio>?chat=1): no video is pulled, and viewers' messages arrive in it live.
const { chromium } = require('playwright');
const SP = process.argv[2] || '/tmp';
const BASE = process.env.GATHER_URL || 'http://localhost:8080';
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };
const wait = (p, fn, arg, ms = 12000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
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
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const a = await ctx.newPage(); a.on('pageerror', (e) => errs.push(e.message));
    await a.goto(BASE + '/'); await a.click('#enterStage'); await a.click('#wGo'); await a.waitForSelector('#enterDlg[open]'); await a.fill('#enterName', 'Alex Host'); await a.click('#enterGo');
    await a.waitForFunction(() => !!window.__gather?.studio && !document.querySelector('#enterDlg')?.open, null, { timeout: 15000 });
    const code = (await a.evaluate(() => window.__gather.studio)).trim(); await a.keyboard.press('Escape');

    await a.click('[data-tab="chat"]'); await a.click('#chatOptsBtn');
    const [pop] = await Promise.all([ctx.waitForEvent('page'), a.click('#optPopChat')]);
    pop.on('pageerror', (e) => errs.push('popup: ' + e.message));
    let joins = 0; pop.on('request', (r) => { if (/wrtcJoin/.test(r.postData() || '')) joins++; });
    await pop.waitForLoadState();
    check('pop out opens the chat-only watch page', /^\/w\/[\w-]+$/.test(new URL(pop.url()).pathname) && new URL(pop.url()).searchParams.get('chat') === '1', pop.url());
    await pop.waitForTimeout(2500);
    check('the popup shows the chat and nothing else', await pop.evaluate(() => {
      const c = document.querySelector('#wChat').getBoundingClientRect();
      return document.documentElement.classList.contains('chat-only') && c.width === innerWidth && c.height === innerHeight && !document.querySelector('.wv-stagecol')?.offsetParent;
    }));
    check('the popup pulls no video (no viewer seat used)', joins === 0);

    const v = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); v.on('pageerror', (e) => errs.push('viewer: ' + e.message));
    await v.goto(`${BASE}/w/${code}`);
    await v.fill('#wText', 'Hello from a viewer'); await v.click('#wSend');
    await signUp(v, 'Jordan');
    check('a viewer’s message arrives in the popup', await wait(pop, () => /Hello from a viewer/.test(document.querySelector('#wMsgs')?.textContent || ''), null, 15000));
    await pop.screenshot({ path: SP + '/popchat-window.png' });

    await a.click('#optPhoneChat');
    check('“On your phone” draws a QR code', await wait(a, () => { const i = document.querySelector('#optChatQr img'); return !document.querySelector('#optChatQr').hidden && /^data:image\//.test(i?.src || '') && i.naturalWidth > 0; }));
    await a.screenshot({ path: SP + '/popchat-qr.png' });

    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  await browser.close();
  console.log('errors', JSON.stringify(errs));
  process.exit(ok ? 0 : 1);
})();
