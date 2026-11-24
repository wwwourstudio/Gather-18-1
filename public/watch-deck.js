import { replaceKids } from './ui.js';

// Stream-type deck: the shopping shelf, gamer arena and play-along panels chosen by the stream type.
// Created by watch.js through createStreamDeck(app): `app` carries the watch page state and helpers this part uses.
export function createStreamDeck(app) {
  const {
    $, code, W, store, toast, likeMsg, setAsk, money, renderPollCard, renderQueueCard, renderPartyMe,
    renderPlayExtras, renderHotspot, buyProductInline, checkoutBag
  } = app;
  // ---------------------------------------------------------------- Stream-type deck: the show's own tools under the video
  // A shopping show gets its whole shelf (and the featured product on the video); a gamer show gets the play-with-me line
  // and the live prediction side by side. A plain live show keeps the page as it was.
  const MODE_CFG = {
    shopping: { icon: 'i-shopping-bag', title: 'Shop the live drop' },
    gamer: { icon: 'i-gamepad-2', title: 'Play along' },
  };
  function renderInteractive(info) {
    renderPollCard(info); renderQueueCard(info);
    if (W.modeType === 'gamer') { renderPollCard(info, $('#wModePoll')); renderQueueCard(info, $('#wModeQueue')); renderPlayExtras(info); }
    renderHotspot(info);
  }
  function scrollToMode(focusSel) {
    const box = $('#wMode'); if (!box || box.hidden) return;
    box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
    if (focusSel) setTimeout(() => $(focusSel)?.focus(), 350);
  }
  const buyWithCode = (sale) => () => { if (sale?.code) navigator.clipboard?.writeText(sale.code).then(() => toast(`Code ${sale.code} copied. Paste it at checkout.`)).catch(() => {}); };
  function skuThumb(p) {
    const im = document.createElement(p.img ? 'img' : 'div');
    if (p.img) { im.src = p.img; im.alt = ''; im.loading = 'lazy'; } else { im.className = 'ph'; im.textContent = '🛍'; }
    return im;
  }
  // The live shop, after Gather-18-2's "Shop the live drop": Featured (the drop, its flash sale, Buy now / Add to bag and
  // a switcher for the other products), Lookbook (everything), and a Bag kept on this device for this show. Checkout is
  // the seller's own store: Buy opens it with the sale code copied; nothing here takes payment.
  const parsePrice = (str) => { const m = String(str || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : NaN; };
  const priceSym = (str) => (String(str || '').match(/^[^\d\s]+/) || ['$'])[0];
  const fmtPrice = (n, like) => `${priceSym(like)}${n % 1 ? n.toFixed(2) : n}`;
  function salePriceOf(p, sale) {
    if (!sale || sale.id !== p.id || !sale.pct) return null;
    const n = parsePrice(p.price); return Number.isFinite(n) ? fmtPrice(Math.round(n * (100 - sale.pct)) / 100, p.price) : null;
  }
  const bagKey = () => 'bag:' + code;
  const getBag = () => { const b = store.get(bagKey(), []); return Array.isArray(b) ? b : []; };
  function setBag(b) { store.set(bagKey(), b); renderShopDrop(W.info, true); }
  function addToBag(p, open) {
    const b = getBag(), it = b.find((x) => x.id === p.id);
    if (it) it.qty = Math.min(9, it.qty + 1); else b.push({ id: p.id, qty: 1 });
    W.addedId = p.id; setTimeout(() => { if (W.addedId === p.id) { W.addedId = null; renderShopDrop(W.info, true); } }, 1400);
    if (open) W.shopTab = 'bag';
    setBag(b);
  }
  function buyLink(p, sale, label, cls) {
    const a = document.createElement('a'); a.className = cls; a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = label; a.setAttribute('aria-label', `${label}: ${p.title} (opens the store)`); a.onclick = buyWithCode(sale?.id === p.id ? sale : null);
    return a;
  }
  function priceEl(p, sale, cls) {
    const box = document.createElement('span'); box.className = cls;
    const now = salePriceOf(p, sale);
    box.append(Object.assign(document.createElement('b'), { className: 'num', textContent: now || money(p.price) || '—' }));
    if (now) box.append(Object.assign(document.createElement('s'), { className: 'num', textContent: money(p.price) }));
    return box;
  }
  function renderShopDrop(info, force) {
    const sh = info?.shop || {}, items = sh.items || [];
    const sale = sh.sale && sh.sale.until > Date.now() ? sh.sale : null;
    const bag = getBag().filter((x) => items.some((p) => p.id === x.id));
    const count = bag.reduce((n, x) => n + x.qty, 0);
    $('#wBagBtn').hidden = !items.length;
    $('#wBagBtnTxt').textContent = `Bag (${count})`;
    $('#wBagBtn').classList.toggle('on', W.shopTab === 'bag');
    $('#wModeSub').textContent = items.length ? `Checkout on ${sh.store || 'the seller’s store'}` : 'Products show up here as the host adds them';
    if (!W.shopTab) W.shopTab = 'drop';
    if (!items.some((p) => p.id === W.dropId)) W.dropId = null;
    const drop = items.find((p) => p.id === (W.dropId || sh.pinned)) || items.find((p) => p.id === sale?.id) || items[0];
    const qs = (W.recentChat || []).filter((m) => m.q && m.text).sort((a, b) => (b.likes || 0) - (a.likes || 0) || b.ts - a.ts).slice(0, 20);
    const key = JSON.stringify([W.shopTab, drop?.id, sh.pinned, sale, items, bag, W.addedId, W.shopTab === 'qa' ? qs.map((q) => [q.id, q.likes, W.liked.has(q.id)]) : qs.length]);
    const body = $('#wModeBody');
    if (!force && body.dataset.k === key) return;
    body.dataset.k = key;
    const tabs = $('#wModeTabs');
    tabs.hidden = !items.length || W.shopTab === 'bag';
    replaceKids(tabs, ...[['drop', 'Featured'], ['all', `Lookbook (${items.length})`], ['qa', `Q&A (${qs.length})`]].map(([id, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.role = 'tab'; b.textContent = label;
      b.setAttribute('aria-selected', String(W.shopTab === id)); b.onclick = () => { W.shopTab = id; renderShopDrop(W.info, true); };
      return b;
    }));
    if (!items.length) { replaceKids(body, Object.assign(document.createElement('p'), { className: 'wv-mode-empty', textContent: 'Nothing in the drop yet. When the host features a product, you can buy it right here without leaving the stream.' })); return; }
    const out = [];
    if (W.shopTab === 'drop') {
      if (sale && sale.id === drop.id) {
        const bar = document.createElement('div'); bar.className = 'wv-drop-sale';
        bar.append(Object.assign(document.createElement('span'), { textContent: `⚡ Flash sale${sale.pct ? ' · ' + sale.pct + '% off' : ''}` }));
        const cd = document.createElement('span'); cd.className = 'num'; cd.dataset.until = sale.until; bar.append(cd); out.push(bar);
      }
      const row = document.createElement('div'); row.className = 'wv-drop';
      const t = document.createElement('div'); t.className = 'wv-drop-t';
      t.append(Object.assign(document.createElement('h3'), { textContent: drop.title }),
        Object.assign(document.createElement('p'), { textContent: drop.id === sh.pinned ? 'Featured live right now' : `From ${sh.store || 'the seller’s store'}` }),
        priceEl(drop, sale, 'wv-drop-price'));
      row.append(skuThumb(drop), t); out.push(row);
      if (sale?.id === drop.id && sale.code) { const c = document.createElement('button'); c.type = 'button'; c.className = 'wv-sku-code'; c.innerHTML = 'Use code <code></code> at checkout · tap to copy'; c.querySelector('code').textContent = sale.code; c.onclick = buyWithCode(sale); out.push(c); }
      const stockLeft = typeof drop.stock === 'number' && drop.stock > 0 ? Math.max(0, drop.stock - (drop.sold || 0)) : null;
      const stockBadge = stockLeft !== null ? Object.assign(document.createElement('span'), { className: 'wv-stock-pill' + (stockLeft <= 5 ? ' low' : ''), textContent: stockLeft === 0 ? 'Sold out' : `${stockLeft} left!` }) : null;
      if (stockBadge) t.append(stockBadge);
      const acts = document.createElement('div'); acts.className = 'wv-drop-acts';
      const buyBtn = document.createElement('button');
      buyBtn.type = 'button';
      buyBtn.className = 'btn primary wv-drop-buy';
      buyBtn.disabled = stockLeft === 0;
      buyBtn.textContent = stockLeft === 0 ? 'Sold out' : `Buy now · ${salePriceOf(drop, sale) || money(drop.price)}`;
      buyBtn.onclick = () => buyProductInline(drop, sale);
      acts.append(buyBtn);
      const add = document.createElement('button'); add.type = 'button'; add.className = 'btn wv-drop-add'; add.textContent = W.addedId === drop.id ? 'Added ✓' : 'Add to bag'; add.onclick = () => addToBag(drop);
      acts.append(add); out.push(acts);
      if (items.length > 1) {
        const sw = document.createElement('div'); sw.className = 'wv-drop-switch';
        replaceKids(sw, ...items.slice(0, 4).map((p) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'wv-drop-chip' + (p.id === drop.id ? ' on' : '');
          b.setAttribute('aria-pressed', String(p.id === drop.id)); b.setAttribute('aria-label', `Show ${p.title}`);
          const tx = document.createElement('span'); tx.append(Object.assign(document.createElement('b'), { textContent: p.title }), Object.assign(document.createElement('small'), { className: 'num', textContent: salePriceOf(p, sale) || money(p.price) }));
          b.append(skuThumb(p), tx); b.onclick = () => { W.dropId = p.id; renderShopDrop(W.info, true); };
          return b;
        }));
        if (items.length > 4) { const more = document.createElement('button'); more.type = 'button'; more.className = 'wv-drop-more'; more.textContent = `See all ${items.length} in the Lookbook`; more.onclick = () => { W.shopTab = 'all'; renderShopDrop(W.info, true); }; sw.append(more); }
        out.push(sw);
      }
    } else if (W.shopTab === 'qa') {
      // Questions from the chat (the ✋ ask), most upvoted first. Asking here sends a chat question the host sees highlighted.
      const f = document.createElement('form'); f.className = 'wv-qa-ask';
      const inp = Object.assign(document.createElement('input'), { className: 'input', maxLength: 300, placeholder: 'Ask about sizing, materials, shipping…' });
      inp.setAttribute('aria-label', 'Ask the host a question');
      const go = Object.assign(document.createElement('button'), { type: 'submit', className: 'btn sm primary', textContent: 'Ask' });
      f.append(inp, go);
      f.onsubmit = (e) => { e.preventDefault(); const t = inp.value.trim(); if (!t) return inp.focus(); $('#wText').value = t; setAsk(true); $('#wCompose').requestSubmit(); inp.value = ''; };
      out.push(f);
      if (!qs.length) out.push(Object.assign(document.createElement('p'), { className: 'wv-mode-empty', textContent: 'No questions yet. Ask one and the host sees it highlighted.' }));
      else {
        const ul = document.createElement('ul'); ul.className = 'wv-qa';
        replaceKids(ul, ...qs.map((q) => {
          const li = document.createElement('li');
          li.append(Object.assign(document.createElement('p'), { textContent: q.text }));
          const meta = document.createElement('div'); meta.className = 'wv-qa-m';
          meta.append(Object.assign(document.createElement('span'), { textContent: q.name || 'Viewer' }));
          const up = document.createElement('button'); up.type = 'button'; up.className = 'wv-qa-up num'; up.setAttribute('aria-pressed', String(W.liked.has(q.id)));
          up.setAttribute('aria-label', `Upvote this question (${q.likes || 0})`); up.textContent = `▲ ${q.likes || 0}`;
          up.onclick = async () => { if (W.liked.has(q.id)) return; await likeMsg(q.id, up); q.likes = (q.likes || 0) + 1; renderShopDrop(W.info, true); };
          meta.append(up); li.append(meta);
          return li;
        }));
        out.push(ul);
      }
    } else if (W.shopTab === 'all') {
      const ul = document.createElement('ul'); ul.className = 'wv-look';
      replaceKids(ul, ...items.map((p, i) => {
        const li = document.createElement('li'); li.className = sale?.id === p.id ? 'sale' : '';
        const tx = document.createElement('div'); tx.className = 'wv-look-t';
        tx.append(Object.assign(document.createElement('span'), { className: 'wv-look-k num', textContent: `${String(i + 1).padStart(2, '0')} · ${p.id === sh.pinned ? 'Featured' : sale?.id === p.id ? 'Flash sale' : sh.store || 'Store'}` }),
          Object.assign(document.createElement('b'), { textContent: p.title }));
        const foot = document.createElement('div'); foot.className = 'wv-look-f';
        const add = document.createElement('button'); add.type = 'button'; add.className = 'btn sm'; add.textContent = W.addedId === p.id ? 'Added ✓' : '+ Bag'; add.onclick = () => addToBag(p);
        foot.append(priceEl(p, sale, 'wv-look-price'), add, buyLink(p, sale, 'Buy', 'btn sm primary'));
        tx.append(foot); li.append(skuThumb(p), tx);
        return li;
      }));
      out.push(ul);
    } else {
      const back = document.createElement('button'); back.type = 'button'; back.className = 'wv-bag-back'; back.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-chevron-left"/></svg><span>Back to the drop</span>';
      back.onclick = () => { W.shopTab = 'drop'; renderShopDrop(W.info, true); }; out.push(back);
      if (!bag.length) {
        out.push(Object.assign(document.createElement('p'), { className: 'wv-mode-empty', textContent: 'Your bag is empty. Add pieces from the drop and check out when you’re ready.' }));
      } else {
        const ul = document.createElement('ul'); ul.className = 'wv-bag';
        const cardBag = !!W.info?.watch?.shopCard; // one card payment for the whole bag, in the page
        let total = 0, sym = '$', known = true;
        replaceKids(ul, ...bag.map((x) => {
          const p = items.find((q) => q.id === x.id);
          const unit = parsePrice(salePriceOf(p, sale) || p.price); if (Number.isFinite(unit)) { total += unit * x.qty; sym = priceSym(p.price); } else known = false;
          const li = document.createElement('li');
          const tx = document.createElement('div'); tx.className = 'wv-bag-t';
          tx.append(Object.assign(document.createElement('b'), { textContent: p.title }), priceEl(p, sale, 'wv-look-price'));
          const q = document.createElement('div'); q.className = 'wv-qty';
          const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', `One fewer ${p.title}`);
          minus.onclick = () => { const b = getBag(); const it = b.find((y) => y.id === p.id); if (it) { it.qty -= 1; setBag(b.filter((y) => y.qty > 0)); } };
          const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', `One more ${p.title}`);
          plus.onclick = () => { const b = getBag(); const it = b.find((y) => y.id === p.id); if (it) { it.qty = Math.min(9, it.qty + 1); setBag(b); } };
          q.append(minus, Object.assign(document.createElement('span'), { className: 'num', textContent: String(x.qty) }), plus);
          li.append(skuThumb(p), tx, q, ...(cardBag ? [] : [buyLink(p, sale, 'Checkout', 'btn sm primary')]));
          return li;
        }));
        out.push(ul);
        const sum = document.createElement('div'); sum.className = 'wv-bag-sum';
        sum.append(Object.assign(document.createElement('span'), { textContent: `${count} item${count === 1 ? '' : 's'}` }), Object.assign(document.createElement('b'), { className: 'num', textContent: known ? fmtPrice(Math.round(total * 100) / 100, sym) : '' }));
        if (cardBag) {
          const pay = document.createElement('button'); pay.type = 'button'; pay.className = 'btn primary block wv-bag-pay'; pay.id = 'wBagPay';
          pay.textContent = known ? `Pay ${fmtPrice(Math.round(total * 100) / 100, sym)} · one checkout` : 'Pay for the bag';
          pay.onclick = () => checkoutBag(bag, total, () => setBag([]));
          out.push(sum, pay, Object.assign(document.createElement('p'), { className: 'wv-bag-note', textContent: 'Card, Apple Pay or Google Pay, right here. Sale prices are applied at checkout.' }));
        } else out.push(sum, Object.assign(document.createElement('p'), { className: 'wv-bag-note', textContent: `Each Checkout opens ${sh.store || 'the seller’s store'}${sale?.code ? `, with code ${sale.code} copied for the sale item` : ''}. Your bag stays on this device.` }));
      }
    }
    replaceKids(body, ...out);
  }
  // Arena: the lobby code to copy, Clip that, your XP (kept on this device, for fun: no money, nothing on a server),
  // XP wagers on predictions, and the streamer's rig & settings.
  const xpKey = () => 'xp:' + code;
  W.xp = Number(store.get(xpKey(), 100)); if (!Number.isFinite(W.xp)) W.xp = 100; // 100 XP to start, so a new viewer can wager straight away
  W.wagers = store.get('wagers:' + code, {});
  function awardXp(n) {
    W.xp = Math.max(0, W.xp + n); store.set(xpKey(), W.xp);
    const b = $('#wXpBadge'); if (b) { b.textContent = `${W.xp.toLocaleString()} XP`; b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
    renderPartyMe();
    const px = $('#wPtXp'); if (px) { px.classList.remove('bump'); void px.offsetWidth; px.classList.add('bump'); }
  }
  function placeWager(p, opt) {
    if (p.kind !== 'predict') { awardXp(10); return; }
    const stake = Math.min(W.wagerStake || 0, W.xp);
    W.wagers[p.id] = { opt, stake, settled: false };
    store.set('wagers:' + code, W.wagers);
    awardXp(10 - stake); // 10 for playing; the stake is held until the answer
  }
  function wagerRow(p, canBet) {
    const row = document.createElement('div'); row.className = 'wv-wager';
    const w = W.wagers[p.id];
    if (w) { row.append(Object.assign(document.createElement('span'), { textContent: w.stake ? `${w.stake} XP on “${p.opts[w.opt]}”` : 'No XP wagered' })); return row; }
    if (!canBet) return row;
    row.append(Object.assign(document.createElement('span'), { textContent: 'Wager' }));
    for (const amt of [0, 25, 50, 100]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'num' + ((W.wagerStake || 0) === amt ? ' on' : ''); b.textContent = amt ? `${amt} XP` : 'None';
      b.disabled = amt > W.xp; b.setAttribute('aria-pressed', String((W.wagerStake || 0) === amt));
      b.onclick = () => { W.wagerStake = amt; row.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); };
      row.append(b);
    }
    return row;
  }
  function settleWagers(info) {
    const p = info.poll; if (!p || p.kind !== 'predict' || !(p.answer >= 0)) return;
    const w = W.wagers[p.id]; if (!w || w.settled) return;
    w.settled = true; store.set('wagers:' + code, W.wagers);
    if (w.opt === p.answer) { awardXp(w.stake * 2 + 25); toast(`🎯 You called it! +${w.stake * 2 + 25} XP`); }
    else if (w.stake) toast(`Not this time: ${w.stake} XP lost.`);
  }
  function renderArena(info) {
    const w = info.watch || {}, top = $('#wArenaTop'); if (!top) return;
    const sc = info.score, bts = info.bounties || [];
    const key = JSON.stringify([w.lobby, !$('#wClip')?.hidden, sc, bts]);
    if (top.dataset.k !== key) {
      const prevSc = top.dataset.sc ? JSON.parse(top.dataset.sc) : null;
      top.dataset.k = key; top.dataset.sc = JSON.stringify(sc || null);
      const parts = [];
      if (sc) {
        const m = document.createElement('div'); m.className = 'wv-match';
        const side = (n, s, c, flash, right) => { const d = document.createElement('div'); d.className = 'wv-match-side' + (right ? ' r' : '') + (flash ? ' flash' : ''); d.style.setProperty('--c', c); d.append(Object.assign(document.createElement('b'), { textContent: n }), Object.assign(document.createElement('strong'), { className: 'num', textContent: String(s) })); return d; };
        const mid = document.createElement('div'); mid.className = 'wv-match-mid';
        mid.append(Object.assign(document.createElement('span'), { textContent: sc.round || 'Live' }), ...(sc.map ? [Object.assign(document.createElement('em'), { textContent: sc.map })] : []));
        m.append(side(sc.a, sc.sa, sc.ca, prevSc && prevSc.sa !== sc.sa), mid, side(sc.b, sc.sb, sc.cb, prevSc && prevSc.sb !== sc.sb, true));
        parts.push(m);
      }
      if (bts.length) {
        const bb = document.createElement('div'); bb.className = 'wv-bounties';
        bb.append(Object.assign(document.createElement('b'), { className: 'wv-bounties-h', textContent: '🎯 Bounties' }), ...bts.slice().reverse().map((x) => {
          const r = document.createElement('div'); r.className = 'wv-bounty ' + x.status;
          r.append(Object.assign(document.createElement('strong'), { className: 'num', textContent: x.status === 'done' ? '✓' : x.status === 'failed' ? '✗' : x.amount }), Object.assign(document.createElement('span'), { textContent: x.text }), Object.assign(document.createElement('em'), { textContent: x.name }));
          return r;
        }));
        parts.push(bb);
      }
      if (w.lobby) {
        const l = document.createElement('div'); l.className = 'wv-lobby';
        l.append(Object.assign(document.createElement('span'), { textContent: 'Lobby' }), Object.assign(document.createElement('code'), { textContent: w.lobby }));
        const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn sm'; cp.textContent = 'Copy';
        cp.onclick = () => navigator.clipboard?.writeText(w.lobby).then(() => { toast('Lobby code copied.'); awardXp(2); }).catch(() => toast(w.lobby));
        l.append(cp); parts.push(l);
      }
      if ($('#wClip') && !$('#wClip').hidden) {
        const c = document.createElement('button'); c.type = 'button'; c.className = 'btn sm wv-clipit'; c.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-scissors"/></svg><span>Clip that</span>';
        c.onclick = () => { $('#wClip').click(); awardXp(5); }; parts.push(c);
      }
      replaceKids(top, ...parts); top.hidden = !parts.length;
    }
    const rig = $('#wArenaRig'), lines = String(w.rig || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10);
    const rk = lines.join('|');
    if (rig.dataset.k !== rk) {
      rig.dataset.k = rk; rig.hidden = !lines.length;
      replaceKids(rig, Object.assign(document.createElement('b'), { textContent: 'Rig & settings' }), ...lines.map((ln) => {
        const i = ln.indexOf(':'), row = document.createElement('div');
        if (i > 0) row.append(Object.assign(document.createElement('span'), { textContent: ln.slice(0, i) }), Object.assign(document.createElement('em'), { textContent: ln.slice(i + 1).trim() }));
        else row.append(Object.assign(document.createElement('em'), { textContent: ln }));
        return row;
      }));
    }
  }
  return { MODE_CFG, renderInteractive, scrollToMode, buyWithCode, skuThumb, salePriceOf, renderShopDrop, awardXp, placeWager, wagerRow, settleWagers, renderArena };
}
