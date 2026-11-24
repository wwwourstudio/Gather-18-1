// The public watch page: direct WebRTC viewing, live chat, reactions, super chats paid straight to the host
// (a claim until the host confirms), and the rules around them. API checks first, then one full browser run.
const { chromium } = require('playwright');
const B = process.env.GATHER_URL || 'http://localhost:8080';
// Chatting on the watch page needs an account: sign up from the "Sign in to chat" box (email + password).
const signUp = async (page, name) => {
  if (!(await page.isVisible('#wSignDlg'))) await page.click('#wMe');
  await page.waitForSelector('#wSignDlg[open]');
  if (!(await page.isVisible('#wSignNameRow'))) await page.click('#wSignMode');
  await page.fill('#wSignName', name); await page.fill('#wSignEmail', `${name.toLowerCase()}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`);
  await page.fill('#wSignPass', 'correct horse battery'); await page.check('#wSignAgree'); await page.click('#wSignGo');
  await page.waitForFunction(() => !document.querySelector('#wSignDlg').open, null, { timeout: 10000 });
};

const post = (a, b) => fetch(`${B}/api/studio?action=${a}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const feed = (code) => fetch(`${B}/api/studio?action=wfeed&studio=${code}`).then(async (r) => ({ cache: r.headers.get('cache-control') || '', ...(await r.json()) }));
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const mk = async (vp) => { const p = await (await browser.newContext({ viewport: vp || { width: 1440, height: 900 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p; };
  try {
    // ---- API rules, against a studio opened over the API
    const code = 'gather-watchtest01', dev = 'e'.repeat(24);
    const h = await post('join', { studio: code, dev, name: 'Host', intent: 'create' });
    const setW = (watch) => post('send', { studio: code, id: h.id, tok: h.tok, ops: [{ type: 'state', state: { watch } }] });
    await setW({ chat: true, supers: true, min: 5, pay: { venmo: 'host-name', paypal: 'bad handle!', stripe: 'https://evil.example/pay' } });
    const f0 = await feed(code);
    check('the feed is one cached GET for every viewer', /s-maxage=2/.test(f0.cache) || !process.env.VERCEL, f0.cache);
    check('payment handles are never sent to viewers, and super chats stay off without card payments', !('pay' in f0.watch) && f0.watch.supers === false, JSON.stringify(f0.watch));
    check('reserved names are refused', (await post('whello', { studio: code, name: 'Host' })).status === 400);
    const v = await post('whello', { studio: code, name: 'Viewer 1' });
    const v2 = await post('whello', { studio: code, vid: v.vid, vtok: v.vtok, name: 'Jordan' });
    check('renaming keeps the same viewer session (the video stays connected)', v2.vid === v.vid && v2.name === 'Jordan');
    const c1 = await post('wsend', { studio: code, vid: v.vid, vtok: v.vtok, type: 'chat', text: 'hello <b>there</b>' });
    const c2 = await post('wsend', { studio: code, vid: v.vid, vtok: v.vtok, type: 'chat', text: 'again' });
    check('chat works and is rate limited', !!c1.id && c2.status === 429, `${c2.status}`);
    const forged = await post('wsend', { studio: code, vid: v.vid, vtok: 'nope', type: 'chat', text: 'x' });
    check('a forged viewer token is refused', forged.status === 401);
    const other = await post('whello', { studio: code, name: 'Sam' });
    const stealDel = await post('wsend', { studio: code, vid: other.vid, vtok: other.vtok, type: 'delete', msg: c1.id });
    check('only the writer can delete a chat message', stealDel.status === 403, `${stealDel.status}`);
    const del = await post('wsend', { studio: code, vid: v.vid, vtok: v.vtok, type: 'delete', msg: c1.id });
    await new Promise((r) => setTimeout(r, 2100));
    const fd = await feed(code);
    check('a deleted message leaves the feed and is listed as gone', del.ok && !fd.chat.some((x) => x.id === c1.id) && fd.gone.includes(c1.id), JSON.stringify(fd.gone));
    await new Promise((r) => setTimeout(r, 1100));
    // Super chats are paid by card on the page (wcheckout, see pay.test.js); a "paid elsewhere" super chat is refused.
    const outside = await post('wsend', { studio: code, vid: v.vid, vtok: v.vtok, type: 'super', amount: 10, method: 'venmo', text: 'Great show' });
    check('a super chat "paid in another app" is refused: card only, on the page', outside.status === 400 && /card/.test(outside.error || ''), outside.error);
    check('…and nothing paid shows in the chat', !(await feed(code)).chat.some((m) => m.paid));
    const guest = await post('join', { studio: code, dev: 'f'.repeat(24), name: 'Guest', intent: 'join' });
    await post('wsend', { studio: code, vid: v.vid, vtok: v.vtok, type: 'react', emoji: '🔥' });
    check('reactions are counted for everyone', (await feed(code)).reacts['🔥'] >= 1);
    await setW({ cap: 0, direct: false, chat: true });
    check('with direct video off, viewers are told it is off (they fall back to platforms)', (await post('wrtcJoin', { studio: code, vid: v.vid, vtok: v.vtok })).reason === 'off');
    await post('leave', { studio: code, id: guest.id, tok: guest.tok, why: 'left' });
    await post('leave', { studio: code, id: h.id, tok: h.tok, why: 'left' });

    // ---- the real thing in browsers: host + a viewer on the page, chat, a super chat confirmed from the studio chat
    const a = await mk();
    await a.goto(B + '/'); await a.click('#enterStage'); await a.click('#wGo'); await a.waitForSelector('#enterDlg[open]'); await a.fill('#enterName', 'Maya Host'); await a.click('#enterGo');
    await a.waitForFunction(() => !!window.__gather?.studio && !document.querySelector('#enterDlg')?.open, null, { timeout: 15000 }); const sc2 = (await a.evaluate(() => window.__gather.studio)).trim(); await a.keyboard.press('Escape');
    await a.click('[data-tab="show"]'); await a.click('.aud-seg:visible [data-aud="supers"]'); await a.check('#wpSupers');
    check('Get paid says super chats need Stripe before viewers see the tip button', /Stripe/.test(await a.textContent('#wpPayStatus')));
    await a.click('[data-tab="chat"]');
    const w = await mk();
    await w.goto(B + '/w/' + sc2);
    const plays = await w.waitForFunction(() => document.querySelector('#wDirect')?.videoWidth > 0, null, { timeout: 30000 }).then(() => true).catch(() => false);
    check('the watch page plays the studio directly over WebRTC', plays);
    check('…and says "On air" with a viewer count', (await w.textContent('#wLiveText')) === 'On air' && /watching/.test(await w.textContent('#wViewers')));
    check('the page glows with the live picture (blurred copy behind it)', await w.evaluate(() => document.querySelector('#wv').classList.contains('glow') && !!document.querySelector('#wAmbientVid').srcObject));
    await w.click('#wChatCollapse');
    check('chat collapses from its header, and a Chat tab appears', await w.evaluate(() => document.querySelector('#wv').classList.contains('no-chat')) && await w.isVisible('#wChatReopen'));
    await w.click('#wChatReopen');
    check('…and the Chat tab brings it back', await w.evaluate(() => !document.querySelector('#wv').classList.contains('no-chat')) && await w.isVisible('#wText'));
    await w.fill('#wText', 'Hello from the watch page'); await w.click('#wSend');
    check('a signed-out viewer who sends a message is asked to sign in', await w.waitForSelector('#wSignDlg[open]', { timeout: 5000 }).then(() => true).catch(() => false));
    await signUp(w, 'Jordan'); // the message waiting in the box goes out once they're signed in
    const inStudio = await a.waitForFunction(() => [...document.querySelectorAll('#msgs .msg.ext')].some((li) => /Hello from the watch page/.test(li.textContent)), null, { timeout: 10000 }).then(() => true).catch(() => false);
    check('viewer chat reaches the studio chat', inStudio);
    // Super chats are on, but this site has no Stripe connected: no tip button, so nobody is sent to pay elsewhere.
    check('without card payments the green $ is greyed out and opens nothing', await w.evaluate(() => { const b = document.querySelector('#wTipBtn'); return !!b && b.classList.contains('off') && b.getAttribute('aria-disabled') === 'true'; }));
    await w.click('#wTipBtn', { force: true }); // aria-disabled: Playwright won't click it unforced
    check('…tapping it says tips aren’t on, and the tray stays shut', await w.evaluate(() => document.querySelector('#wTipDock').hidden));
    // The super chat alert on stream and in the viewer's chat is covered with a real card payment in pay.test.js.
    check('the page fits one screen (no page scroll)', await w.evaluate(() => document.documentElement.scrollHeight <= innerHeight));
    const p = await mk({ width: 390, height: 844 }); await p.goto(B + '/w/' + sc2); await p.waitForTimeout(2500);
    check('on a phone the page fits one screen and the chat box is visible', await p.evaluate(() => { const r = document.querySelector('#wText').getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && r.bottom <= innerHeight; }));
  } catch (e) { check('suite ran', false, e.stack); }
  console.log('errors A', errs, 'B', []);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
