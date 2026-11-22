// Live auctions, giveaways, shoutouts and raids: the studio side.
//   - Shop panel: "Live auction" (Whatnot-style: bid timer, anti-snipe or sudden death) and "Giveaway".
//   - Play panel: "Shoutout & raid" (Twitch-style: put another creator on screen, then send your viewers to them).
//   - Stage cards for all four, drawn into the program canvas so recordings and restreams carry them.
// Bids and entries are taken and settled by the server (lib/watch.js); this file only asks and draws.
import { resolveCardColors, isLightHex } from './stage-theme.js';

const $ = (s, r = document) => r.querySelector(s);
const cents = (v) => { const n = Number(String(v || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const money = (c) => '$' + ((c || 0) / 100).toFixed((c || 0) % 100 ? 2 : 0);
const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const L = { auction: null, giveaway: null, api: null };

function section(key, title, hint, html) {
  const d = document.createElement('details');
  d.className = 'psec'; d.dataset.sec = key; d.open = true;
  d.innerHTML = `<summary><b>${title}</b>${hint ? `<span class="hint">${hint}</span>` : ''}</summary><div class="psec-body form">${html}</div>`;
  return d;
}

// ---------------------------------------------------------------- studio panels
function buildAuction(api) {
  const sec = section('shop-auction', 'Live auction', 'viewers bid on the watch page', `
    <div class="le-setup" id="auSetup">
      <label class="fld"><span>Item</span><select id="auItem"><option value="">Something else…</option></select></label>
      <label class="fld" id="auTitleFld"><span>What’s up for bid</span><input id="auTitle" maxlength="80" placeholder="Signed vinyl, 1 of 1"></label>
      <div class="row3">
        <label class="fld"><span>Starting bid</span><input id="auStart" inputmode="decimal" value="$1"></label>
        <label class="fld"><span>Raise by</span><input id="auInc" inputmode="decimal" value="$1"></label>
        <label class="fld"><span>Time</span><select id="auSec"><option value="30">30 s</option><option value="60" selected>1 min</option><option value="120">2 min</option><option value="300">5 min</option></select></label>
      </div>
      <label class="toggle-row"><span><b>Sudden death</b><small>No extra time for late bids. Off: a bid in the last 10 s adds 10 s, so the highest bid wins, not the fastest.</small></span><input type="checkbox" class="toggle" id="auSudden" role="switch"></label>
      <button type="button" class="btn primary block" id="auGo">Start auction</button>
    </div>
    <div class="le-live" id="auLive" hidden>
      <div class="le-head"><b id="auLiveTitle"></b><span class="le-clock num" id="auClock"></span></div>
      <div class="le-big"><span class="num" id="auBid"></span><small id="auLeader"></small></div>
      <ol class="le-bids" id="auBids"></ol>
      <div class="row"><button type="button" class="btn sm primary" id="auEnd">End now</button><button type="button" class="btn sm ghost" id="auCancel">Cancel</button><button type="button" class="btn sm ghost" id="auClear" hidden>Done</button></div>
    </div>`);
  const fillItems = () => {
    const sel = $('#auItem', sec), cur = sel.value, items = api.getState()?.shop?.items || [];
    sel.replaceChildren(new Option('Something else…', ''), ...items.map((x) => new Option(`${x.title}${x.price ? ' · ' + x.price : ''}`, x.id)));
    sel.value = items.some((x) => x.id === cur) ? cur : '';
    $('#auTitleFld', sec).hidden = !!sel.value;
  };
  $('#auItem', sec).onchange = fillItems;
  api.onStateSync(fillItems);
  $('#auGo', sec).onclick = () => {
    if (!api.isHost()) return api.toast('Only the host runs auctions.', { err: true });
    const item = (api.getState()?.shop?.items || []).find((x) => x.id === $('#auItem', sec).value);
    const title = item?.title || $('#auTitle', sec).value.trim();
    if (!title) return api.toast('Say what’s up for bid first.', { err: true });
    const start = cents($('#auStart', sec).value), inc = cents($('#auInc', sec).value);
    if (inc < 1) return api.toast('The raise needs to be at least 1¢.', { err: true });
    api.send({ type: 'auction', act: 'start', title, itemId: item?.id || '', img: item?.img || '', start, inc, sec: Number($('#auSec', sec).value), sudden: $('#auSudden', sec).checked });
  };
  $('#auEnd', sec).onclick = () => api.send({ type: 'auction', act: 'end' });
  $('#auCancel', sec).onclick = () => { if (confirm('Cancel this auction? Nobody wins.')) api.send({ type: 'auction', act: 'cancel' }); };
  $('#auClear', sec).onclick = () => api.send({ type: 'auction', act: 'clear' });
  return sec;
}

function buildGiveaway(api) {
  const sec = section('shop-giveaway', 'Giveaway', 'one fair winner, drawn by the server', `
    <div class="le-setup" id="gwSetup">
      <label class="fld"><span>Prize</span><input id="gwPrize" maxlength="80" placeholder="Free hoodie"></label>
      <label class="fld"><span>Entries close after</span><select id="gwSec"><option value="60">1 min</option><option value="120" selected>2 min</option><option value="300">5 min</option><option value="900">15 min</option></select></label>
      <button type="button" class="btn primary block" id="gwGo">Open giveaway</button>
    </div>
    <div class="le-live" id="gwLive" hidden>
      <div class="le-head"><b id="gwLivePrize"></b><span class="le-clock num" id="gwClock"></span></div>
      <div class="le-big"><span class="num" id="gwCount"></span><small id="gwState"></small></div>
      <div class="row"><button type="button" class="btn sm primary" id="gwDraw">Draw a winner</button><button type="button" class="btn sm ghost" id="gwCancel">Cancel</button><button type="button" class="btn sm ghost" id="gwClear" hidden>Done</button></div>
    </div>`);
  $('#gwGo', sec).onclick = () => {
    if (!api.isHost()) return api.toast('Only the host runs giveaways.', { err: true });
    const prize = $('#gwPrize', sec).value.trim();
    if (!prize) return api.toast('Name the prize first.', { err: true });
    api.send({ type: 'giveaway', act: 'start', prize, sec: Number($('#gwSec', sec).value) });
  };
  $('#gwDraw', sec).onclick = () => api.send({ type: 'giveaway', act: 'draw' });
  $('#gwCancel', sec).onclick = () => { if (confirm('Cancel this giveaway?')) api.send({ type: 'giveaway', act: 'cancel' }); };
  $('#gwClear', sec).onclick = () => api.send({ type: 'giveaway', act: 'clear' });
  return sec;
}

function buildShoutout(api) {
  const sec = section('gaming-shoutout', 'Shoutout &amp; raid', 'send your viewers to a friend', `
    <label class="fld"><span>Creator</span><input id="soName" maxlength="40" placeholder="PixelPete"></label>
    <label class="fld"><span>Their show</span><input id="soUrl" maxlength="300" placeholder="/w/pixelpete or https://twitch.tv/pixelpete" spellcheck="false"></label>
    <label class="fld"><span>Playing (optional)</span><input id="soGame" maxlength="40" placeholder="Rocket League"></label>
    <div class="row"><button type="button" class="btn sm primary" id="soGo">Shout out</button><button type="button" class="btn sm" id="soRaid">Raid in 15 s</button><button type="button" class="btn sm ghost" id="soStop" hidden>Stop</button></div>
    <p class="hint">A shoutout puts their card on stage and the watch page for 20 seconds. A raid counts down on both, then takes your viewers to their show.</p>`);
  const read = () => {
    const name = $('#soName', sec).value.trim(), url = $('#soUrl', sec).value.trim().replace(/^w\//, '/w/');
    if (!name) { api.toast('Who are you shouting out?', { err: true }); return null; }
    if (url && !/^\/w\/[a-z0-9-]{2,40}$/i.test(url) && !/^https:\/\//.test(url)) { api.toast('Their show needs an https:// link or a /w/name page.', { err: true }); return null; }
    return { name, url, game: $('#soGame', sec).value.trim() };
  };
  $('#soGo', sec).onclick = () => { const o = read(); if (o) { api.setStage({ shoutout: { ...o, ts: Date.now() } }); api.toast(`Shouting out ${o.name}.`); } };
  $('#soRaid', sec).onclick = () => {
    const o = read(); if (!o) return;
    if (!o.url) return api.toast('A raid needs their show’s link.', { err: true });
    api.setStage({ raid: { name: o.name, url: o.url, at: Date.now() + 15_000 }, shoutout: { ...o, ts: Date.now() } });
  };
  $('#soStop', sec).onclick = () => api.setStage({ raid: null, shoutout: null });
  api.onStateSync((st) => { const busy = !!(st?.raid && st.raid.at > Date.now() - 5000) || !!(st?.shoutout && Date.now() - st.shoutout.ts < 20_000); $('#soStop', sec).hidden = !busy; });
  return sec;
}

// ---------------------------------------------------------------- panel state
function renderPanels() {
  const a = L.auction, gv = L.giveaway, now = Date.now();
  const au = $('#auLive'); if (au) {
    const live = a?.status === 'live';
    $('#auSetup').hidden = !!a; au.hidden = !a;
    if (a) {
      $('#auLiveTitle').textContent = a.title;
      $('#auClock').textContent = live ? clock(a.endsAt - now) : { sold: 'Sold', nobid: 'No bids', cancelled: 'Cancelled' }[a.status] || '';
      $('#auClock').classList.toggle('hot', live && a.endsAt - now < 10_000);
      $('#auBid').textContent = money(a.top ? a.top.amt : a.start);
      $('#auLeader').textContent = a.top ? (live ? `${a.top.name} leads · ${a.count} bid${a.count === 1 ? '' : 's'}` : `Won by ${a.top.name}`) : live ? `Starting bid · raises of ${money(a.inc)}` : 'Nobody bid';
      $('#auBids').replaceChildren(...(a.bids || []).slice().reverse().slice(0, 5).map((b) => { const li = document.createElement('li'); li.textContent = `${b.name} · ${money(b.amt)}`; return li; }));
      $('#auEnd').hidden = !live; $('#auCancel').hidden = !live; $('#auClear').hidden = live;
    }
  }
  const gl = $('#gwLive'); if (gl) {
    const open = gv?.status === 'open';
    $('#gwSetup').hidden = !!gv; gl.hidden = !gv;
    if (gv) {
      $('#gwLivePrize').textContent = gv.prize;
      $('#gwClock').textContent = open ? (gv.endsAt > now ? clock(gv.endsAt - now) : 'Closed') : gv.status === 'drawn' ? 'Drawn' : 'Cancelled';
      $('#gwCount').textContent = `${gv.entries || 0}`;
      $('#gwState').textContent = gv.status === 'drawn' ? (gv.winner ? `entered · winner: ${gv.winner}` : 'entered · nobody to draw') : 'entered';
      $('#gwDraw').hidden = !open; $('#gwCancel').hidden = !open; $('#gwClear').hidden = open;
    }
  }
}

// ---------------------------------------------------------------- stage cards
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function card(g, x, y, w, h, c) {
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 24;
  g.fillStyle = c.bg; rr(g, x, y, w, h, 16); g.fill();
  g.shadowColor = 'transparent'; g.strokeStyle = c.border; g.lineWidth = 1.5; rr(g, x + 0.5, y + 0.5, w - 1, h - 1, 16); g.stroke();
}
function pill(g, x, y, text, bg, font) {
  g.font = `800 12px ${font}`; const w = g.measureText(text).width + 18;
  g.fillStyle = bg; rr(g, x, y, w, 22, 6); g.fill();
  g.fillStyle = isLightHex(bg) ? '#0b0e14' : '#fff'; g.textBaseline = 'middle'; g.fillText(text, x + 9, y + 11.5);
  return w;
}
const fit = (g, s, w) => { if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; };

function drawAuction(g, W, H, a, c, font, now, y) {
  const shownAfter = a.status === 'sold' ? 15_000 : 6_000;
  if (a.status !== 'live' && now - (a.endedAt || 0) > shownAfter) return 0;
  const w = Math.min(460, Math.round(W * 0.4)), h = 128, x = Math.round(W * 0.025);
  y -= h; card(g, x, y, w, h, c);
  g.textAlign = 'left';
  const live = a.status === 'live', left = a.endsAt - now, hot = live && left < 10_000;
  const tag = live ? 'LIVE AUCTION' : a.status === 'sold' ? 'SOLD' : a.status === 'nobid' ? 'NO BIDS' : 'CANCELLED';
  pill(g, x + 16, y + 14, tag, a.status === 'sold' ? '#16a34a' : live ? c.accent : '#475569', font);
  if (live) { g.font = `800 20px ${font}`; g.textAlign = 'right'; g.fillStyle = hot ? '#f43f5e' : c.ink; g.textBaseline = 'middle'; g.fillText(clock(left), x + w - 16, y + 25); g.textAlign = 'left'; }
  g.font = `700 17px ${font}`; g.fillStyle = c.ink; g.textBaseline = 'top'; g.fillText(fit(g, a.title, w - 32), x + 16, y + 46);
  g.font = `800 34px ${font}`; g.fillStyle = c.accent; g.textBaseline = 'alphabetic';
  const bid = money(a.top ? a.top.amt : a.start); g.fillText(bid, x + 16, y + h - 18);
  const bw = g.measureText(bid).width;
  g.font = `600 14px ${font}`; g.fillStyle = c.muted;
  const who = a.top ? (live ? `${a.top.name} leads` : `won by ${a.top.name}`) : live ? 'starting bid · bid on the watch page' : '';
  g.fillText(fit(g, who, w - bw - 46), x + 28 + bw, y + h - 22);
  if (hot) { g.globalAlpha = 0.5 + 0.5 * Math.sin(now / 120); g.strokeStyle = '#f43f5e'; g.lineWidth = 3; rr(g, x + 1.5, y + 1.5, w - 3, h - 3, 16); g.stroke(); g.globalAlpha = 1; }
  return h + 12;
}

function drawGiveaway(g, W, H, gv, c, font, now, y) {
  if (gv.status !== 'open' && now - (gv.endedAt || 0) > 15_000) return 0;
  if (gv.status === 'cancelled') return 0;
  const w = Math.min(420, Math.round(W * 0.36)), h = 92, x = Math.round(W * 0.025);
  y -= h; card(g, x, y, w, h, c);
  g.textAlign = 'left';
  pill(g, x + 16, y + 14, gv.status === 'drawn' ? 'WINNER' : 'GIVEAWAY', gv.status === 'drawn' ? '#16a34a' : '#db2777', font);
  g.font = `700 16px ${font}`; g.fillStyle = c.ink; g.textBaseline = 'top';
  g.fillText(fit(g, gv.status === 'drawn' ? `🎉 ${gv.winner || 'Nobody entered'}` : `🎁 ${gv.prize}`, w - 32), x + 16, y + 44);
  g.font = `600 13px ${font}`; g.fillStyle = c.muted;
  const open = gv.status === 'open' && gv.endsAt > now;
  g.fillText(fit(g, gv.status === 'drawn' ? `won ${gv.prize}` : open ? `${gv.entries || 0} entered · ${clock(gv.endsAt - now)} left · enter on the watch page` : `${gv.entries || 0} entered · drawing soon`, w - 32), x + 16, y + 66);
  return h + 12;
}

function drawShoutout(g, W, H, so, c, font, now) {
  const age = now - (so.ts || 0); if (age < 0 || age > 20_000) return;
  const w = Math.min(560, Math.round(W * 0.48)), h = 84, x = Math.round((W - w) / 2), y = Math.round(H * 0.06);
  g.globalAlpha = Math.min(1, age / 300, (20_000 - age) / 400);
  card(g, x, y, w, h, c);
  g.textAlign = 'left';
  pill(g, x + 16, y + 14, 'GO FOLLOW', c.accent, font);
  g.font = `800 22px ${font}`; g.fillStyle = c.ink; g.textBaseline = 'top'; g.fillText(fit(g, so.name, w - 160), x + 16, y + 44);
  g.font = `600 13px ${font}`; g.fillStyle = c.muted; g.textAlign = 'right';
  g.fillText(fit(g, [so.game, so.url.replace(/^https:\/\//, '')].filter(Boolean).join(' · '), w * 0.5), x + w - 16, y + 52);
  g.globalAlpha = 1;
}

function drawRaid(g, W, H, raid, c, font, now) {
  const left = raid.at - now; if (left < -4000) return;
  const h = 56, y = 0;
  g.fillStyle = c.accent; g.fillRect(0, y, W, h);
  g.fillStyle = isLightHex(c.accent) ? '#0b0e14' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 22px ${font}`;
  g.fillText(left > 0 ? `Raiding ${raid.name} in ${Math.ceil(left / 1000)}…` : `Raiding ${raid.name} now — see you there!`, W / 2, y + h / 2);
}

/** Called by the stage renderer every frame. */
export function draw(g, W, H, brand, font, now = Date.now()) {
  const c = resolveCardColors(brand);
  const st = L.api?.getState?.() || {};
  let y = H - Math.round(H * 0.16); // stack above name tags / lower thirds
  if (L.auction) y -= drawAuction(g, W, H, L.auction, c, font, now, y);
  if (L.giveaway) drawGiveaway(g, W, H, L.giveaway, c, font, now, y);
  if (st.shoutout) drawShoutout(g, W, H, st.shoutout, c, font, now);
  if (st.raid) drawRaid(g, W, H, st.raid, c, font, now);
}

/** Server messages ('auction' / 'giveaway'), from the poll or as the result of the host's own action. */
export function onMsg(m) {
  if (m.type === 'auction') L.auction = m.auction || null;
  if (m.type === 'giveaway') L.giveaway = m.giveaway || null;
  renderPanels();
  L.api?.requestStageRender?.();
}

export function initLiveEvents(api) {
  L.api = api;
  const shop = $('#shopSec'), tips = $('details[data-sec="shop-shopify"]', shop);
  if (shop) { const au = buildAuction(api), gw = buildGiveaway(api); if (tips) tips.before(au, gw); else shop.append(au, gw); }
  const play = $('.panel[data-panel="gaming"] .panel-body');
  if (play) play.prepend(buildShoutout(api));
  // The host catches up after a reload; while something runs, the panel clock ticks and entries are re-counted.
  let lastGet = 0;
  setInterval(() => {
    if (!api.inStudio()) return;
    const now = Date.now();
    const busy = L.auction?.status === 'live' || L.giveaway?.status === 'open';
    if (api.isHost() && (now - lastGet > (busy ? 3000 : 30_000))) { lastGet = now; api.send({ type: 'auction', act: 'get' }); api.send({ type: 'giveaway', act: 'get' }); }
    if (busy) renderPanels();
  }, 1000);
}
