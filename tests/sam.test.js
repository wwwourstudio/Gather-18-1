// The watch chat never starts empty, and viewers can ask Sam. The first message is the streamer's welcome, then
// Sam's hello and one-tap starters. "@Sam …" goes to Sam (wsam); this test server has no house AI key, so the
// viewer gets a clear "not switched on" answer and their question stays in the box. (The answer path itself, with
// a key, is covered by calling lib/ai.js viewerAnswer with a stubbed provider at the end.)
const { chromium } = require('playwright');
const path = require('node:path');
const SP = process.argv[2] || '/tmp';
const BASE = process.env.GATHER_URL || 'http://localhost:8080';
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };
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
    const code = (await a.evaluate(() => window.__gather.studio)).trim();

    const v = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); v.on('pageerror', (e) => errs.push('viewer: ' + e.message));
    await v.goto(`${BASE}/w/${code}`);
    await v.waitForSelector('#wMsgs li[data-id="pin-welcome"]', { timeout: 15000 });
    const first = await v.evaluate(() => [...document.querySelectorAll('#wMsgs > li')].slice(0, 3).map((li) => li.dataset.id || li.className));
    check('the chat opens with the streamer’s welcome, then Sam, then starters', first[0] === 'pin-welcome' && first[1] === 'pin-sam' && /starters/.test(first[2]), first.join(' | '));
    check('the welcome is from the host', /Alex Host/.test(await v.textContent('#wMsgs li[data-id="pin-welcome"]')) && await v.isVisible('#wMsgs li[data-id="pin-welcome"] .wv-host-pill'));
    check('tabs read Chat, Live, People', (await v.$$eval('.wv-tabs [role="tab"]:not([hidden]) > span, .wv-tabs [role="tab"]:not([hidden]):not(:has(span))', (els) => els.map((e) => e.textContent.trim()))).join(',') === 'Chat,Live,People');

    await v.click('#wSamBtn');
    check('Ask Sam puts @Sam in the box', /^@Sam /.test(await v.inputValue('#wText')));
    await v.fill('#wText', '@Sam what is this show?'); await v.click('#wSend');
    await signUp(v, 'Jordan');
    const err = await v.waitForFunction(() => { const e = document.querySelector('#wErr'); return e && !e.hidden && e.textContent; }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => '');
    check('without a house AI key, the viewer is told Sam isn’t on, and keeps their question', /isn’t switched on/.test(err) && /@Sam what is this show\?/.test(await v.inputValue('#wText')), err);
    check('the thinking dots go away', !(await v.$('#wMsgs li[data-id="sam-thinking"]')));
    await v.screenshot({ path: SP + '/sam-chat.png', clip: { x: 1050, y: 88, width: 390, height: 812 } });

    // The answer path with a key: lib/ai.js viewerAnswer against a stubbed provider.
    process.env.HOUSE_AI_PROVIDER = 'openai'; process.env.HOUSE_AI_KEY = 'sk-test-123456789';
    delete require.cache[require.resolve(path.join(__dirname, '../lib/ai.js'))];
    const realFetch = global.fetch; let seen;
    global.fetch = async (url, opts) => { seen = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'It’s a show about building in public.' } }] }) }; };
    const text = await require(path.join(__dirname, '../lib/ai.js')).viewerAnswer({ question: 'what is this show?', ctx: { title: 'Building in public', host: 'Alex Host', about: 'We build live' } });
    global.fetch = realFetch;
    check('with a key, Sam answers from the show’s facts (system prompt carries them)', /building in public/i.test(text) && /Building in public/.test(seen.body.messages[0].content) && /Alex Host/.test(seen.body.messages[0].content), text);

    // @Sam recap: the last 10 minutes and an instruction to sum them up.
    const ai = require(path.join(__dirname, '../lib/ai.js'));
    check('recap questions are recognised', ['@Sam recap', 'what did I miss?', 'catch me up', 'can you sum it up'].every(ai.isRecap) && !ai.isRecap('what is this show?'));
    global.fetch = async (url, opts) => { seen = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'They talked about the launch, then took questions.' } }] }) }; };
    const caps = Array.from({ length: 30 }, (_, i) => `caption line ${i}`);
    await ai.viewerAnswer({ question: 'what did I miss?', ctx: { title: 'Launch day', host: 'Alex Host', recap: true, captions: caps, chat: ['Jordan (super chat $5): congrats!'] } });
    global.fetch = realFetch;
    const sys = seen.body.messages[0].content;
    check('a recap prompt asks for a summary of the last 10 minutes, with all of it', /asked for a recap/.test(sys) && /caption line 29/.test(sys) && /super chat \$5/.test(sys) && seen.body.max_tokens === 450, sys.slice(-300));

    check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  await browser.close();
  console.log('errors', JSON.stringify(errs));
  process.exit(ok ? 0 : 1);
})();
