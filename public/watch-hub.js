import { replaceKids } from './ui.js';

// Watch party hub under the video: creator profile and the showcase tabs (notices, what's next, AI spotlight).
// Created by app.js through createWatchHub(app): `app` carries the studio state and helpers this part uses.
export function createWatchHub(app) {
  const {
    $, $$, W, api, nameColor, openTipDock, openHostDrawer, setTab, MODE_CFG, scrollToMode, voiceOpen,
    initialsOf, handleSubClick, countdownText
  } = app;
  // ---------------------------------------------------------------- Watch Party Bento Hub (Creator Profile + Showcase)
  const STREAM_TYPES = {
    live: { label: 'Stream', short: 'Stream', icon: 'i-radio' },
    shopping: { label: 'Live Shopping', short: 'Shopping', icon: 'i-shopping-bag' },
    gamer: { label: 'Gamer Stream', short: 'Gamer', icon: 'i-gamepad-2' },
  };
  function fetchWAsset(id) {
    if (!id) return Promise.resolve('');
    if (!W.assetCache.has(id)) {
      W.assetCache.set(id, api('wasset', { asset: id }).then((r) => r.data || '').catch(() => ''));
    }
    return W.assetCache.get(id);
  }
  function renderStreamType(info) {
    const type = STREAM_TYPES[info.streamType] ? info.streamType : 'live';
    const cfg = STREAM_TYPES[type];
    const badge = $('#wWatchBadge');
    if (badge) {
      badge.dataset.type = type;
      const onAir = W.source === 'direct' ? W.direct?.state === 'live' : !!W.iframe;
      // The header's ON AIR pill already says live; the badge only says "Offline" when the show isn't on.
      badge.dataset.on = onAir ? '1' : '';
      $('#wWatchBadgeTxt').textContent = onAir ? cfg.label : `Offline · ${cfg.label}`;
      $('#wWatchBadgeIcon')?.setAttribute('href', `/icons.svg#${cfg.icon}`);
    }
    if ($('#wCreatorType')) $('#wCreatorType').textContent = cfg.label;
  }
  function renderCreatorCard(info) {
    const card = $('#wCreatorCard');
    if (!card) return;
    const h = info.host || {}, w = info.watch || {};
    $('#wCreatorName').textContent = h.name || 'Broadcast Host';
    $('#wCreatorHandle').textContent = h.handle ? `@${h.handle}` : (info.found ? 'Live broadcast room' : 'Watch party');
    $('#wCreatorTitle').textContent = info.title || 'Live show';
    $('#wCreatorAbout').textContent = w.about || 'Tune in, drop live reactions in chat, and catch real-time show notices.';
    const here = info.found ? (info.here || []) : [], nView = info.found ? info.viewers || 0 : 0;
    $('#wCreatorHere').hidden = nView < 1;
    const hk = here.join('|') + nView;
    if ($('#wCreatorHere').dataset.k !== hk) {
      $('#wCreatorHere').dataset.k = hk;
      replaceKids($('#wCreatorAvs'), ...here.slice(0, 5).map((nm) => { const a = document.createElement('i'); a.textContent = initialsOf(nm); a.title = nm; a.style.background = nameColor(nm); return a; }));
      const others = Math.max(0, nView - Math.min(5, here.length));
      $('#wCreatorHereN').textContent = nView <= 1 ? 'You’re first here · share the link to start the party' : here.length ? `${here.slice(0, 2).join(', ')}${others ? ` +${others.toLocaleString()}` : ''} watching with you` : `${(nView - 1).toLocaleString()} watching with you`;
    }

    const tags = Array.isArray(info.hashtags) ? info.hashtags.filter(Boolean).slice(0, 8) : [];
    const tagsBox = $('#wCreatorTags');
    tagsBox.hidden = !tags.length;
    const tagKey = tags.join('|');
    if (tagsBox.dataset.k !== tagKey) {
      tagsBox.dataset.k = tagKey;
      replaceKids(tagsBox, ...tags.map((t) => {
        const s = document.createElement('span');
        s.className = 'wv-tag';
        s.textContent = t.startsWith('#') ? t : '#' + t;
        return s;
      }));
    }

    const logo = $('#wCreatorLogo');
    const logoKey = `${info.brandLogo || ''}|${W.hostAvatar ? 'av' : ''}|${h.name || ''}`;
    if (logo.dataset.k !== logoKey) {
      logo.dataset.k = logoKey;
      logo.textContent = initialsOf(h.name || info.title || 'G');
      if (info.brandLogo) {
        fetchWAsset(info.brandLogo).then((data) => {
          if (!data || logo.dataset.k !== logoKey) return;
          const im = document.createElement('img'); im.src = data; im.alt = '';
          replaceKids(logo, im);
        });
      } else if (W.hostAvatar) {
        const im = document.createElement('img'); im.src = W.hostAvatar; im.alt = '';
        replaceKids(logo, im);
      }
    }
  }
  $('#wCardMoreBtn')?.addEventListener('click', () => openHostDrawer(true));
  $('#wCardShare')?.addEventListener('click', () => $('#wShareTop').click());

  function setShowcaseTab(tab) {
    const mapped = (tab === 'notices' || tab === 'next' || tab === 'spotlight') ? 'about' : tab;
    W.scTab = mapped;
    $$('[data-sc-tab]').forEach((b) => {
      const on = b.dataset.scTab === mapped;
      b.setAttribute('aria-selected', String(on));
    });
    if ($('#wPaneParty')) $('#wPaneParty').hidden = mapped !== 'party';
    if ($('#wPaneAbout')) $('#wPaneAbout').hidden = mapped !== 'about';
    if ($('#wPaneCatchup')) $('#wPaneCatchup').hidden = mapped !== 'catchup';
    if ($('#wPaneRoom')) $('#wPaneRoom').hidden = mapped !== 'room';
    moveScInd();
  }
  // The gradient underline glides to the selected tab.
  function moveScInd() {
    const ind = $('#wScInd'), on = $('[data-sc-tab][aria-selected="true"]'); if (!ind || !on) return;
    ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  addEventListener('resize', () => moveScInd());
  requestAnimationFrame(() => moveScInd());
  $$('[data-sc-tab]').forEach((b) => b.addEventListener('click', () => setShowcaseTab(b.dataset.scTab)));

  function renderShowcase(info) {
    const notices = Array.isArray(info.notices) ? info.notices : [];
    const next = info.whatNext || info.next || null;
    const spot = info.aiSpotlight || null;

    if ($('#wCntNotices')) { $('#wCntNotices').hidden = !notices.length; $('#wCntNotices').textContent = String(notices.length); }
    if ($('#wCntSpot')) $('#wCntSpot').hidden = !spot;

    const nBox = $('#wNoticesList');
    const w = info.watch || {};
    const canMic = w.voice !== false && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
    const canTip = !!(w.supers && w.chat !== false);
    const mode = info.found && MODE_CFG[info.streamType] ? info.streamType : '';
    const nKey = JSON.stringify([notices, canMic, canTip, info.found, mode]);
    if (nBox && nBox.dataset.k !== nKey) {
      nBox.dataset.k = nKey;
      if (!notices.length) {
        const deck = document.createElement('div');
        deck.className = 'wv-sc-welcome';
        const mkAct = (icon, title, sub, fn) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wv-sc-act';
          b.innerHTML = `<span class="wv-sc-act-ic"><svg class="i sm" aria-hidden="true"><use href="/icons.svg#${icon}"/></svg></span><span class="wv-sc-act-txt"><b></b><span></span></span>`;
          b.querySelector('b').textContent = title;
          b.querySelector('.wv-sc-act-txt span').textContent = sub;
          b.onclick = fn;
          return b;
        };
        const items = [
          ...(mode === 'shopping' ? [mkAct('i-shopping-bag', 'Shop the show', 'Every product from this stream, one tap to buy', () => scrollToMode())] : []),
          ...(mode === 'gamer' ? [mkAct('i-gamepad-2', 'Play with the streamer', 'Join the line and make your predictions', () => scrollToMode())] : []),
          mkAct('i-sparkles', 'Interactive Stage', 'Join live polls, drops, and queue games', () => setTab('stage')),
          mkAct('i-activity', 'Room Pulse', 'Check crowd sentiment, pins, and viewers', () => setTab('pulse')),
        ];
        if (canMic) items.push(mkAct('i-mic', 'Ask by Voice', 'Record a 45s voice question for the host', () => voiceOpen()));
        if (canTip) items.push(mkAct('i-tip', 'Send a Super Chat', 'Tip the streamer directly, right in chat', () => openTipDock()));
        if (items.length < 4) items.push(mkAct('i-share-2', 'Invite Friends', 'Share this Watch Party link', () => $('#wShareTop').click()));
        if (items.length < 4) items.push(mkAct('i-info', 'Show Details', 'View links, platforms, and host bio', () => openHostDrawer(true)));
        replaceKids(deck, ...items.slice(0, 4));
        replaceKids(nBox, deck);
      } else {
        replaceKids(nBox, ...notices.map((n) => {
          const card = document.createElement('article');
          card.className = 'wv-notice-card' + (n.kind === 'ad' ? ' ad' : '');
          const top = document.createElement('div'); top.className = 'wv-notice-top';
          const kind = document.createElement('span'); kind.className = 'wv-notice-kind'; kind.textContent = n.kind || 'notice';
          top.append(kind);
          card.append(top);
          if (n.imgAsset) {
            const im = document.createElement('img'); im.className = 'wv-notice-img'; im.alt = n.head || 'Notice media'; im.hidden = true;
            card.append(im);
            fetchWAsset(n.imgAsset).then((data) => { if (data) { im.src = data; im.hidden = false; } });
          }
          if (n.head) card.append(Object.assign(document.createElement('h3'), { textContent: n.head }));
          if (n.body) card.append(Object.assign(document.createElement('p'), { textContent: n.body }));
          if (n.ctaUrl) {
            const a = document.createElement('a'); a.className = 'btn sm primary'; a.href = n.ctaUrl; a.target = '_blank'; a.rel = 'noopener nofollow';
            a.textContent = n.ctaLabel || 'Open link';
            card.append(a);
          }
          return card;
        }));
      }
    }

    const nextBox = $('#wNextBox');
    const nextKey = JSON.stringify([next, !!info.host?.alerts]);
    if (nextBox && nextBox.dataset.k !== nextKey) {
      nextBox.dataset.k = nextKey;
      if (!next || (!next.title && !next.when && !next.desc)) {
        const em = document.createElement('div'); em.className = 'wv-sc-empty';
        em.append(Object.assign(document.createElement('b'), { textContent: 'No upcoming schedule posted' }));
        em.append(Object.assign(document.createElement('span'), { textContent: 'Subscribe for an instant alert the moment the host goes live next.' }));
        if (info.host?.alerts) {
          const subBtn = document.createElement('button'); subBtn.type = 'button'; subBtn.className = 'btn sm primary';
          subBtn.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-bell"/></svg>Notify me next show';
          subBtn.onclick = () => handleSubClick();
          em.append(subBtn);
        }
        replaceKids(nextBox, em);
      } else {
        const card = document.createElement('div'); card.className = 'wv-next-card';
        const top = document.createElement('div'); top.className = 'wv-next-top';
        const h3 = document.createElement('h3'); h3.textContent = next.title || 'Next Broadcast';
        top.append(h3);
        if (next.when) {
          const cd = document.createElement('span'); cd.className = 'wv-next-cd'; cd.dataset.nextCd = String(next.when);
          cd.textContent = countdownText(Number(next.when));
          top.append(cd);
        }
        card.append(top);
        if (next.desc) card.append(Object.assign(document.createElement('p'), { textContent: next.desc }));
        if (info.host?.alerts) {
          const rem = document.createElement('button'); rem.type = 'button'; rem.className = 'btn sm primary';
          rem.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-bell"/></svg>Remind me when live';
          rem.onclick = () => handleSubClick();
          card.append(rem);
        }
        replaceKids(nextBox, card);
      }
    }

    const spotBox = $('#wSpotlightBox');
    const spotKey = JSON.stringify(spot);
    if (spotBox && spotBox.dataset.k !== spotKey) {
      spotBox.dataset.k = spotKey;
      if (!spot || (!spot.head && !(spot.bullets || []).length && !(spot.links || []).length)) {
        const em = document.createElement('div'); em.className = 'wv-sc-empty';
        em.append(Object.assign(document.createElement('b'), { textContent: 'Show takeaways & curated links' }));
        em.append(Object.assign(document.createElement('span'), { textContent: 'Key highlights, chapter notes, and host links surface here live during the broadcast.' }));
        replaceKids(spotBox, em);
      } else {
        const card = document.createElement('div'); card.className = 'wv-spot-card';
        if (spot.head) card.append(Object.assign(document.createElement('h3'), { textContent: spot.head }));
        if ((spot.bullets || []).length) {
          const ul = document.createElement('ul'); ul.className = 'wv-spot-bullets';
          for (const pt of spot.bullets) ul.append(Object.assign(document.createElement('li'), { textContent: pt }));
          card.append(ul);
        }
        if ((spot.links || []).length) {
          const row = document.createElement('div'); row.className = 'wv-spot-links';
          for (const l of spot.links) {
            if (!l?.url) continue;
            const a = document.createElement('a'); a.className = 'btn sm'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener nofollow';
            a.textContent = l.label || l.url;
            row.append(a);
          }
          if (row.children.length) card.append(row);
        }
        replaceKids(spotBox, card);
      }
    }
  }

  const SHARE = {
    x: (u, t) => `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    facebook: (u) => `https://www.facebook.com/sharer/sharer.php?u=${u}`,
    linkedin: (u) => `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    reddit: (u, t) => `https://www.reddit.com/submit?url=${u}&title=${t}`,
    whatsapp: (u, t) => `https://wa.me/?text=${t}%20${u}`,
  };
  $$('[data-share]').forEach((b) => b.addEventListener('click', () => {
    const u = encodeURIComponent(location.origin + location.pathname), t = encodeURIComponent(`Watch ${W.info?.title || 'this show'} live`);
    window.open(SHARE[b.dataset.share](u, t), 'share', 'width=620,height=640,noopener');
  }));
  $('#wShareTop').onclick = () => {
    if (navigator.share) navigator.share({ title: document.title, url: location.origin + location.pathname }).catch(() => {});
    else openHostDrawer(true);
  };
  $('#wEmptyShare').onclick = () => $('#wShareTop').click();

  return { renderStreamType, renderCreatorCard, renderShowcase };
}
