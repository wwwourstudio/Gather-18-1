// Live commerce on the server: last-item drops can't oversell, auctions take bids safely (anti-snipe, one winner),
// giveaways pick one fair winner, and shoutouts / raids reach the watch feed. No browser: straight to the API.
const { spawn } = require('node:child_process');
const path = require('node:path');

const port = 8096;
const post = (action, body) => fetch(`http://127.0.0.1:${port}/api/studio?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const wait = () => new Promise((res, rej) => { const until = Date.now() + 10000; const t = () => fetch(`http://127.0.0.1:${port}/`).then(res).catch(() => (Date.now() > until ? rej(new Error('server did not start')) : setTimeout(t, 200))); t(); });

const env = { ...process.env, PORT: String(port), ALLOW_ANON_STUDIOS: '1', GATHER_RELAY: 'off', STORE_LATENCY_MS: '15' };
for (const k of ['REDIS_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'STRIPE_SECRET_KEY']) delete env[k];
const srv = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: 'ignore' });
let ok = true;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!cond) ok = false; };

(async () => {
  try {
    await wait();
    const code = 'gather-commerce001';
    const h = await post('join', { studio: code, dev: 'a'.repeat(24), name: 'Host', intent: 'create' });
    const hostOp = (op) => post('send', { studio: code, id: h.id, tok: h.tok, ops: [op] });
    await hostOp({ type: 'state', state: { shop: { items: [{ id: 'last1', title: 'Last hoodie', price: '$40', url: 'https://example.com/h', stock: 1 }, { id: 'mug', title: 'Mug', price: '$12', url: 'https://example.com/m' }] } } });
    const viewers = [];
    for (let i = 0; i < 6; i++) { const v = await post('whello', { studio: code, name: `Buyer${i}` }); viewers.push({ studio: code, vid: v.vid, vtok: v.vtok }); }

    // 1 Six buyers hit "Buy" on the last item at the same moment: exactly one gets it.
    const buys = await Promise.all(viewers.map((v) => post('wshopbuy', { ...v, itemId: 'last1' })));
    const won = buys.filter((r) => r.status === 200), soldOut = buys.filter((r) => r.status === 409);
    check('last-item drop sells exactly once', won.length === 1 && soldOut.length === 5, buys.map((r) => r.status + ':' + (r.error||'')).join(','));
    const feed = await post('wfeed', { studio: code });
    const item = feed.shop.items.find((x) => x.id === 'last1');
    check('stock ends at 0 with 1 sold', item.stock === 0 && item.sold === 1, JSON.stringify(item));

    // 2 Auction: start, bids must beat the leader by the increment, concurrent equal bids → one leader.
    const start = await hostOp({ type: 'auction', act: 'start', title: 'Signed vinyl', start: 1000, inc: 500, sec: 12 });
    const au = start.results?.find((r) => r.type === 'auction')?.auction;
    check('host starts an auction', au?.status === 'live' && au.start === 1000, JSON.stringify(start.results));
    const low = await post('wbid', { ...viewers[0], auction: au.id, amt: 900 });
    check('a bid under the starting price is refused', low.status === 409 && /at least \$10/.test(low.error || ''), low.error);
    const race = await Promise.all(viewers.slice(0, 4).map((v) => post('wbid', { ...v, auction: au.id, amt: 1000 })));
    check('four equal opening bids at once: exactly one leads', race.filter((r) => r.status === 200).length === 1, race.map((r) => r.status).join(','));
    const leader = race.findIndex((r) => r.status === 200);
    const self = await post('wbid', { ...viewers[leader], auction: au.id, amt: 2000 });
    check('the leader can’t outbid themselves', self.status === 409, self.error);
    const other = viewers[(leader + 1) % 4];
    const short = await post('wbid', { ...other, auction: au.id, amt: 1200 });
    check('a raise smaller than the increment is refused', short.status === 409 && /\$15/.test(short.error || ''), short.error);
    await new Promise((r) => setTimeout(r, 4000)); // into the last 10 s
    const before = (await post('wfeed', { studio: code })).auction.endsAt;
    const late = await post('wbid', { ...other, auction: au.id, amt: 1500 });
    check('a bid in the last 10 s extends the clock (anti-snipe)', late.status === 200 && late.auction.endsAt > before, `${before} → ${late.auction?.endsAt}`);
    check('the feed never exposes viewer ids', !JSON.stringify((await post('wfeed', { studio: code })).auction).includes(other.vid));
    await hostOp({ type: 'auction', act: 'end' });
    const sold = (await post('wfeed', { studio: code }));
    check('ending sells to the top bidder', sold.auction.status === 'sold' && sold.auction.top.name === 'Buyer' + ((leader + 1) % 4) && sold.auction.top.amt === 1500, JSON.stringify(sold.auction.top));
    check('the win is announced in chat', sold.chat.some((m) => /SOLD! .* won Signed vinyl for \$15/.test(m.text)));
    const payWrong = await post('wauctionpay', { ...viewers[5], auction: au.id });
    check('only the winner can pay', payWrong.status === 403, payWrong.error);
    const payWin = await post('wauctionpay', { ...other, auction: au.id });
    check('without card payments the winner is told the host will settle up (no outside pay links)', payWin.status === 200 && payWin.mode === 'host' && payWin.amount === '$15' && !payWin.pay && !payWin.url, JSON.stringify(payWin));
    const after = await post('wbid', { ...viewers[5], auction: au.id, amt: 99999 });
    check('no bids after the auction ends', after.status === 409);

    // 3 Auctions that run out settle by themselves on the next feed read.
    const au2 = (await hostOp({ type: 'auction', act: 'start', title: 'Quick flip', start: 100, inc: 100, sec: 10, sudden: true })).results[0].auction;
    await post('wbid', { ...viewers[5], auction: au2.id, amt: 100 });
    await new Promise((r) => setTimeout(r, 10500));
    const auto = (await post('wfeed', { studio: code })).auction;
    check('an expired auction settles on its own', auto.status === 'sold' && auto.top.name === 'Buyer5', JSON.stringify(auto));

    // 4 Giveaway: one entry per viewer, one fair winner among the entrants.
    const gv = (await hostOp({ type: 'giveaway', act: 'start', prize: 'Free hoodie', sec: 60 })).results[0].giveaway;
    const entries = await Promise.all(viewers.map((v) => post('wenter', { ...v, giveaway: gv.id })));
    const again = await post('wenter', { ...viewers[0], giveaway: gv.id });
    check('everyone can enter once', entries.every((r) => r.status === 200 && !r.already) && again.already === true);
    check('the feed counts entries', (await post('wfeed', { studio: code })).giveaway.entries === 6);
    const drawn = (await hostOp({ type: 'giveaway', act: 'draw' })).results[0].giveaway;
    check('the draw picks one entrant', drawn.status === 'drawn' && /^Buyer[0-5]$/.test(drawn.winner) && drawn.entries === 6, JSON.stringify(drawn));
    const closed = await post('wenter', { ...viewers[1], giveaway: gv.id });
    check('no entries after the draw', closed.status === 409);
    const guestTry = await post('join', { studio: code, dev: 'g'.repeat(24), name: 'Guest', intent: 'join' });
    const notHost = await post('send', { studio: code, id: guestTry.id, tok: guestTry.tok, ops: [{ type: 'giveaway', act: 'start', prize: 'x' }] });
    check('only the host can run giveaways', notHost.results?.[0]?.type === 'error');

    // 5 Shoutout and raid reach the watch feed; unsafe links are dropped.
    await hostOp({ type: 'state', state: { shoutout: { name: 'PixelPete', url: '/w/pixelpete', game: 'Rocket League', ts: Date.now() }, raid: { name: 'PixelPete', url: '/w/pixelpete', at: Date.now() + 15000 } } });
    const f5 = await post('wfeed', { studio: code });
    check('shoutout and raid reach viewers', f5.shoutout?.name === 'PixelPete' && f5.raid?.url === '/w/pixelpete', JSON.stringify([f5.shoutout, f5.raid]));
    await hostOp({ type: 'state', state: { raid: { name: 'Evil', url: 'javascript:alert(1)', at: Date.now() + 15000 } } });
    check('a raid to an unsafe link is refused', (await post('wfeed', { studio: code })).raid === null);

    globalThis.__ctx = { code, h, hostOp, viewers };
    if (globalThis.__more) await globalThis.__more();
  } catch (e) { check('suite ran', false, e.stack || e.message); }
  srv.kill();
  console.log(ok ? 'all commerce checks passed' : 'FAIL some commerce checks failed');
  process.exit(ok ? 0 : 1);
})();
