import { icon, replaceKids } from './ui.js';

// Stream tab (format, captions, upcoming) and the unified Go Live Now & Schedule launchpad.
// Created by app.js through createBroadcast(app): `app` carries the studio state and helpers this part uses.
export function createBroadcast(app) {
  const {
    $, $$, store, S, isHost, normalizeHex, hexLuminance, toast, initials, copy, fmtSec, resetAutoMuteTimer,
    setStage, canvas, TPL, templatePatch, acct, acctApi, openAccount, savedBrandImgs, aiImageSource,
    drawThumb, renderSocialMatrix, renderScenes, openEnter
  } = app;
  // ---------------------------------------------------------------- stream tab: format, captions, upcoming
  S.streams = [];
  const streamPrefs = () => store.get('streamPrefs', {});
  function setStreamPref(patch) { store.set('streamPrefs', { ...streamPrefs(), ...patch }); }
  $$('#aspectSeg button').forEach((b) => b.addEventListener('click', () => {
    if (!isHost()) return;
    if (S.rec) return toast('Stop recording before changing the format.', { err: true });
    const aspect = b.dataset.aspect;
    setStreamPref({ aspect });
    const patch = { aspect };
    if (S.state.layout === 'custom') { const t = aspect === '9:16' ? TPL['v-solo'] : TPL['p-interview']; Object.assign(patch, templatePatch(t)); patch.aspect = aspect; }
    setStage(patch);
    toast(aspect === '9:16' ? 'Vertical 9:16 — ready for TikTok, Reels and Shorts.' : 'Landscape 16:9.');
  }));
  function syncAspect() {
    const v = S.state.aspect === '9:16';
    const w = v ? 720 : 1280, h = v ? 1280 : 720;
    if (app.W === w && app.H === h) return;
    app.W = w; app.H = h; canvas.width = w; canvas.height = h;
    $('#stage').classList.toggle('vertical', v);
    renderScenes();
  }
  $('#capSwitch').onchange = (e) => { if (!isHost()) return; const c = { ...S.state.captions, on: e.target.checked }; setStreamPref({ captions: c }); setStage({ captions: c }); };
  $('#capLang').onchange = (e) => { const c = { ...S.state.captions, lang: e.target.value }; setStreamPref({ captions: c }); setStage({ captions: c }); };
  $$('#capStyle button').forEach((b) => b.addEventListener('click', () => { const c = { ...S.state.captions, style: b.dataset.cs }; setStreamPref({ captions: c }); setStage({ captions: c }); }));
  $('#capSize').oninput = (e) => { const c = { ...S.state.captions, size: Number(e.target.value) }; setStreamPref({ captions: c }); setStage({ captions: c }); };
  const autoMuteObj = () => ({ on: true, sec: 30, scope: 'guests', ...(S.state.autoMute || {}) });
  $('#studioMuteChk').onchange = (e) => {
    if (!isHost()) return;
    const am = { ...autoMuteObj(), on: e.target.checked };
    setStreamPref({ autoMute: am }); setStage({ autoMute: am });
    resetAutoMuteTimer();
    toast(am.on ? `Auto-mute on (${fmtSec(am.sec)} of silence).` : 'Studio auto-mute off.');
  };
  let studioMuteT = 0;
  $('#studioMuteSec').oninput = (e) => {
    if (!isHost()) return;
    const sec = Number(e.target.value);
    $('#studioMuteSecVal').textContent = fmtSec(sec);
    clearTimeout(studioMuteT);
    studioMuteT = setTimeout(() => {
      const am = { ...autoMuteObj(), sec };
      setStreamPref({ autoMute: am }); setStage({ autoMute: am });
      resetAutoMuteTimer();
    }, 120);
  };
  $('#studioMuteSec').onchange = (e) => {
    if (!isHost()) return;
    clearTimeout(studioMuteT);
    const am = { ...autoMuteObj(), sec: Number(e.target.value) };
    setStreamPref({ autoMute: am }); setStage({ autoMute: am });
    resetAutoMuteTimer();
  };
  $$('#studioMuteScope button').forEach((b) => b.addEventListener('click', () => {
    if (!isHost()) return;
    const am = { ...autoMuteObj(), scope: b.dataset.scope === 'all' ? 'all' : 'guests' };
    setStreamPref({ autoMute: am }); setStage({ autoMute: am });
    resetAutoMuteTimer();
  }));
  const autoGridOn = () => S.state.autoGrid !== false && store.get('streamPrefs', {}).autoGrid !== false;
  $('#autoGridChk').onchange = (e) => {
    if (!isHost()) return;
    const on = e.target.checked;
    setStreamPref({ autoGrid: on }); setStage({ autoGrid: on });
    toast(on ? 'Auto-grid on: switches to Grid with 3+ speakers.' : 'Auto-grid off: shows a layout suggestion instead.');
  };
  function renderStreamPanel() {
    const host = isHost(), c = S.state.captions || {}, am = autoMuteObj(), ag = S.state.autoGrid !== false;
    $$('#aspectSeg button').forEach((b) => { b.classList.toggle('on', b.dataset.aspect === (S.state.aspect || '16:9')); b.disabled = !host; });
    $('#capSwitch').checked = !!c.on; $('#capSwitch').disabled = !host;
    $('#capLang').value = c.lang || 'en-US'; $('#capLang').disabled = !host;
    $$('#capStyle button').forEach((b) => { b.classList.toggle('on', b.dataset.cs === (c.style || 'bar')); b.disabled = !host; });
    $('#capSize').value = c.size || 26; $('#capSize').disabled = !host;
    $('#capOpts').hidden = !c.on;
    $('#capNote').textContent = (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'Each person’s browser transcribes their own mic. Works best in Chrome and Edge.' : 'This browser can’t transcribe speech. Guests on Chrome or Edge will still be captioned.';
    if ($('#autoGridChk')) {
      $('#autoGridChk').checked = ag; $('#autoGridChk').disabled = !host;
      $('#autoGridHint').textContent = ag ? 'Switches to Grid automatically when 3 or more people are on stage' : 'Off: suggests switching layouts without changing automatically';
    }
    $('#studioMuteChk').checked = am.on !== false; $('#studioMuteChk').disabled = !host;
    $('#studioMuteSec').value = String(am.sec); $('#studioMuteSec').disabled = !host;
    $('#studioMuteSecVal').textContent = fmtSec(am.sec);
    $$('#studioMuteScope button').forEach((b) => { const on = b.dataset.scope === am.scope; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.disabled = !host; });
    $('#studioMuteOpts').hidden = am.on === false;
    $('#studioMuteHint').textContent = am.on ? `Mutes ${am.scope === 'all' ? 'anyone' : 'inactive guests'} after ${fmtSec(am.sec)} of silence` : 'Off: microphones stay open until muted manually';
    // upcoming
    $('#upSignin').hidden = !!acct.user;
    $('#upWrap').hidden = !acct.user;
    if (acct.user && !S.streamsLoaded) loadStreams();
  }
  async function loadStreams() {
    S.streamsLoaded = true;
    try { const r = await acctApi('streamList'); S.streams = r.streams; S.mailReady = r.mailReady; renderUpcoming(); }
    catch { S.streamsLoaded = false; }
  }
  const fmtLocal = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function syncUpCarousel() {
    const wrap = $('#upWrap'), ul = $('#upList'), prev = $('#upPrev'), next = $('#upNext');
    if (!wrap || !ul) return;
    const landing = wrap.closest('#landing') !== null;
    const over = landing && ul.scrollWidth > ul.clientWidth + 4;
    wrap.dataset.overflow = over ? 'true' : 'false';
    if (prev) {
      prev.hidden = !over;
      prev.disabled = ul.scrollLeft <= 4;
    }
    if (next) {
      next.hidden = !over;
      next.disabled = ul.scrollLeft + ul.clientWidth >= ul.scrollWidth - 4;
    }
  }
  function renderUpcoming() {
    const ul = $('#upList');
    const rows = S.streams.filter((x) => x.status === 'scheduled' || (x.status === 'live' && Date.now() - x.when < 6 * 3600e3));
    $('#upEmpty').hidden = true; // "Plan a stream for later" already says it
    replaceKids(ul, ...rows.map((st) => {
      const li = document.createElement('li'); li.className = 'up-item';
      const top = document.createElement('div'); top.className = 'up-top';
      const t = document.createElement('b'); t.textContent = st.title; t.title = st.title;
      const badge = document.createElement('span'); badge.className = 'pill caps up-badge' + (st.status === 'live' ? ' live' : ''); badge.textContent = st.status === 'live' ? 'Live' : fmtLocal(st.when);
      top.append(t, badge);
      const meta = document.createElement('p'); meta.className = 'up-meta';
      meta.textContent = `${st.invites.length ? st.invites.length + ' invited' : 'No invites'}${st.mail?.scheduled ? ` · ${st.mail.scheduled} reminders` : ''}`;
      const row = document.createElement('div'); row.className = 'row';
      const btn = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = label; b.onclick = fn; return b; };
      const iconBtn = (ic, tip, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn sm up-act ' + cls;
        b.setAttribute('aria-label', tip);
        b.dataset.tip = tip;
        b.innerHTML = icon(ic, { size: 'sm' });
        b.onclick = fn;
        return b;
      };
      const cancelBtn = iconBtn('trash-2', 'Cancel stream', 'danger', (ev) => {
        const b = ev.currentTarget;
        if (b.dataset.confirm) { cancelStream(st); return; }
        b.dataset.confirm = '1';
        b.className = 'btn sm danger up-act-confirm';
        b.textContent = 'Confirm';
        setTimeout(() => {
          if (!b.isConnected) return;
          delete b.dataset.confirm;
          b.className = 'icon-btn sm up-act danger';
          b.innerHTML = icon('trash-2', { size: 'sm' });
        }, 4000);
      });
      const tools = document.createElement('div'); tools.className = 'up-tools';
      tools.append(
        iconBtn('copy', 'Copy invite link', '', () => copy(`${location.origin}/s/${st.studio}`, 'Invite link copied.')),
        iconBtn('clock', 'Download calendar (.ics)', '', () => downloadIcs(st)),
        cancelBtn,
      );
      row.append(btn('Start', 'primary', () => startScheduled(st)), tools);
      li.append(top, meta, row);
      return li;
    }));
    requestAnimationFrame(syncUpCarousel);
  }
  $('#upPrev')?.addEventListener('click', () => {
    const ul = $('#upList');
    if (ul) ul.scrollBy({ left: -Math.max(200, Math.round(ul.clientWidth * 0.72)), behavior: 'smooth' });
  });
  $('#upNext')?.addEventListener('click', () => {
    const ul = $('#upList');
    if (ul) ul.scrollBy({ left: Math.max(200, Math.round(ul.clientWidth * 0.72)), behavior: 'smooth' });
  });
  $('#upList')?.addEventListener('scroll', syncUpCarousel, { passive: true });
  addEventListener('resize', syncUpCarousel);
  async function cancelStream(st) {
    try { await acctApi('streamCancel', { id: st.id, notify: true }); toast('Stream cancelled. Invitees were told and reminders stopped.'); S.streamsLoaded = false; loadStreams(); }
    catch (err) { toast(err.message, { err: true }); }
  }
  function startScheduled(st) {
    if (S.studio) return toast('Leave this studio first, then start the stream.', { err: true });
    S.pendingStream = { code: st.studio, id: st.id, title: st.title };
    S.state.title = st.title;
    openEnter('create');
  }
  function downloadIcs(st) {
    const d = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const e = (t) => String(t || '').replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    const link = `${location.origin}/s/${st.studio}`;
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//gather//studio//EN', 'BEGIN:VEVENT', `UID:${st.id}@gather`, `DTSTAMP:${d(Date.now())}`, `DTSTART:${d(st.when)}`, `DTEND:${d(st.when + (st.duration || 60) * 60000)}`,
      `SUMMARY:${e(st.title)}`, `DESCRIPTION:${e((st.description ? st.description + '\n\n' : '') + 'Studio: ' + link)}`, `URL:${link}`, 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Starting soon', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    a.download = (st.title || 'gather-stream').replace(/[^\w -]+/g, '').slice(0, 40) + '.ics';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#upSigninBtn').onclick = () => openAccount('up');

  // ---------------------------------------------------------------- unified Go Live Now & Schedule Launchpad
  const wiz = { mode: 'now', streamType: store.get('streamType', 'live'), photo: null, aiBg: null, upload: null, style: 'bold', logoData: null, overlayData: null };
  const tc = $('#wThumb'), tg = tc.getContext('2d');
  const wErr = (m) => { if (!$('#wErr')) return; $('#wErr').textContent = m; $('#wErr').hidden = !m; };
  const wWhen = () => { const v = $('#wDate')?.value && $('#wTime')?.value ? new Date(`${$('#wDate').value}T${$('#wTime').value}`) : null; return v ? v.getTime() : 0; };
  const parseHashtags = (raw) => [...new Set(String(raw || '').split(/[\s,;]+/).map((t) => t.trim().replace(/^#+/, '')).filter(Boolean).map((t) => '#' + t.replace(/[^a-z0-9_]/gi, '')).filter((t) => t.length > 1))].slice(0, 6);

  function syncWizAiBar() {
    const src = aiImageSource();
    if ($('#wAiStatus')) { $('#wAiStatus').textContent = src ? src.label : 'Add an AI key'; $('#wAiStatus').classList.toggle('warn', !src); }
  }

  function renderKitVisualPreviews() {
    const imgs = savedBrandImgs();
    const logoSrc = wiz.logoData ?? imgs.logo ?? '';
    const ovSrc = wiz.overlayData ?? imgs.overlay ?? '';
    if ($('#wLogoPreview')) {
      if (logoSrc) { $('#wLogoPreview').src = logoSrc; }
      else { $('#wLogoPreview').src = svgDataUrl(buildLogoSvg(S.state.brand.color, $('#wTitle')?.value || S.name || 'G')); }
    }
    if ($('#wLogoClear')) $('#wLogoClear').hidden = !logoSrc;
    if ($('#wOverlayPreview')) {
      if (ovSrc) { $('#wOverlayPreview').src = ovSrc; }
      else { $('#wOverlayPreview').src = svgDataUrl(buildOverlaySvg(S.state.brand.color, wiz.streamType, $('#wTitle')?.value || 'LIVE STUDIO')); }
    }
    if ($('#wOverlayClear')) $('#wOverlayClear').hidden = !ovSrc;
  }

  function svgDataUrl(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function rasterizeSvg(svg, w, h) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/png'));
      };
      img.onerror = rej;
      img.src = svgDataUrl(svg);
    });
  }
  function buildLogoSvg(accent, title) {
    const col = normalizeHex(accent) || '#3b82f6';
    const ini = initials(title || 'gather');
    const txt = hexLuminance(col) > 0.42 ? '#070c1a' : '#ffffff';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="#070c1a"/><rect x="10" y="10" width="236" height="236" rx="48" fill="url(#lg)" opacity="0.22"/><rect x="10" y="10" width="236" height="236" rx="48" fill="none" stroke="${col}" stroke-width="6"/><circle cx="128" cy="128" r="70" fill="${col}"/><text x="128" y="147" text-anchor="middle" font-family="Plus Jakarta Sans,Inter,sans-serif" font-weight="800" font-size="64" fill="${txt}">${ini.replace(/[<>&]/g, '')}</text></svg>`;
  }
  function buildOverlaySvg() {
    // Borderless transparent canvas — no outer blue box, no corner borders, no ON AIR pill inside video.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"></svg>`;
  }

  function updateWizReadySummary() {
    const el = $('#wReadySummary');
    if (!el) return;
    const qual = $('#wOptQuality')?.value || S.prefs.quality || '720';
    const priv = { public: 'Public', unlisted: 'Unlisted', invite: 'Invite-only' }[$('#wOptPrivacy')?.value || 'public'] || 'Public';
    const destCount = app.liveDests().filter((d) => d.on).length;
    const bits = [`${qual}p`, priv];
    if ($('#wOptCountdown')?.checked) bits.push('3m countdown');
    if ($('#wOptAutoRec')?.checked) bits.push('Auto-record');
    bits.push(destCount ? `Watch page + ${destCount} destination${destCount === 1 ? '' : 's'}` : 'Watch page ready');
    el.textContent = bits.join(' · ');
  }
  function openWizard(mode = 'now') {
    if (S.studio && !isHost()) return;
    wiz.mode = mode === 'later' ? 'later' : 'now';
    wiz.streamType = S.state.streamType || store.get('streamType', 'live');
    $('#wTitle').value = $('#wTitle').value || S.state.title || store.get('title', '') || '';
    if ($('#wTags') && !$('#wTags').value) {
      const tags = S.state.hashtags?.length ? S.state.hashtags : store.get('hashtags', []);
      $('#wTags').value = tags.join(', ');
    }
    const d = new Date(Date.now() + 864e5); d.setMinutes(0, 0, 0);
    if (!$('#wDate').value) { $('#wDate').value = d.toISOString().slice(0, 10); $('#wTime').value = d.toTimeString().slice(0, 5); }
    const np = store.get('notifyPrefs', { email: true, r24h: true, r15m: true });
    if ($('#wNotifyEmail')) $('#wNotifyEmail').checked = np.email !== false;
    if ($('#wNotify24h')) $('#wNotify24h').checked = np.r24h !== false;
    if ($('#wNotify15m')) $('#wNotify15m').checked = np.r15m !== false;
    const sp = store.get('streamPrefs', {});
    if ($('#wOptAutoRec')) $('#wOptAutoRec').checked = !!sp.autoRec;
    if ($('#wOptCountdown')) $('#wOptCountdown').checked = !!sp.countdown;
    if ($('#wOptPrivacy')) $('#wOptPrivacy').value = sp.privacy || 'public';
    if ($('#wOptQuality')) $('#wOptQuality').value = String(S.prefs.quality || store.get('quality', '720'));
    $('#wDone').hidden = true; $('#wSteps').hidden = false;
    wErr('');
    syncWizAiBar();
    renderSocialMatrix($('#wizSocialMatrix'));
    renderKitVisualPreviews();
    renderWizard();
    drawThumb();
    $('#wizDlg').showModal();
  }
  $('#wizOpen').onclick = () => openWizard('later');
  $('#wCancelBtn')?.addEventListener('click', () => $('#wizDlg').close());
  ['#wOptAutoRec', '#wOptCountdown', '#wOptPrivacy', '#wOptQuality'].forEach((sel) => {
    $(sel)?.addEventListener('change', updateWizReadySummary);
  });
  $('#wizSocialMatrix')?.addEventListener('change', updateWizReadySummary);
  $$('#wModeSeg [data-wmode]').forEach((b) => b.addEventListener('click', () => {
    wiz.mode = b.dataset.wmode === 'later' ? 'later' : 'now';
    wErr('');
    renderWizard();
    if (wiz.mode === 'later') $('#wDate')?.focus();
  }));
  $$('#wTypes [data-wtype]').forEach((b) => b.addEventListener('click', () => {
    wiz.streamType = b.dataset.wtype;
    renderWizard();
    renderKitVisualPreviews();
    drawThumb();
  }));

  function renderWizard() {
    const later = wiz.mode === 'later';
    $$('#wModeSeg [data-wmode]').forEach((b) => {
      const on = b.dataset.wmode === wiz.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('#wTypes [data-wtype]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.wtype === wiz.streamType)));
    $$('.w-later').forEach((el) => (el.hidden = !later));
    if (later && $('#wMoreFold')) $('#wMoreFold').open = true; // scheduling: the guest list matters
    if ($('#wGo')) $('#wGo').textContent = later ? 'Schedule Stream' : 'Go Live Now';
    if ($('#wMailNote')) {
      $('#wMailNote').textContent = !acct.user
        ? 'Sign in to schedule streams and send automatic reminders.'
        : S.mailReady === false
        ? 'Email isn’t configured on this server yet, so copy the invite link after scheduling.'
        : 'Invitees receive calendar invites and automatic reminders based on your settings above.';
    }
    $$('#wStyle button').forEach((b) => b.classList.toggle('on', b.dataset.ws === wiz.style));
    updateWizReadySummary();
  }

  return { setStreamPref, syncAspect, autoGridOn, renderStreamPanel, fmtLocal, renderUpcoming, downloadIcs, wiz, tc, tg, wErr, wWhen, parseHashtags, syncWizAiBar, renderKitVisualPreviews, svgDataUrl, rasterizeSvg, buildLogoSvg, buildOverlaySvg, openWizard, renderWizard };
}
