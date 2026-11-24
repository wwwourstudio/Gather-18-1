import { icon, busy, togglePopover, cssEsc, replaceKids } from './ui.js';

// The audience side of the studio: the public watch page settings, bounties, card payments (Stripe Connect),
// the live shop, polls and predictions, the play-with-me queue, custom emotes, voice questions and where
// viewers find the watch page.
// Created by app.js through createAudience(app): `app` carries the studio state and helpers this part uses.
export function createAudience(app) {
  const {
    $, smooth, $$, store, S, isHost, watchCfg, normalizeHex, hexLuminance, notifier, toast, fmtTime, copy,
    audioCtx, mixInMedia, api, creds, wsSend, setStage, canvas, g, speaking, rr, stageElements, chatShell,
    uid, withDefaults, assetImg, setAssetData, storeAsset, compressImage, wrapLines, px, superAlert,
    playScVoice, elementsCopy, freeSpot, acct, acctApi, setUser, openAccount, parseHashtags,
    rasterizeSvg, appendLog, setTab, flashBtn, renderInviteDialog, chime
  } = app;
  // ---------------------------------------------------------------- the public watch page (/w/<studio>)
  // Viewers watch the program straight from this browser over WebRTC (no platform in between), chat, react, send
  // super chats paid directly to the host, and ask to join the stage. A laptop can encode and upload the program
  // for a handful of viewers, so the host sets a cap; past it, viewers fall back to the platform players.
  // Signed-in hosts with a watch-page name share gather…/w/<name>, which follows them from show to show.
  const myHandle = () => (isHost() && acct.user?.handle) || '';
  // Your claimed name, else this studio's short link (/w/k7m2x); the long studio code is only a fallback.
  const watchSlug = () => myHandle() || S.short || S.studio;
  const watchLinkUrl = () => `${location.origin}/w/${watchSlug()}`;
  const watchLinkText = () => watchLinkUrl().replace(/^https?:\/\/(www\.)?/, '');
  const VIEW = new Map(); // viewer id -> { pc }
  S.viewers = VIEW; // for the console and tests
  let programStream = null;
  let hwH264Cache = null;
  /** Does this machine encode H.264 in hardware? The browser reports that as "power efficient". */
  function hwH264() {
    hwH264Cache ||= (navigator.mediaCapabilities?.encodingInfo?.({ type: 'webrtc', video: { contentType: 'video/H264; profile-level-id=42e01f', width: 1280, height: 720, bitrate: 2_500_000, framerate: 30 } })
      .then((r) => !!(r.supported && r.powerEfficient)).catch(() => false)) || Promise.resolve(false);
    return hwH264Cache;
  }
  function programTracks() {
    audioCtx();
    const fps = S.local.pres?.game ? 60 : 30;
    if (!programStream || programStream.fps !== fps || programStream.getVideoTracks()[0]?.readyState !== 'live') { programStream = canvas.captureStream(fps); programStream.fps = fps; }
    // The program is text, slides and faces: tell the encoder sharpness matters more than smoothness (games: motion).
    const vt = programStream.getVideoTracks()[0]; if (vt) vt.contentHint = S.local.pres?.game ? 'motion' : 'detail';
    return [programStream.getVideoTracks()[0], app.recDest?.stream.getAudioTracks()[0]].filter(Boolean);
  }
  async function viewerWant(vid) {
    if (!isHost() || !S.studio) return;
    closeViewer(vid);
    const cfg = watchCfg();
    if (!cfg.direct || VIEW.size >= cfg.cap) return wsSend({ type: 'vsignal', to: vid, data: { bye: true } });
    const pc = new RTCPeerConnection({ iceServers: S.iceServers, bundlePolicy: 'max-bundle' });
    VIEW.set(vid, { pc });
    const ms = new MediaStream(programTracks());
    for (const t of ms.getTracks()) {
      const sender = pc.addTrack(t, ms);
      if (t.kind === 'video') {
        // H.264 first only where this machine encodes it in hardware (cheap per viewer, sharp); otherwise VP8,
        // which Chrome's software encoder handles much better than software H.264.
        try {
          if (await hwH264()) {
            const tr = pc.getTransceivers().find((x) => x.sender === sender), caps = RTCRtpSender.getCapabilities?.('video')?.codecs || [];
            const h264 = caps.filter((c) => /h264/i.test(c.mimeType)), rest = caps.filter((c) => !/h264/i.test(c.mimeType));
            if (h264.length) tr?.setCodecPreferences([...h264, ...rest]);
          }
        } catch {}
        tuneViewerSender(sender);
      }
    }
    pc.onicecandidate = (e) => { if (e.candidate) wsSend({ type: 'vsignal', to: vid, data: { candidate: e.candidate } }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) closeViewer(vid); renderWatchSec(); };
    try { await pc.setLocalDescription(); wsSend({ type: 'vsignal', to: vid, data: { sdp: pc.localDescription } }); }
    catch (e) { console.warn('viewer offer failed', e); closeViewer(vid); }
    renderWatchSec();
  }
  // WebRTC starts every connection at a few hundred kbps and ramps up over ~10 s, so viewers first saw a 320x180
  // picture. Start video at 2 Mbps (never below 800 kbps) so the first frames are already sharp. Chrome reads these
  // hints from the codec parameters of the answer; other browsers ignore them.
  function fastStart(sdp) {
    return String(sdp || '').replace(/^(a=fmtp:\d+ [^\r\n]*)/gm, (line) => (/x-google-start-bitrate/.test(line) || /apt=|opus|telephone/i.test(line) ? line : line + ';x-google-start-bitrate=2000;x-google-min-bitrate=800'))
      .replace(/^(a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000)\r?$/gm, (m, line, pt) => (new RegExp(`^a=fmtp:${pt} `, 'm').test(sdp) ? line : `${line}\r\na=fmtp:${pt} x-google-start-bitrate=2000;x-google-min-bitrate=800`));
  }
  async function viewerSignal(vid, d) {
    const v = VIEW.get(vid);
    if (!v || !d) return;
    // A viewer picked a quality on their player: scale only their stream.
    if (d.quality) { v.q = d.quality; for (const s of v.pc.getSenders()) if (s.track?.kind === 'video') tuneViewerSender(s, v.q); return; }
    try { if (d.sdp) await v.pc.setRemoteDescription(d.sdp.type === 'answer' ? { type: 'answer', sdp: fastStart(d.sdp.sdp) } : d.sdp); else if (d.candidate) await v.pc.addIceCandidate(d.candidate).catch(() => {}); }
    catch (e) { console.warn('viewer signal', e); }
  }
  /** Viewer encoding: 2.5 Mbps at 30 fps; in game mode 60 fps (4 Mbps), keeping motion smooth over sharpness. */
  function tuneViewerSender(sender, q) {
    const game = !!S.local.pres?.game;
    try {
      const p = sender.getParameters();
      const scale = { 720: 1, 480: 1.5, 360: 2 }[q] || 1;
      p.encodings = [{ ...(p.encodings?.[0] || {}), maxBitrate: Math.round((game ? 4_000_000 : 2_500_000) / scale / scale), maxFramerate: game ? 60 : 30, scaleResolutionDownBy: scale }];
      p.degradationPreference = game ? 'maintain-framerate' : 'maintain-resolution'; // short of bandwidth: drop frames, never blur
      sender.setParameters(p).catch(() => {});
    } catch {}
  }
  // Game mode on or off: hand every direct viewer the program at the new frame rate.
  setInterval(() => {
    if (!VIEW.size || !programStream) return;
    const want = S.local.pres?.game ? 60 : 30;
    if (programStream.fps === want) return;
    const [video] = programTracks();
    for (const v of VIEW.values()) for (const s of v.pc.getSenders()) if (s.track?.kind === 'video') { s.replaceTrack(video).catch(() => {}); tuneViewerSender(s, v.q); }
  }, 1000);
  function closeViewer(vid) { const v = VIEW.get(vid); if (!v) return; VIEW.delete(vid); try { v.pc.close(); } catch {} renderWatchSec(); }
  function closeAllViewers() { for (const vid of [...VIEW.keys()]) closeViewer(vid); }

  // Super chats: paid by card on the watch page; they arrive here already confirmed by Stripe.
  S.supers = new Map();
  const money = (a) => '$' + (Number.isInteger(a) ? a : Number(a).toFixed(2));
  function gotSuperchat(item, fresh) {
    if (!item?.id || item.status === 'paying') return;
    const was = S.supers.get(item.id)?.status;
    S.supers.set(item.id, item);
    if (fresh && item.auto && item.status === 'confirmed' && was !== 'confirmed') { // paid by card on the watch page: on screen right away
      toast(`💳 ${money(item.amount)} super chat from ${item.name}, paid by card.`, { ms: 8000 });
      if (item.bounty) acceptBounty(item);
      else setStage({ featured: { id: 'w-' + item.id, src: 'watch', name: item.name, text: item.text || (item.voice ? 'Voice super chat' : 'Sent a super chat'), paid: money(item.amount) } });
      superAlert(item);
      window.__gatherAuto?.onSuper(item);
    }
    renderSupers();
  }
  function superAct(item, act) {
    notifier.dismiss('sc-' + item.id);
    wsSend({ type: 'superchat', id: item.id, do: act });
    item.status = { dismiss: 'dismissed', answered: 'answered' }[act];
    if ((act === 'answered' || act === 'dismiss') && S.state.featured?.id === 'w-' + item.id) setStage({ featured: null });
    renderSupers();
  }
  // ---------------------------------------------------------------- bounties: viewer-funded challenges on the stream
  function acceptBounty(item) {
    const list = (S.state.bounties || []).filter((b) => b.id !== item.id);
    list.push({ id: item.id, name: item.name, text: item.text, amount: money(item.amount), status: 'active', ts: Date.now(), endedAt: 0 });
    const patch = { bounties: list };
    if (!(S.state.elements || []).some((e) => e.type === 'bounty')) {
      const e = withDefaults({ type: 'bounty' }), els = stageElements(), spot = freeSpot(e, els);
      if (spot) Object.assign(e, spot); else e.stack = true;
      e.home = [e.x, e.y, e.w, e.h]; patch.elements = [...els, e];
    }
    setStage(patch);
    toast(`🎯 Bounty accepted: “${item.text}”. It’s on stream until you mark it done.`, { ms: 6000 });
  }
  function endBounty(id, status) {
    setStage({ bounties: (S.state.bounties || []).map((b) => (b.id === id ? { ...b, status, endedAt: Date.now() } : b)) });
    if (status === 'done') toast('Bounty completed. It flashes on stream, then clears.');
  }
  function renderBountyPanel() {
    const box = $('#bountyList'); if (!box) return;
    const list = (S.state.bounties || []).filter((b) => b.status === 'active');
    $('#bountyEmpty').hidden = !!list.length;
    replaceKids(box, ...list.map((b) => {
      const li = document.createElement('li'); li.className = 'bounty-item';
      const t = document.createElement('div');
      t.append(Object.assign(document.createElement('b'), { textContent: b.text }), Object.assign(document.createElement('small'), { textContent: `${b.amount} from ${b.name}` }));
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn sm primary'; ok.textContent = '✓ Done'; ok.onclick = () => endBounty(b.id, 'done');
      const no = document.createElement('button'); no.type = 'button'; no.className = 'btn sm ghost'; no.textContent = '✗ Failed'; no.onclick = () => endBounty(b.id, 'failed');
      li.append(t, ok, no);
      return li;
    }));
  }
  /** The bounty board on stage: the active challenges, and a completed one flashing for a few seconds. */
  function drawBountyEl(e) {
    const now = Date.now();
    const list = (S.state.bounties || []).filter((b) => b.status === 'active' || (b.status === 'done' && now - b.endedAt < 8000)).slice(-3);
    if (!list.length) return;
    // The board is as tall as its rows (one to three), never a half-empty box.
    const r0 = px(e), rowH = Math.min(r0.w * .1, r0.h / 4.2), pad = rowH * .35, headH = rowH * .8;
    const r = { x: r0.x, y: r0.y, w: r0.w, h: Math.min(r0.h, pad * 2 + headH + list.length * rowH) };
    g.save();
    rr(r.x, r.y, r.w, r.h, 14); g.fillStyle = 'rgba(8,12,26,.86)'; g.fill();
    const glow = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y); glow.addColorStop(0, 'rgba(251,191,36,.18)'); glow.addColorStop(1, 'rgba(251,191,36,0)');
    rr(r.x, r.y, r.w, r.h, 14); g.fillStyle = glow; g.fill();
    rr(r.x + .5, r.y + .5, r.w - 1, r.h - 1, 14); g.strokeStyle = 'rgba(251,191,36,.5)'; g.lineWidth = 1.5; g.stroke();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = `800 ${headH * .5}px Inter, sans-serif`; g.fillStyle = '#fbbf24'; g.fillText('🎯 BOUNTIES', r.x + pad * 1.2, r.y + pad + headH / 2);
    list.forEach((b, i) => {
      const y = r.y + pad + headH + i * rowH + rowH / 2;
      const done = b.status === 'done';
      if (done) { const a = Math.max(0, 1 - (now - b.endedAt) / 8000); g.fillStyle = `rgba(34,197,94,${.25 * a + .1})`; rr(r.x + pad * .6, y - rowH * .44, r.w - pad * 1.2, rowH * .88, 8); g.fill(); }
      g.font = `900 ${rowH * .42}px Inter, sans-serif`; g.fillStyle = done ? '#4ade80' : '#fde68a';
      const amt = done ? '✓ DONE' : b.amount; g.fillText(amt, r.x + pad * 1.2, y);
      const aw = g.measureText(amt).width + pad * .9;
      g.font = `700 ${rowH * .38}px Inter, sans-serif`; g.fillStyle = '#ffffff';
      let t = b.text; const maxW = r.w - pad * 2.4 - aw;
      while (t.length > 1 && g.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
      g.fillText(t, r.x + pad * 1.2 + aw, y);
    });
    g.restore();
  }
  function renderSupers() {
    const box = $('#scList'); if (!box) return;
    const items = [...S.supers.values()].filter((x) => x.status !== 'dismissed').sort((a, b) => b.ts - a.ts);
    $('#scEmpty').hidden = !!items.length;
    const total = [...S.supers.values()].filter((x) => x.status === 'confirmed' || x.status === 'answered').reduce((s, x) => s + x.amount, 0);
    $('#scTotal').textContent = total ? `${money(total)} confirmed` : '';
    replaceKids(box, ...items.map((x) => {
      const li = document.createElement('li'); li.className = 'sc-item ' + x.status;
      const top = document.createElement('div'); top.className = 'sc-top';
      const amt = document.createElement('span'); amt.className = 'paid-amt'; amt.textContent = money(x.amount);
      const who = document.createElement('b'); who.textContent = x.name;
      const via = document.createElement('small'); via.textContent = x.status === 'answered' ? 'paid by card · answered' : 'paid by card';
      top.append(amt, who, via);
      const txt = document.createElement('p'); txt.textContent = x.text || '(no message)';
      const row = document.createElement('div'); row.className = 'row';
      const btn = (t, cls, act) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = t; b.onclick = () => superAct(x, act); return b; };
      if (x.status === 'confirmed') row.append(btn('Answered', '', 'answered'));
      const vb = (t, cls, onAir) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = t; b.onclick = () => playScVoice(x, onAir); return b; };
      if (x.voice) row.append(vb(`▶ Voice ${x.voice}s`, 'ghost', false), vb('Play on air', '', true));
      { const r = document.createElement('button'); r.type = 'button'; r.className = 'btn sm ghost'; r.textContent = 'Replay alert'; r.onclick = () => superAlert(x); row.append(r); }
      li.append(top, txt, row);
      return li;
    }));
  }
  async function refreshSupers() { if (!S.studio || !isHost()) return; try { for (const x of (await api('scList', creds())).items) gotSuperchat(x, false); } catch {} }

  // Reactions from the watch page float over the host's stage view (never into the program).
  function reactFloat(e) {
    if (watchCfg().reactsOnStream !== false) { (S.waves ||= []).push({ e, t0: performance.now(), x: 0.78 + Math.random() * 0.16, dx: (Math.random() - 0.5) * 0.08, s: 0.9 + Math.random() * 0.5 }); if (S.waves.length > 60) S.waves.shift(); return; }
    const s = document.createElement('span'); s.className = 'react-float'; s.textContent = e; s.style.left = 10 + Math.random() * 80 + '%';
    $('#stage')?.append(s); setTimeout(() => s.remove(), 2600);
  }

  // The Show panel's watch page section.
  function setWatch(patch) {
    const cfg = { ...watchCfg(), ...patch, pay: { ...watchCfg().pay, ...(patch.pay || {}) } };
    store.set('watchPrefs', cfg); // keep the handles for the next show
    if (isHost() && S.studio) setStage({ watch: cfg });
    renderWatchSec();
  }
  function renderWatchSec() {
    if (!window.__watchReady || !$('#watchSec')) return; // renderAll can run before this part of the module loads
    const cfg = watchCfg(), on = !!S.studio;
    $('#wpUrl').textContent = on ? watchLinkText() : 'Enter your studio to get its watch link';
    for (const id of ['#wpCopy', '#wpCard', '#wpOpen']) $(id).disabled = !on;
    $('#wpCount').textContent = on && cfg.direct ? `${VIEW.size} of ${cfg.cap} watching directly` : '';
    for (const [id, k] of [['#wpChat', 'chat'], ['#wpSupers', 'supers'], ['#wpDirect', 'direct'], ['#wpVoice', 'voice'], ['#wpBadge', 'badge']]) if ($(id) && document.activeElement !== $(id)) $(id).checked = cfg[k] !== false && !!(cfg[k] ?? true);
    if (document.activeElement !== $('#wpCap')) $('#wpCap').value = String(cfg.cap);
    if (document.activeElement !== $('#wpAbout')) $('#wpAbout').value = cfg.about || '';
    if ($('#wpLobby') && document.activeElement !== $('#wpLobby')) $('#wpLobby').value = cfg.lobby || '';
    if ($('#wpRig') && document.activeElement !== $('#wpRig')) $('#wpRig').value = cfg.rig || '';
    if (document.activeElement !== $('#wpPin')) $('#wpPin').value = cfg.pin || '';
    if (document.activeElement !== $('#wpGoalLabel')) $('#wpGoalLabel').value = cfg.goal?.label || '';
    if (document.activeElement !== $('#wpGoalTarget')) $('#wpGoalTarget').value = cfg.goal?.target || '';
    $('#wpReacts').checked = cfg.reactsOnStream !== false;
    if (document.activeElement !== $('#wpLinks')) $('#wpLinks').value = (cfg.links || []).map((l) => `${l.label} | ${l.url}`).join('\n');
    if (document.activeElement !== $('#wpMin')) $('#wpMin').value = String(cfg.min);
    // Super chats are paid by card on the watch page, so they need Stripe connected; one line says what's left.
    if (S.studio && isHost() && !CARD.checked) cardStatus();
    renderPaySteps();
    $('#wpSupersState').textContent = cfg.supers && CARD.ready ? 'On' : cfg.supers ? 'Connect Stripe' : 'Off';
    $('#wpPayStatus').textContent = !CARD.ready ? (cfg.supers ? 'Super chats are on, but viewers won’t see the tip button until Stripe is connected.' : 'Connect Stripe, then turn on super chats.')
      : cfg.supers ? 'Viewers see a tip button in the chat on your watch page.' : 'Stripe is connected. Turn on super chats to show the tip button.';
    if (document.activeElement !== $('#wpQueue')) $('#wpQueue').checked = !!cfg.queue;
    if (window.__shopReady) { renderShop(); renderPoll(); renderEmotes(); }
    renderShowcaseSec();
    renderHandle();
  }
  // ---- on-site card payments (Stripe Connect): the host connects their own Stripe account once
  const CARD = { checked: false, available: false, connected: false, ready: false };
  async function cardStatus() {
    CARD.checked = true;
    try { Object.assign(CARD, await api('payCard', { ...creds(), op: 'status' })); } catch {}
    renderCard();
  }
  /** Get paid, step by step: what's done and the one thing to do next. */
  function renderPaySteps() {
    const ol = $('#wpPaySteps'); if (!ol) return;
    const cfg = watchCfg();
    const steps = [
      [CARD.available, 'Card payments on this site', CARD.available ? 'Ready' : 'The site owner adds STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in the hosting settings, then redeploys.'],
      [CARD.ready, 'Your Stripe account', CARD.ready ? 'Connected: money goes straight to you' : CARD.connected ? 'Almost there: finish your Stripe details' : 'Connect Stripe below (a few minutes, one time)'],
      [!!cfg.supers, 'Super chats on', cfg.supers ? 'Viewers see the green $ in your chat' : 'Turn on “Take super chats” below'],
    ];
    const next = steps.findIndex(([done]) => !done);
    replaceKids(ol, ...steps.map(([done, title, sub], i) => {
      const li = document.createElement('li'); li.className = 'pay-step' + (done ? ' done' : i === next ? ' next' : '');
      li.innerHTML = '<i aria-hidden="true"></i><span><b></b><small></small></span>';
      li.querySelector('i').textContent = done ? '✓' : String(i + 1);
      li.querySelector('b').textContent = title; li.querySelector('small').textContent = sub;
      return li;
    }));
  }
  function renderCard() {
    renderPaySteps();
    const box = $('#wpPayCard'); if (!box) return;
    const go = $('#wpCardGo'), st = $('#wpCardState');
    box.classList.toggle('on', CARD.ready);
    if (!CARD.available) { go.disabled = true; go.textContent = 'Not set up'; st.textContent = 'Not available on this site yet (see step 1).'; return; }
    go.disabled = false;
    if (CARD.ready) { go.textContent = 'Disconnect'; go.className = 'btn sm ghost'; st.textContent = 'On: viewers can pay by card, Apple Pay or Google Pay in your chat. Super chats go on stream as soon as they’re paid.'; }
    else if (CARD.connected) { go.textContent = 'Finish Stripe setup'; go.className = 'btn sm primary'; st.textContent = 'Almost there: finish your Stripe details, then come back to this tab.'; }
    else { go.textContent = 'Connect Stripe'; go.className = 'btn sm primary'; }
  }
  $('#wpCardGo')?.addEventListener('click', async () => {
    if (CARD.ready) { if (!confirm('Stop taking cards on your watch page?')) return; await api('payCard', { ...creds(), op: 'disconnect' }).catch(() => {}); Object.assign(CARD, { connected: false, ready: false }); return renderCard(); }
    const tab = window.open('', '_blank');
    try { const { url } = await api('payCard', { ...creds(), op: 'connect', origin: location.origin }); if (tab) tab.location = url; else location.assign(url); CARD.connected = true; renderCard(); }
    catch (e) { tab?.close(); toast(e.message, { err: true }); }
  });
  window.addEventListener('focus', () => { if (CARD.connected && !CARD.ready && isHost()) cardStatus(); });

  let pendingNoticeImg = '';
  function renderShowcaseSec() {
    if (!$('#wpStreamType')) return;
    const host = isHost();
    if (document.activeElement !== $('#wpStreamType')) $('#wpStreamType').value = S.state.streamType || 'live';
    if (document.activeElement !== $('#wpHashtags')) $('#wpHashtags').value = (S.state.hashtags || []).join(', ');
    const list = S.state.notices || [];
    if ($('#wpNoticeCount')) $('#wpNoticeCount').textContent = list.length ? `${list.length} active` : '';
    if ($('#wpNoticeList')) {
      replaceKids($('#wpNoticeList'), ...list.map((n, i) => {
        const li = document.createElement('li'); li.className = 'showcase-item';
        const top = document.createElement('div'); top.className = 'showcase-item-top';
        const k = document.createElement('span'); k.className = 'pill caps'; k.textContent = n.kind || 'notice';
        const b = document.createElement('b'); b.textContent = n.head || 'Notice';
        const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn sm'; del.disabled = !host;
        del.innerHTML = icon('trash-2', { size: 'sm' }); del.setAttribute('aria-label', 'Remove notice');
        del.onclick = () => { const next = [...list]; next.splice(i, 1); store.set('notices', next); setStage({ notices: next }); };
        top.append(k, b, del); li.append(top);
        if (n.imgAsset) {
          const im = assetImg(n.imgAsset);
          if (im) { const x = document.createElement('img'); x.className = 'showcase-thumb'; x.src = im.src; x.alt = ''; li.append(x); }
        }
        if (n.body) { const p = document.createElement('p'); p.className = 'hint'; p.style.margin = '0'; p.textContent = n.body; li.append(p); }
        return li;
      }));
    }
    const wn = S.state.whatNext || {};
    if (document.activeElement !== $('#wpNextTitle')) $('#wpNextTitle').value = wn.title || '';
    if (document.activeElement !== $('#wpNextWhen')) $('#wpNextWhen').value = wn.when ? new Date(wn.when - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    if (document.activeElement !== $('#wpNextDesc')) $('#wpNextDesc').value = wn.desc || '';
    const sp = S.state.aiSpotlight || {};
    if (document.activeElement !== $('#wpSpotHead')) $('#wpSpotHead').value = sp.head || '';
    if (document.activeElement !== $('#wpSpotBullets')) $('#wpSpotBullets').value = (sp.bullets || []).join('\n');
    if (document.activeElement !== $('#wpSpotLinks')) $('#wpSpotLinks').value = (sp.links || []).map((l) => `${l.label} | ${l.url}`).join('\n');
  }
  $('#wpStreamType')?.addEventListener('change', (e) => { if (!isHost()) return; store.set('streamType', e.target.value); setStage({ streamType: e.target.value }); });
  $('#wpHashtags')?.addEventListener('change', (e) => { if (!isHost()) return; const h = parseHashtags(e.target.value); store.set('hashtags', h); setStage({ hashtags: h }); });
  $('#wpNoticeImgBtn')?.addEventListener('click', () => $('#wpNoticeImgFile').click());
  $('#wpNoticeImgClear')?.addEventListener('click', () => {
    pendingNoticeImg = '';
    $('#wpNoticeImgStatus').textContent = '';
    $('#wpNoticeImgClear').hidden = true;
  });
  $('#wpNoticeImgFile')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = await compressImage(f);
      pendingNoticeImg = S.studio ? await storeAsset(data) : (setAssetData('local-notice-' + uid(), data), 'local-notice-' + uid());
      if (!S.studio) setAssetData(pendingNoticeImg, data);
      $('#wpNoticeImgStatus').textContent = 'Image ready';
      $('#wpNoticeImgClear').hidden = false;
    } catch (err) { toast(err.message, { err: true }); }
  });
  $('#wpNoticeAdd')?.addEventListener('click', () => {
    if (!isHost()) return;
    const head = $('#wpNoticeHead').value.trim();
    const body = $('#wpNoticeBody').value.trim();
    let ctaUrl = $('#wpNoticeUrl').value.trim();
    if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) ctaUrl = 'https://' + ctaUrl;
    if (!head && !body) return toast('Add a headline or notice text first.', { err: true });
    const item = {
      id: uid().slice(0, 8),
      kind: $('#wpNoticeKind').value || 'notice',
      head: head || 'Announcement',
      body,
      ctaLabel: $('#wpNoticeCta').value.trim().slice(0, 30),
      ctaUrl: /^https:\/\//i.test(ctaUrl) ? ctaUrl : '',
      imgAsset: pendingNoticeImg || '',
      ts: Date.now(),
    };
    const next = [item, ...(S.state.notices || [])].slice(0, 8);
    for (const id of ['#wpNoticeHead', '#wpNoticeBody', '#wpNoticeCta', '#wpNoticeUrl']) $(id).value = '';
    pendingNoticeImg = '';
    $('#wpNoticeImgStatus').textContent = '';
    $('#wpNoticeImgClear').hidden = true;
    store.set('notices', next);
    setStage({ notices: next });
    toast('Notice published to Watch Party.');
  });
  $('#wpNextSave')?.addEventListener('click', () => {
    if (!isHost()) return;
    const title = $('#wpNextTitle').value.trim();
    const when = $('#wpNextWhen').value ? new Date($('#wpNextWhen').value).getTime() : 0;
    const whatNext = title ? { title, when: Number.isFinite(when) ? when : 0, desc: $('#wpNextDesc').value.trim() } : null;
    store.set('whatNext', whatNext);
    setStage({ whatNext });
    toast('What’s Next updated.');
  });
  $('#wpSpotSave')?.addEventListener('click', () => {
    if (!isHost()) return;
    const head = $('#wpSpotHead').value.trim();
    const bullets = $('#wpSpotBullets').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);
    const links = $('#wpSpotLinks').value.split('\n').map((line) => {
      const [a, b] = line.includes('|') ? line.split('|') : ['', line];
      let url = (b || '').trim();
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      return { label: a.trim() || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url };
    }).filter((l) => /^https:\/\//i.test(l.url)).slice(0, 4);
    const aiSpotlight = head || bullets.length || links.length ? { head, bullets, links, updatedAt: Date.now() } : null;
    store.set('aiSpotlight', aiSpotlight);
    setStage({ aiSpotlight });
    toast('AI Spotlight updated on Watch Party.');
  });
  function renderHandle() {
    const u = acct.user, h = u?.handle || '';
    $('#wpHost').textContent = '/w/'; // the full address is spelled out in the note under the field
    if (document.activeElement !== $('#wpHandle')) $('#wpHandle').value = h;
    $('#wpHandle').disabled = $('#wpHandleSave').disabled = !u;
    $('#wpHandleSave').textContent = h ? 'Change' : 'Claim';
    $('#wpHandleNote').textContent = !u ? 'Sign in to claim a name. It always points at your current show.'
      : h ? `Same link every show: ${location.host.replace(/^www\./, '')}/w/${h}`
      : 'Pick a name once and share one link forever.';
  }
  $('#wpHandleForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!acct.user) return openAccount('in');
    const h = $('#wpHandle').value.trim().toLowerCase();
    if (h === acct.user.handle) return;
    $('#wpHandleSave').disabled = true;
    try {
      const r = await acctApi('handle', { handle: h, studio: S.studio });
      setUser(r.user); toast(`Your watch page is now ${location.host}/w/${h}`);
      renderWatchSec();
    } catch (err) { $('#wpHandleNote').textContent = err.message; }
    finally { $('#wpHandleSave').disabled = false; }
  });
  $('#wpCopy').onclick = () => copy(watchLinkUrl(), 'Watch link copied. Share it anywhere.');
  $('#wpOpen').onclick = () => window.open(watchLinkUrl(), '_blank', 'noopener');
  $('#wpCard').onclick = () => {
    const els = elementsCopy().filter((e) => !(e.type === 'callin' && e.url === watchLinkUrl()));
    els.push(withDefaults({ type: 'callin', x: .66, y: .66, w: .31, h: .28, url: watchLinkUrl(), label: 'Watch, chat & join live', phone: '' }));
    setStage({ elements: els });
    toast('The watch link and its QR code are on stage.');
  };
  for (const [id, k] of [['#wpChat', 'chat'], ['#wpSupers', 'supers'], ['#wpDirect', 'direct'], ['#wpVoice', 'voice'], ['#wpBadge', 'badge']]) if ($(id)) $(id).onchange = (e) => setWatch({ [k]: e.target.checked });
  $('#wpCap').onchange = (e) => setWatch({ cap: Number(e.target.value) });
  $('#wpAbout').onchange = (e) => setWatch({ about: e.target.value.trim() });
  $('#wpLobby').onchange = (e) => setWatch({ lobby: e.target.value.trim() });
  $('#wpRig').onchange = (e) => setWatch({ rig: e.target.value.trim() });
  $('#wpPin').onchange = (e) => setWatch({ pin: e.target.value.trim() });
  const setGoal = () => setWatch({ goal: { label: $('#wpGoalLabel').value.trim().slice(0, 40), target: Math.max(0, Math.min(100000, Math.round(Number($('#wpGoalTarget').value) || 0))) } });
  $('#wpGoalLabel').onchange = setGoal; $('#wpGoalTarget').onchange = setGoal;
  $('#wpReacts').onchange = (e) => setWatch({ reactsOnStream: e.target.checked });
  $('#wpLinks').onchange = (e) => {
    const links = e.target.value.split('\n').map((line) => { const [a, b] = line.includes('|') ? line.split('|') : ['', line]; let url = (b || '').trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url; return { label: a.trim() || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url }; }).filter((l) => /^https:\/\//.test(l.url)).slice(0, 6);
    setWatch({ links });
  };
  $('#wpMin').onchange = (e) => setWatch({ min: Math.max(1, Number(e.target.value) || 2) });
  setInterval(() => { if ($('#watchSec') && !$('#watchSec').closest('[hidden]')) renderWatchSec(); }, 3000);
  window.__watchReady = true;
  renderWatchSec();

  // ---------------------------------------------------------------- shop: sell products live (checkout on the store's own site)
  const shopCfg = () => ({ items: [], pinned: '', sale: null, store: '', ...(S.state.shop || {}) });
  function setShop(patch) {
    const next = { ...shopCfg(), ...patch };
    store.set('shopItems', next.items); // the catalogue follows the host to their next show
    if (isHost() && S.studio) setStage({ shop: next }); else S.state.shop = next;
    renderShop();
  }
  const imgCache = new Map();
  /** An image for the program canvas, only if its host allows cross-origin use: anything else would taint the canvas and break recording. */
  function corsImg(url) {
    if (!url) return null;
    let e = imgCache.get(url);
    if (!e) { e = { img: new Image(), ok: false }; e.img.crossOrigin = 'anonymous'; e.img.onload = () => { e.ok = true; }; e.img.src = url; imgCache.set(url, e); }
    return e.ok ? e.img : null;
  }
  function renderShop() {
    if (!$('#shopList')) return;
    const sh = shopCfg();
    $('#shopCount').textContent = sh.items.length ? `${sh.items.length} product${sh.items.length === 1 ? '' : 's'}${sh.pinned ? ' · 1 pinned' : ''}` : '';
    replaceKids($('#shopList'), ...sh.items.map((p) => {
      const li = document.createElement('li'); li.className = 'shop-item' + (sh.pinned === p.id ? ' pinned' : '');
      const im = document.createElement(p.img ? 'img' : 'div'); if (p.img) { im.src = p.img; im.alt = ''; im.loading = 'lazy'; } else im.className = 'ph';
      const txt = document.createElement('div'); const t = document.createElement('b'); t.textContent = p.title; const sm = document.createElement('small');
      const onSale = sh.sale?.id === p.id && sh.sale.until > Date.now();
      sm.textContent = [p.price, p.src === 'shopify' ? 'Shopify' : p.src === 'etsy' ? 'Etsy' : 'Link', onSale ? `Flash sale ${sh.sale.pct ? sh.sale.pct + '% off' : ''} · ${sh.sale.code} · ${fmtTime(sh.sale.until - Date.now())} left` : ''].filter(Boolean).join(' · ');
      txt.append(t, sm);
      const acts = document.createElement('div'); acts.className = 'acts';
      const btn = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = label; b.onclick = fn; return b; };
      acts.append(
        btn(sh.pinned === p.id ? 'Unpin' : 'Pin', sh.pinned === p.id ? '' : 'primary', () => setShop({ pinned: sh.pinned === p.id ? '' : p.id })),
        btn(onSale ? 'End sale' : 'Flash sale', '', () => {
          if (onSale) return setShop({ sale: null });
          const code = prompt('Discount code buyers enter at checkout (create it in your store first):', 'LIVE20'); if (!code) return;
          const pct = Number(prompt('How much off, in percent? (shown on screen)', '20')) || 0;
          const mins = Number(prompt('How many minutes should it last?', '10')) || 10;
          setShop({ pinned: p.id, sale: { id: p.id, code: code.trim().slice(0, 24), pct: Math.min(95, Math.max(0, pct)), until: Date.now() + mins * 60e3 } });
          toast(`Flash sale on: ${code} for ${mins} min.`);
        }),
        btn('Remove', 'ghost', () => setShop({ items: sh.items.filter((x) => x.id !== p.id), pinned: sh.pinned === p.id ? '' : sh.pinned, sale: sh.sale?.id === p.id ? null : sh.sale })),
      );
      li.append(im, txt, acts);
      return li;
    }));
  }
  $('#shopAdd').onclick = () => {
    let url = $('#shopUrl').value.trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    const title = $('#shopTitle').value.trim(), img = $('#shopImg').value.trim();
    if (!title || !/^https:\/\//.test(url)) return toast('Add a name and an https:// product link.', { err: true });
    const src = /etsy\.com/i.test(url) ? 'etsy' : /myshopify\.com|shopify/i.test(url) ? 'shopify' : 'link';
    setShop({ items: [...shopCfg().items, { id: uid(), title, price: $('#shopPrice').value.trim(), url, img: /^https:\/\//.test(img) ? img : '', src }].slice(0, 24) });
    for (const id of ['#shopTitle', '#shopPrice', '#shopUrl', '#shopImg']) $(id).value = '';
  };
  // Shopify's Storefront API is made for browsers (public token, CORS allowed), so products load straight from the store.
  $('#shopDomain').value = store.get('shopDomain', ''); $('#shopToken').value = store.get('shopToken', '');
  $('#shopLoad').onclick = async () => {
    const domain = $('#shopDomain').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), token = $('#shopToken').value.trim();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain) || !token) return toast('Add your store address and its Storefront token.', { err: true });
    store.set('shopDomain', domain); store.set('shopToken', token);
    $('#shopMsg').textContent = 'Loading…';
    try {
      const r = await fetch(`https://${domain}/api/2025-01/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
        body: JSON.stringify({ query: '{ products(first: 24, sortKey: BEST_SELLING) { nodes { id title handle onlineStoreUrl featuredImage { url(transform: { maxWidth: 480 }) } priceRange { minVariantPrice { amount currencyCode } } } } }' }) });
      const j = await r.json();
      if (!r.ok || j.errors) throw new Error(j.errors?.[0]?.message || `Shopify answered ${r.status}`);
      const fmt = (p) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currencyCode }).format(p.amount); } catch { return p.amount; } };
      const items = j.data.products.nodes.map((n) => ({ id: n.id.split('/').pop().slice(-12), title: n.title, price: fmt(n.priceRange.minVariantPrice), img: n.featuredImage?.url || '', url: n.onlineStoreUrl || `https://${domain}/products/${n.handle}`, src: 'shopify' }));
      const keep = shopCfg().items.filter((x) => x.src !== 'shopify');
      setShop({ items: [...items, ...keep].slice(0, 24), store: domain });
      $('#shopMsg').textContent = `${items.length} products loaded.`;
    } catch (e) { $('#shopMsg').textContent = ''; toast('Couldn’t load your Shopify products: ' + e.message, { err: true, ms: 8000 }); }
  };
  /** The pinned product on stage, with a flash-sale countdown. Bottom-left, or top-left when a chat card is showing. */
  function drawProduct() {
    const sh = S.state.shop, p = sh?.items?.find((x) => x.id === sh.pinned);
    if (!p) return;
    const sale = sh.sale?.id === p.id && sh.sale.until > Date.now() ? sh.sale : null;
    const w = 420, h = sale ? 132 : 104, x = 28, y = S.state.featured ? 28 : app.H - h - 28;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
    g.fillStyle = '#ffffff'; rr(x, y, w, h, 16); g.fill(); g.shadowColor = 'transparent';
    const im = corsImg(p.img), pad = 14, is = h - pad * 2;
    if (im) { g.save(); rr(x + pad, y + pad, is, is, 10); g.clip(); const k = Math.max(is / im.naturalWidth, is / im.naturalHeight); g.drawImage(im, x + pad + (is - im.naturalWidth * k) / 2, y + pad + (is - im.naturalHeight * k) / 2, im.naturalWidth * k, im.naturalHeight * k); g.restore(); }
    else { g.fillStyle = S.state.brand.color; rr(x + pad, y + pad, is, is, 10); g.fill(); g.fillStyle = '#fff'; g.font = '800 30px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🛍', x + pad + is / 2, y + pad + is / 2); }
    const tx = x + pad * 2 + is;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = sale ? '#dc2626' : '#16a34a'; g.font = '800 12px Inter, sans-serif';
    g.fillText(sale ? `FLASH SALE${sale.pct ? ' · ' + sale.pct + '% OFF' : ''}` : 'SHOP THE SHOW', tx, y + 30);
    g.fillStyle = '#111827'; g.font = '700 20px Inter, sans-serif';
    g.fillText(wrapLines(p.title, w - (tx - x) - pad, 1)[0] || p.title, tx, y + 56);
    g.fillStyle = '#374151'; g.font = '600 16px Inter, sans-serif'; g.fillText(p.price || '', tx, y + 80);
    if (sale) { g.fillStyle = '#111827'; g.font = '700 15px Inter, sans-serif'; g.fillText(`Code ${sale.code} · ends in ${fmtTime(sale.until - Date.now())}`, tx, y + 110); }
    g.restore();
  }

  // ---------------------------------------------------------------- polls and predictions
  let pollKind = 'poll';
  S.pollCounts = [];
  $$('#pollKind button').forEach((b) => b.addEventListener('click', () => { pollKind = b.dataset.kind; $$('#pollKind button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); }));
  $('#pollGo').onclick = () => {
    const q = $('#pollQ').value.trim(), opts = $('#pollOpts').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4);
    if (!q || opts.length < 2) return toast('Add a question and at least two choices.', { err: true });
    setStage({ poll: { id: uid().slice(0, 8), kind: pollKind, q, opts, until: Date.now() + Number($('#pollMins').value) * 60e3, answer: -1 } });
    S.pollCounts = opts.map(() => 0); renderPoll();
  };
  $('#pollEnd').onclick = () => { if (S.state.poll) setStage({ poll: { ...S.state.poll, until: Math.min(S.state.poll.until, Date.now()) } }); renderPoll(); };
  function renderPoll() {
    const p = S.state.poll, box = $('#pollLive'); if (!box) return;
    if (!p) { replaceKids(box); $('#pollState').textContent = ''; return; }
    const open = p.until > Date.now(), total = S.pollCounts.reduce((a, b) => a + b, 0);
    $('#pollState').textContent = open ? `Live · ${fmtTime(p.until - Date.now())} left · ${total} vote${total === 1 ? '' : 's'}` : `Closed · ${total} votes`;
    const rows = p.opts.map((o, i) => {
      const n = S.pollCounts[i] || 0, pct = total ? Math.round(n / total * 100) : 0;
      const d = document.createElement('div'); d.className = 'poll-bar';
      const bar = document.createElement('i'); bar.style.width = pct + '%';
      const l = document.createElement('span'); l.textContent = (p.answer === i ? '✓ ' : '') + o; const r = document.createElement('b'); r.textContent = `${pct}% · ${n}`;
      d.append(bar, l, r);
      if (p.kind === 'predict' && !open && p.answer < 0) { d.style.cursor = 'pointer'; d.title = 'Settle the prediction with this answer'; d.onclick = () => setStage({ poll: { ...p, answer: i } }); }
      return d;
    });
    const title = document.createElement('p'); title.className = 'hint'; title.style.margin = '0';
    title.textContent = p.kind === 'predict' && !open && p.answer < 0 ? 'Voting closed. Click the right answer to settle the prediction.' : p.q;
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn sm ghost'; clear.textContent = 'Remove from screen'; clear.onclick = () => setStage({ poll: null });
    replaceKids(box, title, ...rows, clear);
  }
  /** The host reads live counts from the same cached feed viewers use (one GET every 2 s, only while a poll exists). */
  setInterval(async () => {
    if (!isHost() || !S.studio || !S.state.poll) return;
    try { const f = await (await fetch(`/api/studio?action=wfeed&studio=${encodeURIComponent(S.studio)}`)).json(); if (f.poll?.id === S.state.poll.id) S.pollCounts = f.poll.counts; } catch {}
    renderPoll();
  }, 2000);
  function drawPoll() {
    const p = S.state.poll; if (!p) return;
    const open = p.until > Date.now(), total = (S.pollCounts || []).reduce((a, b) => a + b, 0);
    const w = 360, rowH = 34, h = 70 + p.opts.length * (rowH + 8), x = app.W - w - 28, y = 28;
    g.save();
    g.fillStyle = 'rgba(10,14,26,.86)'; rr(x, y, w, h, 16); g.fill();
    g.fillStyle = '#9ca3af'; g.font = '800 12px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText((p.kind === 'predict' ? 'PREDICTION' : 'POLL') + (open ? ` · ${fmtTime(p.until - Date.now())} · vote on the watch page` : ` · ${total} votes`), x + 18, y + 26);
    g.fillStyle = '#fff'; g.font = '700 18px Inter, sans-serif'; g.fillText(wrapLines(p.q, w - 36, 1)[0] || p.q, x + 18, y + 52);
    p.opts.forEach((o, i) => {
      const n = (S.pollCounts || [])[i] || 0, pct = total ? n / total : 0, ry = y + 66 + i * (rowH + 8);
      g.fillStyle = 'rgba(255,255,255,.08)'; rr(x + 18, ry, w - 36, rowH, 8); g.fill();
      g.fillStyle = p.answer === i ? '#16a34a' : S.state.brand.color; if (pct) { rr(x + 18, ry, Math.max(12, (w - 36) * pct), rowH, 8); g.fill(); }
      g.fillStyle = '#fff'; g.font = '600 15px Inter, sans-serif'; g.fillText((p.answer === i ? '✓ ' : '') + o, x + 30, ry + 22);
      g.textAlign = 'right'; g.fillText(total ? Math.round(pct * 100) + '%' : '', x + w - 30, ry + 22); g.textAlign = 'left';
    });
    g.restore();
  }

  // ---------------------------------------------------------------- play with me: the viewer queue
  S.queue = [];
  function gotQueue(m) { chime(); toast(`${m.name}${m.tag ? ' (' + m.tag + ')' : ''} wants to play.`, { action: ['Open', () => { setTab('gaming'); }] }); S.queue.push({ name: m.name, tag: m.tag, status: 'waiting', ts: Date.now() }); renderQueue(S.queue); }
  function renderQueue(items) {
    if (items) S.queue = items;
    if (!$('#queueList')) return;
    const waiting = S.queue.filter((x) => x.status !== 'called');
    $('#queueCount').textContent = waiting.length ? `${waiting.length} waiting` : '';
    replaceKids($('#queueList'), ...S.queue.map((x) => { const li = document.createElement('li'); li.className = x.status; const a = document.createElement('span'); a.textContent = x.name; const b = document.createElement('small'); b.textContent = x.status === 'called' ? 'called' : x.tag || ''; li.append(a, b); return li; }));
  }
  $('#queueNext').onclick = () => { wsSend({ type: 'qpick' }); toast('The next player sees “You’re up!” with a button to join the stage.'); };
  $('#queueClear').onclick = () => { wsSend({ type: 'qclear' }); S.queue = []; renderQueue(); };
  $('#wpQueue').onchange = (e) => setWatch({ queue: e.target.checked });

  // ---------------------------------------------------------------- custom emotes
  function renderEmotes() {
    if (!$('#emoteList')) return;
    const list = S.state.emotes || [];
    $('#emoteCount').textContent = list.length ? `${list.length}` : '';
    replaceKids($('#emoteList'), ...list.map((e) => {
      const f = document.createElement('figure'); const src = assetImg(e.asset)?.src; const im = document.createElement(src ? 'img' : 'span'); if (src) { im.alt = e.name; im.src = src; } else { im.className = 'ph'; im.textContent = '…'; } const c = document.createElement('figcaption'); c.textContent = `:${e.name}:`;
      f.title = 'Click to remove'; f.style.cursor = 'pointer'; f.onclick = () => setStage({ emotes: list.filter((x) => x !== e) });
      f.append(im, c); return f;
    }));
  }
  $('#emoteAdd').onclick = () => { if (!/^[a-z0-9_]{2,20}$/i.test($('#emoteName').value.trim())) return toast('Name the emote first: 2–20 letters or numbers.', { err: true }); $('#emoteFile').click(); };
  $('#emoteAiBtn')?.addEventListener('click', async () => {
    if (!isHost()) return toast('Only the host can add emotes.', { err: true });
    const name = $('#emoteName').value.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,20}$/i.test(name)) return toast('Name the emote first: 2–20 letters or numbers.', { err: true });
    if (!S.studio) return toast('Enter a studio first to save custom emotes.', { err: true });
    const btn = $('#emoteAiBtn'); busy(btn);
    try {
      const col = normalizeHex(S.state.brand.color) || '#3b82f6';
      const txt = hexLuminance(col) > 0.42 ? '#070c1a' : '#ffffff';
      const lbl = name.slice(0, 6).toUpperCase().replace(/[<>&]/g, '');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="6" y="6" width="116" height="116" rx="30" fill="${col}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="4"/><text x="64" y="76" text-anchor="middle" font-family="Plus Jakarta Sans,Inter,sans-serif" font-weight="900" font-size="${lbl.length > 4 ? 24 : 30}" fill="${txt}">${lbl}</text></svg>`;
      const data = await rasterizeSvg(svg, 128, 128);
      const asset = await storeAsset(data);
      setStage({ emotes: [...(S.state.emotes || []).filter((x) => x.name !== name), { name, asset }] });
      $('#emoteName').value = '';
      toast(`:${name}: emote badge generated.`);
    } catch (err) { toast(err.message, { err: true }); }
    finally { busy(btn, false); }
  });
  $('#emoteFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f || !S.studio) return;
    if (f.size > 400_000) return toast('That image is too big. Use one under 200 KB.', { err: true });
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const asset = await storeAsset(data);
      setStage({ emotes: [...(S.state.emotes || []).filter((x) => x.name !== $('#emoteName').value.trim().toLowerCase()), { name: $('#emoteName').value.trim().toLowerCase(), asset }] });
      $('#emoteName').value = ''; toast('Emote added.');
    } catch (err) { toast(err.message, { err: true }); }
  };

  // ---------------------------------------------------------------- vertical: tell the watch page where the speaker is
  let lastFocus = 0.5;
  setInterval(() => {
    if (!isHost() || !S.studio || !app.camRects.length) return;
    const now = performance.now(), ids = S.state.stage || [];
    let best = -1, bestT = -1;
    ids.forEach((id, i) => { const t = speaking.get(id) || -1; if (app.camRects[i] && t > bestT && now - t < 1500) { bestT = t; best = i; } });
    const r = app.camRects[best >= 0 ? best : 0];
    const focus = Math.round(((r.x + r.w / 2) / app.W) * 100) / 100;
    if (Math.abs(focus - lastFocus) >= 0.08) { lastFocus = focus; setStage({ focus }); }
  }, 2000);

  window.__shopReady = true;
  setInterval(() => { if (isHost() && !$('[data-panel="shop"]')?.hidden) renderShop(); }, 1000);

  // ---------------------------------------------------------------- voice questions: raised hands from the watch page
  // A viewer records up to 45 s; their browser transcribes it. The host reads the transcript first, then previews it
  // privately, plays it on air (into the program, so the stream, the recording and the guests hear it), or deletes it.
  S.vms = new Map();
  const vmAudio = new Map(); // id -> data URL, fetched on first use
  function gotVoice(item, fresh) {
    if (!item?.id) return;
    const had = S.vms.has(item.id);
    S.vms.set(item.id, { ...(S.vms.get(item.id) || {}), ...item });
    if (fresh && !had) { chime(); toast(`🎙 ${item.name} raised a hand with a voice question.`, { ms: 9000, action: ['Review', () => { setTab('show'); $('#vmList')?.scrollIntoView({ block: 'center', behavior: smooth() }); }] }); }
    renderVoice();
  }
  function dropVoice(id) { S.vms.delete(id); vmAudio.delete(id); renderVoice(); }
  async function refreshVoice() { if (!S.studio || !isHost()) return; try { for (const x of (await api('vmList', creds())).items) gotVoice(x, false); } catch {} }
  async function voiceData(id) {
    if (!vmAudio.has(id)) vmAudio.set(id, (await api('vmGet', { ...creds(), vm: id })).data);
    return vmAudio.get(id);
  }
  let vmPlaying = null;
  async function playVoice(x, onAir) {
    try {
      vmPlaying?.stop();
      const a = new Audio(await voiceData(x.id));
      let mix = null;
      if (onAir) {
        // Into the program mix (stream, recording, guests) and to the host's own speakers (un-ducked speech).
        const node = audioCtx().createMediaElementSource(a);
        mix = mixInMedia(node, { duck: false, monitor: true });
        setStage({ featured: { id: 'vm-' + x.id, src: 'watch', name: x.name, text: x.transcript || 'Voice question', paid: '🎙' } });
        wsSend({ type: 'vmMark', id: x.id, status: 'aired' });
      } else wsSend({ type: 'vmMark', id: x.id, status: 'heard' });
      const stop = () => { try { a.pause(); } catch {} mix?.dispose(); if (vmPlaying?.a === a) vmPlaying = null; renderVoice(); };
      a.onended = stop;
      vmPlaying = { a, id: x.id, onAir, stop };
      await a.play();
      renderVoice();
    } catch (e) { toast(e.message || 'Couldn’t play that voice question.', { err: true }); }
  }
  async function aiTranscribe(x) {
    const key = store.get('aiKey:openai', '');
    if (!key) { toast('Add a ChatGPT (OpenAI) key in the AI panel for AI transcripts.', { err: true }); return setTab('ai'); }
    try {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'stt', apiKey: key, data: await voiceData(x.id) }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      x.transcript = j.text; x.ai = true; renderVoice();
    } catch (e) { toast(e.message, { err: true }); }
  }
  function voiceRow(x, inChat) {
    if (inChat) return voiceChatRow(x);
    const li = document.createElement('li'); li.className = (inChat ? 'msg ext vm-msg ' : 'sc-item ') + 'vm ' + (x.status || 'new'); li.dataset.vm = x.id;
    const top = document.createElement('div'); top.className = inChat ? 'who' : 'sc-top';
    const badge = document.createElement('span'); badge.className = 'pill caps src-watch'; badge.textContent = '🎙 Voice question';
    const who = document.createElement('b'); who.textContent = x.name;
    const meta = document.createElement('small'); meta.textContent = `${x.dur || '?'} s${x.status === 'aired' ? ' · played on air' : x.status === 'heard' ? ' · previewed' : ''}`;
    top.append(badge, who, meta);
    const txt = document.createElement('p'); txt.className = 'vm-text'; txt.textContent = x.transcript ? `“${x.transcript}”` : 'No transcript (their browser couldn’t transcribe). Preview it, or get an AI transcript.';
    if (x.ai) { const s = document.createElement('small'); s.textContent = ' · AI transcript'; txt.append(s); }
    const row = document.createElement('div'); row.className = 'row';
    const btn = (t, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = t; b.onclick = fn; return b; };
    const playing = vmPlaying?.id === x.id;
    row.append(
      playing ? btn('Stop', 'danger', () => vmPlaying.stop()) : btn('Preview (only you)', '', () => playVoice(x, false)),
      btn('Play on air', 'primary', () => playVoice(x, true)),
      btn('AI transcript', 'ghost', () => aiTranscribe(x)),
      btn('Delete', 'ghost', () => { if (vmPlaying?.id === x.id) vmPlaying.stop(); wsSend({ type: 'vmDel', id: x.id }); dropVoice(x.id); if (S.state.featured?.id === 'vm-' + x.id) setStage({ featured: null }); }),
    );
    li.append(top, txt, row);
    return li;
  }
  function voiceChatRow(x) {
    const li = document.createElement('li'); li.className = 'msg ext vm-msg vm ' + (x.status || 'new'); li.dataset.vm = x.id; li.dataset.src = 'watch';
    const who = document.createElement('div'); who.className = 'who';
    const b = document.createElement('b'); b.textContent = x.name;
    const tag = document.createElement('span'); tag.className = 'pill caps src-voice'; tag.textContent = 'Voice';
    who.append(b, tag);
    const card = document.createElement('div'); card.className = 'vm-card';
    const playing = vmPlaying?.id === x.id;
    const play = document.createElement('button'); play.type = 'button'; play.className = 'vm-play' + (playing ? ' on' : '');
    play.setAttribute('aria-label', playing ? 'Stop' : 'Preview: only you hear it'); play.dataset.tip = playing ? 'Stop' : 'Preview (only you hear it)';
    play.innerHTML = `<svg class="i" aria-hidden="true"><use href="/icons.svg#i-${playing ? 'square' : 'play'}"/></svg>`;
    play.onclick = () => (playing ? vmPlaying.stop() : playVoice(x, false));
    const wave = document.createElement('span'); wave.className = 'vm-wave'; wave.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 18; i++) { const bar = document.createElement('i'); bar.style.height = 30 + ((i * 37 + x.id.length * 13) % 70) + '%'; wave.append(bar); }
    const dur = document.createElement('span'); dur.className = 'vm-dur'; dur.textContent = `0:${String(x.dur || 0).padStart(2, '0')}`;
    const state = document.createElement('span'); state.className = 'vm-state'; state.textContent = x.status === 'aired' ? 'Played on air' : x.status === 'heard' ? 'Previewed' : 'New';
    card.append(play, wave, dur, state);
    const txt = document.createElement('p'); txt.className = 'vm-text';
    txt.textContent = x.transcript ? `“${x.transcript}”` : 'No transcript yet.';
    if (x.ai) { const sm = document.createElement('small'); sm.textContent = ' · AI transcript'; txt.append(sm); }
    const row = document.createElement('div'); row.className = 'vm-acts';
    const mk = (label, cls, icon, fn, tip) => { const k = document.createElement('button'); k.type = 'button'; k.className = 'btn sm ' + cls; k.innerHTML = icon ? `<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-${icon}"/></svg>` : ''; if (label) k.append(label); if (tip) { k.dataset.tip = tip; k.setAttribute('aria-label', tip); } k.onclick = fn; return k; };
    row.append(
      mk('Play on air', 'primary', 'radio', () => playVoice(x, true)),
      ...(x.transcript && !x.ai ? [] : [mk('', 'ghost icon-only', 'sparkles', () => aiTranscribe(x), 'AI transcript')]),
      mk('', 'ghost icon-only', 'trash-2', () => { if (vmPlaying?.id === x.id) vmPlaying.stop(); wsSend({ type: 'vmDel', id: x.id }); dropVoice(x.id); if (S.state.featured?.id === 'vm-' + x.id) setStage({ featured: null }); }, 'Delete'),
    );
    li.append(who, card, txt, row);
    chatShell(li, { id: 'vm-' + x.id, name: x.name, ts: x.ts });
    return li;
  }
  function renderVoice() {
    if (!$('#vmList')) return;
    const items = [...S.vms.values()].sort((a, b) => b.ts - a.ts);
    $('#vmEmpty').hidden = !!items.length;
    const fresh = items.filter((x) => x.status === 'new').length;
    $('#vmCount').textContent = items.length ? `${items.length}${fresh ? ` · ${fresh} new` : ''}` : '';
    replaceKids($('#vmList'), ...items.map((x) => voiceRow(x, false)));
    // In the studio chat too, so a raised hand is seen where the host is already looking.
    const log = $('#msgs');
    if (log) for (const x of items) { const old = log.querySelector(`[data-vm="${cssEsc(x.id)}"]`); const el = voiceRow(x, true); if (old) old.replaceWith(el); else appendLog(el); }
    if (log) for (const el of log.querySelectorAll('[data-vm]')) if (!S.vms.has(el.dataset.vm)) el.remove();
  }

  // ---------------------------------------------------------------- where viewers find the watch page
  $('#watchTop').onclick = (ev) => {
    if (!S.studio) return;
    const url = watchLinkUrl();
    copy(url, 'Watch link copied. Share it anywhere.');
    if (ev.shiftKey || ev.metaKey) window.open(url, '_blank', 'noopener');
  };
  $('#copyWatch').onclick = () => { copy(watchLinkUrl(), 'Watch link copied.'); flashBtn($('#copyWatch'), 'Copied'); };
  $('#openWatch').onclick = () => window.open(watchLinkUrl(), '_blank', 'noopener');
  $('#inviteDlg').addEventListener('toggle', () => { if ($('#inviteDlg').open && S.studio) renderInviteDialog(); });
  /** On stream: "Watch & chat live · host/w/code", bottom right, unless the host turned it off or placed the QR card. */
  function drawWatchBadge() {
    S.badgeRect = null;
    if (!S.studio || watchCfg().badge === false) return;
    if ((S.state.elements || []).some((e) => e.type === 'callin' && !e.hidden)) return;
    const text = watchLinkText(), label = (watchCfg().badgeLabel || 'Watch & chat live').toUpperCase();
    g.save();
    g.font = '700 15px Inter, sans-serif'; const tw = g.measureText(text).width;
    g.font = '800 11px Inter, sans-serif'; const lw = g.measureText(label).width;
    const w = Math.max(tw, lw) + 56, h = 50, tick = (stageElements().find((e) => e.type === 'ticker' && !e.hidden) && S.state.ticker) ? 56 : 0;
    const x = app.W - w - 24, y = app.H - h - 24 - tick;
    g.fillStyle = 'rgba(8,12,22,.82)'; rr(x, y, w, h, 12); g.fill();
    g.fillStyle = S.state.brand.color; rr(x + 12, y + 15, 20, 20, 6); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + 19, y + 20); g.lineTo(x + 27, y + 25); g.lineTo(x + 19, y + 30); g.closePath(); g.fill();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#9ca3af'; g.font = '800 11px Inter, sans-serif'; g.fillText(label, x + 42, y + 20);
    g.fillStyle = '#fff'; g.font = '700 15px Inter, sans-serif'; g.fillText(text, x + 42, y + 38);
    g.restore();
    S.badgeRect = { x, y, w, h };
  }

  // Panel sections remember being folded (per browser), so each host's panels open the way they left them.
  {
    const folded = new Set(store.get('foldedSecs', []));
    for (const d of document.querySelectorAll('details.psec[data-sec]')) {
      if (folded.has(d.dataset.sec)) d.open = false;
      d.addEventListener('toggle', () => { if (d.open) folded.delete(d.dataset.sec); else folded.add(d.dataset.sec); store.set('foldedSecs', [...folded]); });
    }
  }

  // Keyboard users get focus rings everywhere; pointer users don't see a ring left on a header button after a click.
  addEventListener('keydown', (e) => { if (e.key === 'Tab' || (typeof e.key === 'string' && e.key.startsWith('Arrow'))) document.body.classList.add('kbd'); }, true);
  addEventListener('pointerdown', () => document.body.classList.remove('kbd'), true);

  // The studio's light: a tiny copy of the stage, blurred huge behind the glass, so the room takes on the show's colours.
  {
    const amb = document.createElement('canvas'); amb.className = 'amb'; amb.width = 48; amb.height = 27;
    document.querySelector('.backdrop')?.append(amb);
    const cx = amb.getContext('2d', { alpha: false });
    const quiet = matchMedia('(prefers-reduced-transparency: reduce)');
    setInterval(() => {
      if (document.hidden || quiet.matches || document.body.classList.contains('pre')) return;
      try { cx.drawImage(canvas, 0, 0, amb.width, amb.height); amb.classList.add('on'); } catch {}
    }, 400);
  }


  // The "Watch & chat live" badge on the stream: the host can point at it on the stage, change its words or hide it.
  {
    const hit = document.createElement('button');
    hit.type = 'button'; hit.className = 'badge-hit'; hit.hidden = true; hit.setAttribute('aria-label', 'Edit the watch link badge');
    hit.innerHTML = '<span>Edit badge</span>';
    $('#stage').append(hit);
    const pop = document.createElement('div');
    pop.className = 'popover glass raised badge-pop'; pop.popover = 'auto'; pop.setAttribute('aria-label', 'Watch link badge');
    pop.innerHTML = `<b>Watch link on stream</b><p class="hint">Points platform viewers to your watch page, where they can chat and tip.</p>
    <label class="fld"><span>Label</span><input class="input" id="badgeLabelIn" maxlength="28" placeholder="Watch & chat live"></label>
    <div class="badge-pop-row"><button type="button" class="btn sm" id="badgeHide">Hide from stream</button><button type="button" class="btn sm primary" id="badgeDone">Done</button></div>`;
    document.body.append(pop);
    hit.onclick = () => { pop.querySelector('#badgeLabelIn').value = watchCfg().badgeLabel || ''; togglePopover(pop, hit, 'top'); pop.querySelector('#badgeLabelIn').focus(); };
    pop.querySelector('#badgeLabelIn').addEventListener('input', (e) => setWatch({ badgeLabel: e.target.value.slice(0, 28) }));
    pop.querySelector('#badgeHide').onclick = () => { setWatch({ badge: false }); pop.hidePopover(); toast('The watch link badge is off. Turn it back on in Show → Viewer features.'); };
    pop.querySelector('#badgeDone').onclick = () => pop.hidePopover();
    let last = '';
    const place = () => {
      const r = S.badgeRect, show = !!r && isHost() && !document.body.classList.contains('pre');
      const key = show ? `${r.x}|${r.y}|${r.w}|${r.h}` : '';
      if (key !== last) {
        last = key; hit.hidden = !show;
        if (show) Object.assign(hit.style, { left: (r.x / app.W * 100) + '%', top: (r.y / app.H * 100) + '%', width: (r.w / app.W * 100) + '%', height: (r.h / app.H * 100) + '%' });
      }
      requestAnimationFrame(place);
    };
    requestAnimationFrame(place);
  }

  // The page loader leaves once the page has its fonts and styles (the studio's own data shows as skeletons).
  if (document.readyState === 'complete') window.gatherBoot?.done(); else addEventListener('load', () => window.gatherBoot?.done(), { once: true });

  // Landing preview: the mock chat plays like a real one. Messages arrive one by one, a super chat lands with an alert
  // on the stage, the AI types its answer, reactions float up, and the viewer count ticks. Paused when off screen.
  {
    const win = $('.hz-win'), feed = $('.hz-feed');
    const quiet = matchMedia('(prefers-reduced-motion: reduce)');
    if (win && feed && !quiet.matches) {
      const POOL = [
        { n: 'Dev', h: 20, t: 'What camera is that?' },
        { n: 'Ana', h: 200, t: 'Hi from Lisbon 👋' },
        { n: 'Kai', h: 300, t: 'The new layout looks so clean' },
        { n: 'Jason', h: 140, t: 'Love this format!', paid: '$10' },
        { ai: 1, t: 'A Sony ZV-E10. Link’s on screen.' },
        { n: 'Lena', h: 260, t: '🔥🔥🔥' },
        { n: 'Marco', h: 40, t: 'Watching from Austin 🤠' },
        { n: 'Noah', h: 170, t: '@Sam can we get the slides after?' },
        { ai: 1, t: 'Yes. They go out by email right after the show.' },
        { n: 'Zoe', h: 330, t: 'Best setup I’ve seen on a stream', paid: '$5' },
        { n: 'Omar', h: 90, t: 'First time here, this is great' },
        { n: 'Kai', h: 300, t: 'gg 👏' },
      ];
      const REACT = ['❤️', '🔥', '👏', '😂', '🎉', '💙'];
      const stage = $('.hz-stage'), floats = $('.hz-floats'), views = $('.hz-views'), typing = $('.hz-typing');
      const tiles = $$('.hz-tile');
      let i = 0, visible = true, count = 1284, first = true;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const running = () => visible && !document.hidden && document.body.classList.contains('pre') && !document.documentElement.classList.contains('booting');
      const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
      const drop = (node, ms) => setTimeout(() => node.remove(), ms);

      function bubble(m) {
        const li = el('div', 'hz-msg in' + (m.paid ? ' paid' : '') + (m.ai ? ' ai' : ''));
        const av = el('span', 'hz-mav' + (m.ai ? ' orb' : ''), m.ai ? '' : m.n[0]);
        if (!m.ai) av.style.setProperty('--h', m.h);
        const body = el('div'), name = el('b', '', m.ai ? 'Sam ' : m.n + ' ');
        if (m.paid || m.ai) name.append(el('em', '', m.ai ? 'AI' : m.paid));
        body.append(name, el('p', '', m.t)); li.append(av, body);
        return li;
      }
      function push(li) {
        feed.append(li);
        const h = li.offsetHeight; // grow into place so everything above glides up instead of jumping
        li.animate([{ height: '0px', marginTop: '-8px' }, { height: h + 'px', marginTop: '0px' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
        while (feed.children.length > 8) feed.firstElementChild.remove();
      }
      function float(n = 1) {
        for (let k = 0; k < n; k++) {
          const f = el('span', 'hz-float', REACT[Math.floor(Math.random() * REACT.length)]);
          f.style.setProperty('--dx', (Math.random() * -90 - 10).toFixed(0) + 'px');
          f.style.setProperty('--r', (Math.random() * 40 - 20).toFixed(0) + 'deg');
          f.style.setProperty('--t', (2.4 + Math.random() * 1.2).toFixed(2) + 's');
          f.style.right = (5 + Math.random() * 6).toFixed(1) + '%';
          f.style.animationDelay = (k * 0.12).toFixed(2) + 's';
          floats.append(f); drop(f, 4200);
        }
      }
      function alertPaid(m) {
        const t = el('div', 'hz-toast'); t.append(el('b', '', m.paid), document.createTextNode(`${m.n} sent a super chat`));
        stage.append(t); drop(t, 3300);
      }
      async function say(m) {
        if (m.ai) {
          typing.hidden = false;
          const li = bubble({ ...m, t: '' }); const p = li.querySelector('p');
          const dots = el('span', 'hz-dots'); dots.append(el('i'), el('i'), el('i')); replaceKids(p, dots);
          push(li); await sleep(1100);
          typing.hidden = true;
          const txt = document.createTextNode(''), cur = el('span', 'cur'); replaceKids(p, txt, cur);
          for (const ch of m.t) { txt.data += ch; await sleep(22); }
          await sleep(500); cur.remove();
          return;
        }
        push(bubble(m));
        if (m.paid) { alertPaid(m); float(5); }
        else if (/🔥|👏|👋|🤠/u.test(m.t)) float(2);
      }
      async function loop() {
        for (;;) {
          if (!running()) { await sleep(600); continue; }
          if (first) { first = false; i = 5; await sleep(1200); }
          const m = POOL[i++ % POOL.length];
          await say(m);
          if (Math.random() < 0.55) float(1 + Math.floor(Math.random() * 2));
          if (Math.random() < 0.6) { count += 1 + Math.floor(Math.random() * 9); views.textContent = count.toLocaleString('en-US'); views.classList.remove('tick'); void views.offsetWidth; views.classList.add('tick'); }
          if (i % 3 === 0) tiles.forEach((t) => t.classList.toggle('talk')); // the speaker changes now and then
          await sleep(i <= 7 ? 1100 : 1600 + Math.random() * 900);
        }
      }
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(win);
      loop();
    }
  }


  return { watchSlug, watchLinkUrl, watchLinkText, viewerWant, viewerSignal, closeViewer, closeAllViewers, money, gotSuperchat, renderBountyPanel, drawBountyEl, refreshSupers, reactFloat, setWatch, renderWatchSec, shopCfg, setShop, drawProduct, drawPoll, gotQueue, renderQueue, gotVoice, dropVoice, refreshVoice, drawWatchBadge };
}
