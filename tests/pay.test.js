// Super chats paid by card right on the watch page (Stripe Connect, mocked here), with a voice message, the
// automatic confirmation, the pop-up in the chat and the strip of recent super chats.
// The test server runs with STRIPE_API_BASE pointing at the mock below (see run.js).
const http = require('node:http');
const { chromium } = require('playwright');
const B = process.env.GATHER_URL || 'http://localhost:8080';
const MOCK_PORT = Number(process.env.STRIPE_MOCK_PORT || 8099);
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };
const post = (a, b) => fetch(`${B}/api/studio?action=${a}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const feed = (code) => fetch(`${B}/api/studio?action=wfeed&studio=${code}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a tiny stand-in for the parts of Stripe's API gather uses
const paidSessions = new Set(); const seen = [];
let n = 0;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, acct: req.headers['stripe-account'] || '', auth: req.headers.authorization || '', body });
    const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/v1/accounts') return send({ id: 'acct_test1' });
    if (req.method === 'POST' && req.url === '/v1/account_links') return send({ url: 'https://connect.stripe.com/setup/e/test' });
    if (req.method === 'GET' && req.url.startsWith('/v1/accounts/')) return send({ id: 'acct_test1', charges_enabled: true });
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') { n++; return send({ id: 'cs_test_' + n, client_secret: 'cs_test_' + n + '_secret' }); }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/([^?]+)/);
    if (req.method === 'GET' && m) return send({ id: m[1], payment_status: paidSessions.has(m[1]) ? 'paid' : 'unpaid' });
    res.writeHead(404); res.end('{}');
  });
});

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  const browser = await chromium.launch();
  const errs = [];
  try {
    const code = 'gather-paytest01', dev = 'f'.repeat(24);
    const h = await post('join', { studio: code, dev, name: 'Host', intent: 'create' });
    await post('send', { studio: code, id: h.id, tok: h.tok, ops: [{ type: 'state', state: { watch: { chat: true, supers: true, min: 3, pay: {} } } }] });
    let f = await feed(code);
    check('with no payment set up, super chats stay off', !f.watch.supers && !f.watch.card);

    const st0 = await post('payCard', { studio: code, id: h.id, tok: h.tok, op: 'status' });
    check('the host sees cards are available but not connected', st0.available && !st0.connected, JSON.stringify(st0));
    const con = await post('payCard', { studio: code, id: h.id, tok: h.tok, op: 'connect', origin: B });
    check('connecting returns Stripe’s onboarding link', /^https:\/\/connect\.stripe\.com\//.test(con.url || ''), JSON.stringify(con));
    const link = seen.find((x) => x.url === '/v1/account_links');
    check('the onboarding link comes back to gather', /return_url=http/.test(link?.body || '') && /stripe-done\.html/.test(decodeURIComponent(link?.body || '')));
    const st1 = await post('payCard', { studio: code, id: h.id, tok: h.tok, op: 'status' });
    check('once Stripe says charges are enabled, cards are ready', st1.ready === true, JSON.stringify(st1));
    await sleep(2100);
    f = await feed(code);
    check('the watch page now offers cards (and super chats turn on)', f.watch.card && f.watch.supers && /^pk_/.test(f.watch.pk), JSON.stringify({ card: f.watch.card, supers: f.watch.supers }));
    check('the publishable key is public, the secret key is not', !JSON.stringify(f).includes('sk_'));

    const v = await post('whello', { studio: code, name: 'Riley' });
    const low = await post('wcheckout', { studio: code, vid: v.vid, vtok: v.vtok, amount: 1, text: 'hi' });
    check('card super chats respect the minimum', low.status === 400 && /\$3/.test(low.error || ''), low.error);
    await sleep(5100);
    const voice = 'data:audio/webm;base64,' + Buffer.from('fake-opus-audio').toString('base64');
    const co = await post('wcheckout', { studio: code, vid: v.vid, vtok: v.vtok, amount: 25, text: 'Love this stream!', voice, dur: 6 });
    check('checkout returns Stripe’s embedded checkout secret', co.clientSecret === 'cs_test_1_secret' && co.account === 'acct_test1' && /^sc-/.test(co.id), JSON.stringify(co));
    const sess = seen.find((x) => x.url === '/v1/checkout/sessions');
    check('the charge is made on the streamer’s own account', sess?.acct === 'acct_test1' && /unit_amount%5D=2500|unit_amount\]=2500/.test(sess.body) && /ui_mode=embedded/.test(sess.body));
    const early = await post('wcheckdone', { studio: code, vid: v.vid, vtok: v.vtok, sc: co.id });
    check('before Stripe says paid, nothing is posted', early.status === 'paying');
    const other = await post('whello', { studio: code, name: 'Sam' });
    const stolen = await post('wcheckdone', { studio: code, vid: other.vid, vtok: other.vtok, sc: co.id });
    check('another viewer can’t confirm someone else’s checkout', stolen.status === 404);
    const hidden = await post('wscvoice', { studio: code, sc: co.id });
    check('the voice message is private until the super chat is paid', hidden.status === 404);

    // a viewer page open while the payment lands: the pop-up and the super chat strip
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(B + '/w/' + code); await page.waitForTimeout(3000);

    paidSessions.add('cs_test_1');
    const [d1, d2] = await Promise.all([1, 2].map(() => post('wcheckdone', { studio: code, vid: v.vid, vtok: v.vtok, sc: co.id })));
    check('once paid, it confirms itself (asked twice at once, posted once)', d1.status === 'confirmed' && d2.status === 'confirmed');
    await sleep(2100);
    f = await feed(code);
    const items = f.chat.filter((x) => x.sc === co.id);
    check('the paid super chat is in the public chat once, with its voice message', items.length === 1 && items[0].paid === '$25' && items[0].voice === 6 && items[0].amount === 25, JSON.stringify(items));
    check('the goal total counts it', f.raised === 25, String(f.raised));
    const heard = await post('wscvoice', { studio: code, sc: co.id });
    check('everyone can play the voice message once it’s on screen', heard.data === voice);
    const list = await post('scList', { studio: code, id: h.id, tok: h.tok });
    check('the host’s list shows it as paid by card', list.items.some((x) => x.id === co.id && x.status === 'confirmed' && x.auto && x.method === 'card'));

    await page.waitForSelector('#wScPop:not([hidden]) .wv-scpop-amt', { timeout: 8000 }).catch(() => {});
    const pop = await page.$eval('#wScPop', (el) => ({ hidden: el.hidden, text: el.textContent, tier: el.dataset.tier })).catch(() => ({}));
    check('a super chat pop-up shows in the chat with amount and name', !pop.hidden && /\$25/.test(pop.text || '') && /Riley/.test(pop.text || '') && pop.tier === 'amber', JSON.stringify(pop));
    await page.screenshot({ path: process.argv[2] + '/pay-popup.png' });
    const tick = await page.$$eval('#wScTick .wv-sctick-chip', (els) => els.map((e) => e.textContent));
    check('the strip of recent super chats shows it', tick.some((t) => /\$25/.test(t) && /Riley/.test(t)), JSON.stringify(tick));
    const row = await page.$eval(`#wMsgs li.paid[data-sc="${co.id}"]`, (li) => ({ tier: li.dataset.tier, voice: !!li.querySelector('.wv-pd-voice') })).catch(() => null);
    check('in the chat list it’s coloured by amount, with a play button for the voice', row?.tier === 'amber' && row.voice, JSON.stringify(row));

    // the super chat tray on the watch page offers the card
    await page.click('#wTipBtn');
    await page.waitForSelector('#wTipDock:not([hidden])');
    const dock = await page.evaluate(() => ({ methods: [...document.querySelectorAll('#wTipMethods button')].map((b) => b.dataset.m), pay: document.querySelector('#wTipPay').textContent, send: document.querySelector('#wTipSend').hidden, msg: !!document.querySelector('#wTipMsg'), rec: !!document.querySelector('#wTipRec') }));
    check('the tray: card first, one Pay button, its own message box and voice recorder', dock.methods[0] === 'card' && /Pay \$/.test(dock.pay) && dock.send && dock.msg && dock.rec, JSON.stringify(dock));
    await page.fill('#wTipMsg', 'Shout out to the chat!');
    await page.screenshot({ path: process.argv[2] + '/pay-tray.png' });
    console.log('errors', JSON.stringify(errs));
  } catch (e) { console.log('FAIL threw: ' + (e.stack || e)); ok = false; }
  await browser.close(); mock.close();
  process.exit(ok ? 0 : 1);
})();
