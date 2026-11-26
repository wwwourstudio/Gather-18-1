import { replaceKids } from './ui.js';

// The watch party: friends watching together beside the stream.
// Created by watch.js through createWatchParty(app): `app` carries the watch page state and helpers this part uses.
export function createWatchParty(app) {
  const {
    $, $$, code, ACCT, W, store, api, creds, toast, updateStageStatus, money, MODE_CFG, renderInteractive,
    scrollToMode, buyWithCode, skuThumb, salePriceOf, renderShopDrop, awardXp, settleWagers, renderArena
  } = app;
  // ---------------------------------------------------------------- the watch party: top fans, your XP, watch-time badges
  const BADGES = [[0, '👀', 'Just arrived'], [5, '📺', 'Tuned in'], [15, '⭐', 'Regular'], [30, '💎', 'Superfan'], [60, '👑', 'Legend']];
  W.watched = Number(store.get('watched:' + code, 0)) || 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible' || !W.info?.found) return;
    W.watched += 1; store.set('watched:' + code, W.watched);
    const now = BADGES.filter(([m]) => W.watched >= m).pop();
    if (now[0] === W.watched && W.watched > 0) toast(`${now[1]} New badge: ${now[2]}`);
    awardXp(1);
  }, 60_000);
  const AV_COLORS = ['#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#60a5fa'];
  function avColor(name) {
    let h = 0; const s = String(name || 'G');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV_COLORS[h % AV_COLORS.length];
  }
  function avInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '★';
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }
  function renderPartyMe() {
    if (!$('#wPtXp')) return;
    $('#wPtXp').textContent = `${W.xp.toLocaleString()} XP`;
    const i = BADGES.filter(([m]) => W.watched >= m).length - 1, [m0, ic, name] = BADGES[i], nxt = BADGES[i + 1];
    $('#wPtBadgeIc').textContent = ic; $('#wPtBadgeName').textContent = name;
    $('#wPtBadgeNext').textContent = nxt ? `${nxt[0] - W.watched} min to “${nxt[2]}”` : `${W.watched} min watched · top badge`;
    $('#wPtProg').style.width = (nxt ? Math.round((W.watched - m0) / (nxt[0] - m0) * 100) : 100) + '%';
    const meta = $('#wPtWatchMeta');
    if (meta) meta.textContent = W.watched > 0 ? `${W.watched}m in party · +1 XP/min` : '+1 XP/min watching & reacting';
  }
  function renderParty(info) {
    // Top fans: super chats count most, then chat; from what this show's chat holds right now.
    const by = new Map();
    for (const m of W.recentChat || []) {
      if (!m.name || m.src === 'studio' || m.host) continue;
      const r = by.get(m.name) || { name: m.name, paid: 0, msgs: 0 };
      if (m.paid && m.status !== 'pending') r.paid += Number(String(m.paid).replace(/[^0-9.]/g, '')) || 0; else r.msgs += 1;
      by.set(m.name, r);
    }
    for (const tf of info?.topFans || []) {
      if (!tf?.name) continue;
      const r = by.get(tf.name) || { name: tf.name, paid: 0, msgs: 0, xp: 0 };
      r.xp = Math.max(r.xp || 0, Number(tf.xp) || 0);
      by.set(tf.name, r);
    }
    const rows = [...by.values()].map((r) => ({ ...r, score: r.paid * 10 + (r.xp || 0) * 0.25 + r.msgs })).sort((a, b) => b.score - a.score);
    const me = app.sess?.named ? app.sess.name : ACCT?.user?.name || '';
    const myRank = me ? rows.findIndex((r) => r.name === me) : -1;
    const key = JSON.stringify([rows.slice(0, 3), myRank]);
    if ($('#wPtBoard').dataset.k !== key) {
      $('#wPtBoard').dataset.k = key;
      const medal = ['🥇', '🥈', '🥉'];
      const items = rows.slice(0, 3).map((r, i) => {
        const li = document.createElement('li'); if (r.name === me) li.className = 'me';
        const metric = r.paid ? `$${Number.isInteger(r.paid) ? r.paid : r.paid.toFixed(2)}` : r.xp ? `${r.xp} XP` : `${r.msgs} msg${r.msgs === 1 ? '' : 's'}`;
        li.append(Object.assign(document.createElement('span'), { className: 'wv-pt-medal', textContent: medal[i] }), Object.assign(document.createElement('b'), { textContent: r.name }),
          Object.assign(document.createElement('em'), { className: 'num', textContent: metric }));
        return li;
      });
      if (myRank >= 3) { const li = document.createElement('li'); li.className = 'me'; li.append(Object.assign(document.createElement('span'), { className: 'wv-pt-medal num', textContent: `#${myRank + 1}` }), Object.assign(document.createElement('b'), { textContent: 'You' }), Object.assign(document.createElement('em'), { className: 'num', textContent: rows[myRank].xp ? `${rows[myRank].xp} XP` : `${rows[myRank].msgs} msgs` })); items.push(li); }
      if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Chat, react, or tip to claim #1.'; items.push(li); }
      replaceKids($('#wPtBoard'), ...items);
    }

    // Watch party small avatars row inside Room meter
    const avBox = $('#wPartyAvs');
    const avMeta = $('#wPartyAvMeta');
    if (avBox) {
      const seen = new Set();
      const people = [];
      const addP = (nm, isHost = false) => {
        const clean = String(nm || '').trim();
        if (!clean || seen.has(clean.toLowerCase())) return;
        seen.add(clean.toLowerCase());
        people.push({ name: clean, isHost });
      };
      if (me) addP(me);
      for (const nm of info?.here || []) addP(nm);
      for (const r of rows) addP(r.name);
      if (info?.host?.name) addP(info.host.name, true);
      if (!people.length) addP('You');
      const viewers = Math.max(Number(info?.viewers) || 0, people.length);
      const shown = people.slice(0, 5);
      const extra = Math.max(0, viewers - shown.length);
      const avKey = JSON.stringify([shown, extra]);
      if (avBox.dataset.k !== avKey) {
        avBox.dataset.k = avKey;
        const nodes = shown.map((p) => {
          const dot = document.createElement('span');
          dot.className = 'wv-pav' + (p.isHost ? ' host' : '');
          dot.textContent = avInitials(p.name);
          dot.title = p.isHost ? `${p.name} (Host)` : p.name;
          dot.style.background = avColor(p.name);
          return dot;
        });
        if (extra > 0) {
          const more = document.createElement('span');
          more.className = 'wv-pav more num';
          more.textContent = `+${extra > 99 ? '99' : extra}`;
          more.title = `${viewers.toLocaleString()} watching`;
          nodes.push(more);
        }
        replaceKids(avBox, ...nodes);
      }
      if (avMeta) avMeta.textContent = `${viewers.toLocaleString()} in party`;
    }

    $('#wCntParty').hidden = !(info.viewers > 1); $('#wCntParty').textContent = info.viewers > 1 ? String(info.viewers) : '';
    renderPartyMe();
  }
  $('#wPtHypeIt')?.addEventListener('click', (e) => {
    app.sendReact('🔥');
    const b = e.currentTarget; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  });
  $$('.wv-pt-qreact').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.sendReact(btn.dataset.qreact || '🔥');
      btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    });
  });
  function renderPlayExtras(info) {
    renderArena(info); settleWagers(info); // before the up-next check below, which returns early when the line hasn't changed
    const qph = $('#wModeQueueEmpty'), pph = $('#wModePollEmpty'), qi0 = info.queue || {};
    if (qph) qph.hidden = !!(qi0.open || W.called);
    if (pph) pph.hidden = !!info.poll;
    const qi = info.queue || {}, up = qi.up || [];
    $('#wModeSub').textContent = qi.open ? (qi.size ? `${qi.size} in the play-with-me line` : 'The play-with-me line is open') + (info.poll && info.poll.until > Date.now() ? ' · prediction open' : '') : info.poll && info.poll.until > Date.now() ? 'Prediction open: make your call' : 'Polls, predictions and the play-with-me line land here';
    const next = $('#wModeUpNext'); if (!next) return;
    const key = JSON.stringify([qi.open, up]);
    if (next.dataset.k === key) return;
    next.dataset.k = key;
    next.hidden = !qi.open || !up.length;
    replaceKids(next, Object.assign(document.createElement('span'), { className: 'wv-upnext-l', textContent: 'Up next' }), ...up.map((n, i) => {
      const c = document.createElement('span'); c.className = 'wv-upnext-c' + (n === app.sess?.name ? ' me' : '');
      c.append(Object.assign(document.createElement('b'), { className: 'num', textContent: String(i + 1) }), document.createTextNode(n === app.sess?.name ? `${n} (you)` : n));
      return c;
    }));
  }
  function renderMode(info) {
    const type = info.found && MODE_CFG[info.streamType] ? info.streamType : '';
    $('#wv').dataset.mode = type || 'live';
    const box = $('#wMode');
    box.hidden = !type;
    if (W.modeType !== type) {
      W.modeType = type;
      const body = $('#wModeBody'); body.dataset.k = ''; replaceKids(body);
      if (type) { $('#wModeIcon').setAttribute('href', '/icons.svg#' + MODE_CFG[type].icon); $('#wModeTitle').textContent = MODE_CFG[type].title; }
      $('#wModeTabs').hidden = true; $('#wBagBtn').hidden = true; W.shopTab = 'drop';
      $('#wXpBadge').hidden = type !== 'gamer'; $('#wXpBadge').textContent = `${W.xp.toLocaleString()} XP`;
      $('#wTabShop').classList.toggle('mode-hidden', type === 'shopping');
      if (type === 'gamer') {
        body.innerHTML = `<div class="wv-arena-top" id="wArenaTop"></div><div class="wv-play">
        <div class="wv-play-col"><div class="wv-cards" id="wModeQueue"></div><div class="wv-play-empty" id="wModeQueueEmpty"><b>🎮 The line is closed</b><span>When the streamer opens it, you can join with your gamertag and get called up to play.</span></div><div class="wv-upnext" id="wModeUpNext" hidden></div></div>
        <div class="wv-play-col"><div class="wv-cards" id="wModePoll"></div><div class="wv-play-empty" id="wModePollEmpty"><b>🔮 No prediction yet</b><span>Calls like “Do we clutch this round?” show up here. Wager your XP before it locks.</span></div></div>
      </div><div class="wv-rig" id="wArenaRig" hidden></div>`;
      }
    }
    if (type === 'shopping') renderShopDrop(info);
  }
  $('#wModeMin')?.addEventListener('click', () => {
    const min = !$('#wMode').classList.toggle('min');
    $('#wModeMin').setAttribute('aria-expanded', String(min)); $('#wModeMin').setAttribute('aria-label', min ? 'Collapse panel' : 'Expand panel');
  });
  $('#wBagBtn')?.addEventListener('click', () => { W.shopTab = W.shopTab === 'bag' ? 'drop' : 'bag'; $('#wMode').classList.remove('min'); renderShopDrop(W.info, true); });

  // On the video: the one thing worth acting on right now (the featured product, or the open line / prediction).
  function renderHotspot(info) {
    const hs = $('#wHotspot'); if (!hs) return;
    let key = 'none', build = null;
    const sh = info.shop || {}, sale = sh.sale && sh.sale.until > Date.now() ? sh.sale : null;
    const pinned = W.modeType === 'shopping' && (sh.items || []).find((x) => x.id === sh.pinned);
    const qi = info.queue || {}, poll = info.poll && info.poll.until > Date.now() ? info.poll : null;
    if (pinned && !W.hotspotHidden) {
      const s = sale?.id === pinned.id ? sale : null;
      key = JSON.stringify(['p', pinned, s]);
      build = () => {
        const a = document.createElement('div'); a.className = 'wv-hs wv-hs-prod' + (s ? ' sale' : '');
        const txt = document.createElement('div'); txt.className = 'wv-hs-txt';
        const k = document.createElement('span'); k.className = 'wv-hs-k'; k.textContent = s ? `⚡ ${s.pct ? s.pct + '% off' : 'Flash sale'}` : 'Featured now';
        if (s) { const cd = document.createElement('span'); cd.className = 'num'; cd.dataset.until = s.until; k.append(' · ', cd); }
        txt.append(k, Object.assign(document.createElement('b'), { textContent: pinned.title }), Object.assign(document.createElement('span'), { className: 'wv-hs-p num', textContent: salePriceOf(pinned, s) || money(pinned.price) }));
        const buy = document.createElement('a'); buy.className = 'btn sm primary'; buy.href = pinned.url; buy.target = '_blank'; buy.rel = 'noopener'; buy.textContent = 'Buy'; buy.onclick = buyWithCode(s);
        const x = document.createElement('button'); x.type = 'button'; x.className = 'wv-hs-x'; x.setAttribute('aria-label', 'Hide product card'); x.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-x"/></svg>';
        x.onclick = () => { W.hotspotHidden = true; renderHotspot(W.info); };
        a.append(skuThumb(pinned), txt, buy, x);
        return a;
      };
    } else if (W.modeType === 'gamer' && (W.called || (qi.open && !W.queued) || (poll && W.votes[poll.id] == null))) {
      const mode = W.called ? 'called' : qi.open && !W.queued ? 'queue' : 'poll';
      key = JSON.stringify(['g', mode, qi.size, poll?.id]);
      build = () => {
        const b = document.createElement(mode === 'called' ? 'a' : 'button'); b.className = 'wv-hs wv-hs-play' + (mode === 'called' ? ' up' : '');
        if (mode === 'called') { b.href = '/c/' + code; b.target = '_blank'; b.rel = 'noopener'; } else b.type = 'button';
        const ic = document.createElement('span'); ic.className = 'wv-hs-ic'; ic.textContent = mode === 'poll' ? '🔮' : '🎮';
        const txt = document.createElement('span'); txt.className = 'wv-hs-txt';
        txt.append(Object.assign(document.createElement('b'), { textContent: mode === 'called' ? 'You’re up! Join the stage' : mode === 'queue' ? 'Play with the streamer' : poll.q }),
          Object.assign(document.createElement('span'), { textContent: mode === 'called' ? 'The streamer called you' : mode === 'queue' ? (qi.size ? `${qi.size} in line · join now` : 'Be first in line') : 'Prediction open · make your call' }));
        b.append(ic, txt);
        if (mode !== 'called') b.onclick = () => scrollToMode(mode === 'queue' ? '#wModeQueue input' : '#wModePoll .wv-vote button');
        return b;
      };
    }
    if (hs.dataset.k === key) return;
    hs.dataset.k = key;
    hs.hidden = !build;
    replaceKids(hs, ...(build ? [build()] : []));
  }

  setInterval(async () => {
    if (!W.queued || W.called || !app.sess) return;
    try {
      const r = await api('wping', creds());
      if (r.queue?.status === 'called') { W.called = true; toast('🎮 You’re up! Open Stage to join.'); try { new AudioContext().resume(); } catch {} renderInteractive(W.info); updateStageStatus(W.info); }
    } catch {}
  }, 8000);

  return { renderPartyMe, renderParty, renderPlayExtras, renderMode, renderHotspot };
}
