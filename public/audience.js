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

  // Super chats: direct-to-streamer payouts (host confirms when payment lands) + optional auto-confirmed Stripe Express.
  S.supers = new Map();
  const money = (a) => '$' + (Number.isInteger(a) ? a : Number(a).toFixed(2));
  const PAY_LABELS = { card: 'Card', stripe: 'Stripe', paypal: 'PayPal', venmo: 'Venmo', cashapp: 'Cash App', kofi: 'Ko-fi', patreon: 'Patreon', bmc: 'Buy Me a Coffee' };
  const payLabel = (m) => PAY_LABELS[m] || 'Direct';
  function showConfirmedSuper(item) {
    if (item.bounty) acceptBounty(item);
    else setStage({ featured: { id: 'w-' + item.id, src: 'watch', name: item.name, text: item.text || (item.voice ? 'Voice super chat' : 'Sent a super chat'), paid: money(item.amount) } });
    superAlert(item);
    window.__gatherAuto?.onSuper(item);
  }
  function gotSuperchat(item, fresh) {
    if (!item?.id || item.status === 'paying') return;
    const was = S.supers.get(item.id)?.status;
    S.supers.set(item.id, item);
    if (fresh && item.status === 'pending' && was !== 'pending') {
      chime?.();
      toast(`💵 ${money(item.amount)} ${payLabel(item.method)} super chat from ${item.name} — check your ${payLabel(item.method)} and click Confirm & air.`, { ms: 9000 });
    } else if (fresh && item.auto && item.status === 'confirmed' && was !== 'confirmed') { // paid by card on the watch page: on screen right away
      toast(`💳 ${money(item.amount)} super chat from ${item.name}, paid directly to your Stripe account.`, { ms: 8000 });
      showConfirmedSuper(item);
    }
    renderSupers();
  }
  function superAct(item, act) {
    notifier.dismiss('sc-' + item.id);
    wsSend({ type: 'superchat', id: item.id, do: act });
    const wasConfirmed = item.status === 'confirmed' || item.status === 'answered';
    item.status = { confirm: 'confirmed', dismiss: 'dismissed', answered: 'answered' }[act] || item.status;
    if (act === 'confirm' && !wasConfirmed) {
      toast(`Confirmed! ${money(item.amount)} super chat from ${item.name} is now live.`);
      showConfirmedSuper(item);
    }
    if ((act === 'answered' || act === 'dismiss') && S.state.featured?.id === 'w-' + item.id) setStage({ featured: null });
    renderSupers();
  }
  // ---------------------------------------------------------------- bounties: viewer-funded challenges on the stream
  function formatBountyAmt(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '$10';
    if (/^\d+(\.\d{1,2})?$/.test(s)) return money(Number(s));
    return s.slice(0, 16);
  }
  function parseBountyVal(amt) {
    const m = String(amt || '').replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
    return m ? Number(m[1]) : 0;
  }
  function hasBountyBoard() {
    return (S.state.elements || []).some((e) => e.type === 'bounty' && !e.hidden);
  }
  function ensureBountyBoard(on = true) {
    const els = stageElements();
    const existing = els.find((e) => e.type === 'bounty');
    if (on) {
      if (existing) {
        if (existing.hidden) setStage({ elements: els.map((x) => (x.id === existing.id ? { ...x, hidden: false } : x)) });
        return;
      }
      const e = withDefaults({ type: 'bounty' }), spot = freeSpot(e, els);
      if (spot) Object.assign(e, spot); else e.stack = true;
      e.home = [e.x, e.y, e.w, e.h];
      setStage({ elements: [...els, e] });
    } else if (existing) {
      setStage({ elements: els.filter((x) => x.id !== existing.id) });
    }
  }
  function acceptBounty(item) {
    const list = (S.state.bounties || []).filter((b) => b.id !== item.id);
    const amtText = typeof item.amount === 'number' ? money(item.amount) : formatBountyAmt(item.amount);
    list.push({ id: item.id, name: String(item.name || S.name || 'Viewer').trim() || 'Viewer', text: String(item.text || '').trim().slice(0, 120), amount: amtText, status: 'active', ts: Date.now(), endedAt: 0 });
    const patch = { bounties: list };
    if (!(S.state.elements || []).some((e) => e.type === 'bounty')) {
      const e = withDefaults({ type: 'bounty' }), els = stageElements(), spot = freeSpot(e, els);
      if (spot) Object.assign(e, spot); else e.stack = true;
      e.home = [e.x, e.y, e.w, e.h]; patch.elements = [...els, e];
    } else if ((S.state.elements || []).some((e) => e.type === 'bounty' && e.hidden)) {
      patch.elements = stageElements().map((e) => (e.type === 'bounty' ? { ...e, hidden: false } : e));
    }
    setStage(patch);
    toast(`Bounty live: “${item.text}” (${amtText}). Shows on stream until marked done.`, { ms: 5000 });
  }
  function addHostBounty(text, amount, from) {
    if (!isHost()) return toast('Only the host can post bounties.', { err: true });
    const cleanText = String(text || '').trim().slice(0, 120);
    if (!cleanText) return toast('Enter a challenge for the bounty first.', { err: true });
    const who = String(from || '').trim().slice(0, 40) || S.name || 'Host';
    const amt = formatBountyAmt(amount);
    acceptBounty({ id: 'b-' + uid(), name: who, text: cleanText, amount: amt });
    renderBountyPanel();
  }
  function endBounty(id, status) {
    setStage({ bounties: (S.state.bounties || []).map((b) => (b.id === id ? { ...b, status, endedAt: status === 'active' ? 0 : Date.now() } : b)) });
    if (status === 'done') toast('Bounty completed! Flashes on stream, then clears.');
    else if (status === 'active') toast('Bounty reopened on stream.');
  }
  function removeBounty(id) {
    setStage({ bounties: (S.state.bounties || []).filter((b) => b.id !== id) });
  }
  function bindBountyControls() {
    const textIn = $('#bountyText');
    const amtIn = $('#bountyAmt');
    const fromIn = $('#bountyFrom');
    const addBtn = $('#bountyAddBtn');
    const stageToggle = $('#bountyStageToggle');
    const presets = $('#bountyPresets');
    const clearHist = $('#bountyClearHistory');
    const submit = () => {
      if (!textIn) return;
      const t = textIn.value.trim();
      if (!t) { textIn.focus(); return; }
      addHostBounty(t, amtIn?.value, fromIn?.value);
      textIn.value = '';
      if (fromIn) fromIn.value = '';
    };
    addBtn?.addEventListener('click', submit);
    textIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    amtIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    fromIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    stageToggle?.addEventListener('change', () => {
      if (!isHost()) { stageToggle.checked = hasBountyBoard(); return toast('Only the host can change stage overlays.', { err: true }); }
      ensureBountyBoard(stageToggle.checked);
      toast(stageToggle.checked ? 'Bounty board added to stage.' : 'Bounty board hidden from stage.');
    });
    presets?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-bounty-text]');
      if (!btn) return;
      addHostBounty(btn.dataset.bountyText, btn.dataset.bountyAmt || '$10', fromIn?.value || 'Viewer challenge');
    });
    clearHist?.addEventListener('click', () => {
      if (!isHost()) return;
      setStage({ bounties: (S.state.bounties || []).filter((b) => b.status === 'active') });
      toast('Cleared resolved bounties.');
    });
  }
  bindBountyControls();

  function renderBountyPanel() {
    const box = $('#bountyList'); if (!box) return;
    const all = S.state.bounties || [];
    const active = all.filter((b) => b.status === 'active');
    const resolved = all.filter((b) => b.status !== 'active').slice().reverse();
    const totalActive = active.reduce((sum, b) => sum + parseBountyVal(b.amount), 0);

    const summaryEl = $('#bountySummary');
    if (summaryEl) {
      summaryEl.textContent = active.length
        ? `${active.length} live${totalActive > 0 ? ` · ${money(totalActive)}` : ''}`
        : 'viewer-funded challenges';
    }
    const stageToggle = $('#bountyStageToggle');
    if (stageToggle) stageToggle.checked = hasBountyBoard();

    const emptyEl = $('#bountyEmpty');
    if (emptyEl) emptyEl.hidden = !!active.length;

    replaceKids(box, ...active.map((b) => {
      const li = document.createElement('li'); li.className = 'bounty-item';
      const top = document.createElement('div'); top.className = 'bounty-item-top';
      const info = document.createElement('div'); info.className = 'bounty-item-info';
      const title = document.createElement('b'); title.textContent = b.text;
      const meta = document.createElement('small'); meta.textContent = `Funded by ${b.name}`;
      info.append(title, meta);
      const amt = document.createElement('span'); amt.className = 'bounty-amt num'; amt.textContent = b.amount || '$10';
      top.append(info, amt);

      const acts = document.createElement('div'); acts.className = 'bounty-item-acts';
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn sm primary'; ok.textContent = '✓ Done'; ok.onclick = () => endBounty(b.id, 'done');
      const no = document.createElement('button'); no.type = 'button'; no.className = 'btn sm ghost'; no.textContent = '✗ Fail'; no.onclick = () => endBounty(b.id, 'failed');
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn sm ghost bounty-del'; del.ariaLabel = 'Remove bounty'; del.textContent = '×'; del.onclick = () => removeBounty(b.id);
      acts.append(ok, no, del);
      li.append(top, acts);
      return li;
    }));

    const histWrap = $('#bountyHistoryWrap');
    const histList = $('#bountyHistoryList');
    const histCount = $('#bountyHistoryCount');
    if (histWrap && histList) {
      histWrap.hidden = !resolved.length;
      if (histCount) {
        const doneCount = resolved.filter((b) => b.status === 'done').length;
        histCount.textContent = `${resolved.length} resolved · ${doneCount} completed`;
      }
      replaceKids(histList, ...resolved.map((b) => {
        const li = document.createElement('li'); li.className = 'bounty-hist-row is-' + b.status;
        const copy = document.createElement('div'); copy.className = 'bounty-hist-copy';
        const title = document.createElement('span'); title.textContent = b.text;
        const meta = document.createElement('small'); meta.textContent = `${b.status === 'done' ? 'Completed' : 'Failed'} · ${b.amount || '$10'} · ${b.name}`;
        copy.append(title, meta);
        const reopen = document.createElement('button'); reopen.type = 'button'; reopen.className = 'btn sm ghost'; reopen.textContent = 'Reopen'; reopen.onclick = () => endBounty(b.id, 'active');
        li.append(copy, reopen);
        return li;
      }));
    }
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
    const items = [...S.supers.values()].filter((x) => x.status !== 'dismissed').sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return b.ts - a.ts;
    });
    $('#scEmpty').hidden = !!items.length;
    const pendingCount = items.filter((x) => x.status === 'pending').length;
    const total = [...S.supers.values()].filter((x) => x.status === 'confirmed' || x.status === 'answered').reduce((s, x) => s + x.amount, 0);
    $('#scTotal').textContent = pendingCount
      ? `${pendingCount} to confirm${total ? ` · ${money(total)} confirmed` : ''}`
      : total ? `${money(total)} confirmed` : '';
    replaceKids(box, ...items.map((x) => {
      const li = document.createElement('li'); li.className = 'sc-item ' + x.status;
      const top = document.createElement('div'); top.className = 'sc-top';
      const amt = document.createElement('span'); amt.className = 'paid-amt num'; amt.textContent = money(x.amount);
      const who = document.createElement('b'); who.textContent = x.name;
      const via = document.createElement('small');
      const mLabel = payLabel(x.method);
      via.textContent = x.status === 'pending'
        ? `via ${mLabel} · confirm receipt`
        : x.status === 'answered'
          ? `via ${mLabel} · answered`
          : x.auto ? `paid by ${mLabel}` : `confirmed via ${mLabel}`;
      top.append(amt, who, via);
      const txt = document.createElement('p'); txt.textContent = x.text || '(no message)';
      const row = document.createElement('div'); row.className = 'row';
      const btn = (t, cls, act) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = t; b.onclick = () => superAct(x, act); return b; };
      if (x.status === 'pending') {
        row.append(btn('Confirm & air', 'primary', 'confirm'), btn('Dismiss', 'ghost', 'dismiss'));
      } else {
        if (x.status === 'confirmed') row.append(btn('Answered', '', 'answered'));
        const vb = (t, cls, onAir) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ' + cls; b.textContent = t; b.onclick = () => playScVoice(x, onAir); return b; };
        if (x.voice) row.append(vb(`▶ Voice ${x.voice}s`, 'ghost', false), vb('Play on air', '', true));
        const r = document.createElement('button'); r.type = 'button'; r.className = 'btn sm ghost'; r.textContent = 'Replay alert'; r.onclick = () => superAlert(x); row.append(r);
      }
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

  // ---- Direct creator payout providers: streamer approves each method and connects their own account (0% platform cut)
  const DIRECT_PROVIDERS = [
    {
      id: 'stripe', name: 'Stripe', sub: 'Card, Apple Pay & Google Pay', color: '#635bff',
      placeholder: 'https://buy.stripe.com/your-link',
      helpLabel: 'Create link ↗', helpUrl: 'https://dashboard.stripe.com/payment-links',
      normalize: (raw) => {
        const s = String(raw || '').trim().replace(/^http:\/\//i, 'https://');
        const u = /^(buy|donate)\.stripe\.com\//i.test(s) ? 'https://' + s : s;
        return /^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_-]{4,120}$/.test(u) ? u : '';
      },
      err: 'Paste a Stripe Payment Link starting with buy.stripe.com/ or donate.stripe.com/',
      display: (v) => v.replace(/^https:\/\//i, ''),
      testUrl: (v) => (/^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_-]{4,120}$/.test(v) ? v : ''),
    },
    {
      id: 'paypal', name: 'PayPal', sub: 'PayPal, Debit & Credit', color: '#0070ba',
      placeholder: 'yourname or paypal.me/yourname',
      helpLabel: 'Get PayPal.me ↗', helpUrl: 'https://www.paypal.com/paypalme/',
      normalize: (raw) => {
        const s = String(raw || '').trim().replace(/^(https?:\/\/)?(www\.)?paypal\.me\/|^@/i, '').replace(/\/+$/, '').trim();
        return s && !s.includes('..') && /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : '';
      },
      err: 'Enter your PayPal.me username (letters, numbers, dots or dashes).',
      display: (v) => 'paypal.me/' + v,
      testUrl: (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://paypal.me/${encodeURIComponent(v)}` : ''),
    },
    {
      id: 'venmo', name: 'Venmo', sub: 'Instant mobile tips', color: '#008cff',
      placeholder: '@yourhandle',
      helpLabel: 'Venmo profile ↗', helpUrl: 'https://account.venmo.com/',
      normalize: (raw) => {
        const s = String(raw || '').trim().replace(/^(https?:\/\/)?(www\.|account\.)?venmo\.com\/(u\/)?|^@/i, '').replace(/\/+$/, '').trim();
        return s && /^[A-Za-z0-9_-]{2,30}$/.test(s) ? s : '';
      },
      err: 'Enter your Venmo handle (2–30 letters, numbers, dashes or underscores).',
      display: (v) => '@' + v,
      testUrl: (v) => (/^[A-Za-z0-9_-]{2,30}$/.test(v) ? `https://venmo.com/u/${encodeURIComponent(v)}` : ''),
    },
    {
      id: 'cashapp', name: 'Cash App', sub: 'Instant $cashtag tips', color: '#00d632',
      placeholder: '$yourtag',
      helpLabel: 'Cash App ↗', helpUrl: 'https://cash.app/',
      normalize: (raw) => {
        const s = String(raw || '').trim().replace(/^(https?:\/\/)?(www\.)?cash\.app\/\$?|^\$/i, '').replace(/\/+$/, '').trim();
        return s && /^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(s) ? s : '';
      },
      err: 'Enter your Cash App $cashtag (starts with a letter, up to 20 chars).',
      display: (v) => '$' + v,
      testUrl: (v) => (/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(v) ? `https://cash.app/$${encodeURIComponent(v)}` : ''),
    },
    {
      id: 'kofi', name: 'Ko-fi', sub: 'Zero-fee creator tips', color: '#ff5e5b',
      placeholder: 'ko-fi.com/yourname',
      helpLabel: 'Ko-fi ↗', helpUrl: 'https://ko-fi.com/',
      normalize: (raw) => {
        const s = String(raw || '').trim().replace(/^(https?:\/\/)?(www\.)?ko-fi\.com\/|^@/i, '').replace(/\/+$/, '').trim();
        return s && !s.includes('..') && /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : '';
      },
      err: 'Enter your Ko-fi username.',
      display: (v) => 'ko-fi.com/' + v,
      testUrl: (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://ko-fi.com/${encodeURIComponent(v)}` : ''),
    },
    {
      id: 'patreon', name: 'Patreon', sub: 'Direct creator support', color: '#f96854',
      placeholder: 'patreon.com/yourname',
      helpLabel: 'Patreon ↗', helpUrl: 'https://www.patreon.com/',
      normalize: (raw) => {
        const s = String(raw || '').trim().replace(/^(https?:\/\/)?(www\.)?patreon\.com\/(c\/|cw\/)?|^@/i, '').replace(/\/+$/, '').trim();
        return s && !s.includes('..') && /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : '';
      },
      err: 'Enter your Patreon page username.',
      display: (v) => 'patreon.com/' + v,
      testUrl: (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://www.patreon.com/${encodeURIComponent(v)}` : ''),
    },
    {
      id: 'bmc', name: 'Buy Me a Coffee', sub: 'Quick supporter tips', color: '#ffdd00',
      placeholder: 'buymeacoffee.com/you',
      helpLabel: 'Open ↗', helpUrl: 'https://www.buymeacoffee.com/',
      normalize: (raw) => {
        const s = String(raw || '').trim().replace(/^(https?:\/\/)?(www\.)?buymeacoffee\.com\/|^@/i, '').replace(/\/+$/, '').trim();
        return s && !s.includes('..') && /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : '';
      },
      err: 'Enter your Buy Me a Coffee username.',
      display: (v) => 'buymeacoffee.com/' + v,
      testUrl: (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://www.buymeacoffee.com/${encodeURIComponent(v)}` : ''),
    },
  ];
  const payEditOpen = new Set();
  const payFieldErr = {};
  const payDraft = {};
  let payCloudTimer = null;
  let payCloudHydratedUid = '';
  function activeDirectMethods(cfg = watchCfg()) {
    return DIRECT_PROVIDERS.filter((p) => !!cfg.pay?.[p.id] && cfg.payOn?.[p.id] !== false);
  }
  function syncTipStore(id, value) {
    const tips = store.get('tips', {});
    tips[id] = value || '';
    store.set('tips', tips);
    const inp = $(`#tipList .tip-row[data-provider="${id}"] input`);
    if (inp && document.activeElement !== inp) inp.value = value || '';
  }
  function updatePayCloudBadge(label = '') {
    const el = $('#wpPayCloudState');
    if (!el) return;
    const user = window.gatherCloud?.getSnapshot?.().user;
    if (!user) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = label || 'Synced to your account';
  }
  function queueCloudPaySave(cfg) {
    if (!window.gatherCloud?.savePaymentSettings || !window.gatherCloud?.getSnapshot?.().user) return;
    clearTimeout(payCloudTimer);
    updatePayCloudBadge('Saving…');
    payCloudTimer = setTimeout(() => {
      window.gatherCloud.savePaymentSettings(cfg)
        .then((ok) => updatePayCloudBadge(ok ? 'Synced to your account' : ''))
        .catch(() => updatePayCloudBadge('Saved locally'));
    }, 250);
  }
  function bindPaymentCloudSync() {
    if (!window.gatherCloud?.subscribe) return;
    window.gatherCloud.subscribe((snap, reason) => {
      if (!snap.user) {
        payCloudHydratedUid = '';
        updatePayCloudBadge('');
        return;
      }
      updatePayCloudBadge('Synced to your account');
      if (reason === 'paymentSettings') {
        const doc = snap.paymentSettings;
        if (doc && typeof doc === 'object') {
          payCloudHydratedUid = snap.user.uid;
          const nextPay = {};
          const nextOn = {};
          for (const p of DIRECT_PROVIDERS) {
            nextPay[p.id] = typeof doc[p.id] === 'string' ? doc[p.id] : '';
            nextOn[p.id] = !!doc[p.id + 'On'];
            if (nextPay[p.id]) syncTipStore(p.id, p.id === 'stripe' ? nextPay[p.id] : p.display(nextPay[p.id]));
          }
          const cur = watchCfg();
          const merged = {
            ...cur,
            pay: { ...cur.pay, ...nextPay },
            payOn: { ...cur.payOn, ...nextOn },
            supers: typeof doc.supersEnabled === 'boolean' ? doc.supersEnabled : cur.supers,
            bounties: typeof doc.bountiesEnabled === 'boolean' ? doc.bountiesEnabled : cur.bounties,
            min: Math.max(1, Math.min(500, Number(doc.minAmount) || cur.min || 2)),
          };
          store.set('watchPrefs', merged);
          if (isHost() && S.studio) setStage({ watch: merged });
          else S.state.watch = merged;
          renderWatchSec();
        } else if (payCloudHydratedUid !== snap.user.uid) {
          payCloudHydratedUid = snap.user.uid;
          const cur = watchCfg();
          const hasLocalPay = DIRECT_PROVIDERS.some((p) => !!cur.pay?.[p.id]);
          if (hasLocalPay) queueCloudPaySave(cur);
        }
      }
    });
  }
  if (window.gatherCloud) bindPaymentCloudSync();
  else window.addEventListener('load', bindPaymentCloudSync, { once: true });

  function renderDirectPayouts(force = false) {
    const box = $('#wpDirectPayList'); if (!box) return;
    if (!force && box.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return;
    const cfg = watchCfg();
    const host = isHost();
    replaceKids(box, ...DIRECT_PROVIDERS.map((p) => {
      const savedVal = cfg.pay?.[p.id] || '';
      const approved = !!cfg.payOn?.[p.id];
      const connected = approved && !!savedVal;
      const editing = payEditOpen.has(p.id) || (approved && !savedVal);
      const card = document.createElement('div');
      card.className = 'pay-prov' + (connected ? ' is-connected' : approved ? ' is-approved' : '');
      card.dataset.provider = p.id;
      card.style.setProperty('--pc', p.color);

      const head = document.createElement('div'); head.className = 'pay-prov-head';
      const dot = document.createElement('span'); dot.className = 'pay-prov-dot'; dot.setAttribute('aria-hidden', 'true');
      const meta = document.createElement('div'); meta.className = 'pay-prov-meta';
      const title = document.createElement('b'); title.textContent = p.name;
      const sub = document.createElement('small');
      sub.textContent = connected
        ? `${p.display(savedVal)} · Direct to your account`
        : approved
          ? 'Approved — connect your account below'
          : p.sub;
      meta.append(title, sub);

      const actWrap = document.createElement('div'); actWrap.className = 'pay-prov-acts';
      if (connected && !editing) {
        const tUrl = p.testUrl(savedVal);
        if (tUrl) {
          const testLink = document.createElement('a');
          testLink.href = tUrl; testLink.target = '_blank'; testLink.rel = 'noopener noreferrer';
          testLink.className = 'btn sm ghost pay-prov-test';
          testLink.textContent = 'Test ↗';
          testLink.title = `Open your ${p.name} payment link in a new tab`;
          actWrap.append(testLink);
        }
        const editBtn = document.createElement('button');
        editBtn.type = 'button'; editBtn.className = 'btn sm ghost'; editBtn.textContent = 'Edit';
        editBtn.disabled = !host;
        editBtn.onclick = () => { payEditOpen.add(p.id); payFieldErr[p.id] = ''; payDraft[p.id] = savedVal; renderDirectPayouts(true); };
        actWrap.append(editBtn);
      }
      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.className = 'btn sm ' + (approved ? 'pay-approve-on' : 'ghost');
      approveBtn.setAttribute('aria-pressed', String(approved));
      approveBtn.textContent = approved ? 'Approved ✓' : 'Approve';
      approveBtn.disabled = !host;
      approveBtn.onclick = () => {
        const nextOn = !approved;
        payFieldErr[p.id] = '';
        if (nextOn && !savedVal) { payEditOpen.add(p.id); payDraft[p.id] = ''; }
        else if (!nextOn) { payEditOpen.delete(p.id); delete payDraft[p.id]; }
        setWatch({ payOn: { [p.id]: nextOn } });
        renderDirectPayouts(true);
        if (nextOn && savedVal) toast(`${p.name} approved — Super Chats, tips & bounties route directly to your ${p.name} account.`);
        else if (!nextOn) toast(`${p.name} paused for viewer payouts.`);
      };
      actWrap.append(approveBtn);
      head.append(dot, meta, actWrap);
      card.append(head);

      if (editing) {
        const body = document.createElement('div'); body.className = 'pay-prov-form';
        const row = document.createElement('div'); row.className = 'pay-prov-row';
        const inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'input sm grow'; inp.spellcheck = false;
        inp.placeholder = p.placeholder; inp.value = p.id in payDraft ? payDraft[p.id] : savedVal;
        inp.setAttribute('aria-label', `${p.name} account or payment link`);
        inp.addEventListener('input', () => { payDraft[p.id] = inp.value; });
        const disconnect = () => {
          payFieldErr[p.id] = '';
          delete payDraft[p.id];
          payEditOpen.delete(p.id);
          setWatch({ pay: { [p.id]: '' }, payOn: { [p.id]: false } });
          syncTipStore(p.id, '');
          renderDirectPayouts(true);
          toast(`${p.name} disconnected.`);
        };
        const save = () => {
          const raw = inp.value.trim();
          if (!raw) return disconnect();
          const cleanVal = p.normalize(raw);
          if (!cleanVal) {
            payDraft[p.id] = raw;
            payFieldErr[p.id] = p.err;
            renderDirectPayouts(true);
            return;
          }
          payFieldErr[p.id] = '';
          delete payDraft[p.id];
          payEditOpen.delete(p.id);
          // Connecting your first payout account also auto-enables "Take Super Chats & tips" so it works in one flow
          const hasAnyBefore = activeDirectMethods(watchCfg()).length > 0 || CARD.ready;
          const nextPatch = { pay: { [p.id]: cleanVal }, payOn: { [p.id]: true } };
          if (!hasAnyBefore && !watchCfg().supers) nextPatch.supers = true;
          setWatch(nextPatch);
          syncTipStore(p.id, p.id === 'stripe' ? cleanVal : p.display(cleanVal));
          renderDirectPayouts(true);
          toast(`${p.name} connected! Payments go straight to ${p.display(cleanVal)}.`);
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        const connectBtn = document.createElement('button');
        connectBtn.type = 'button'; connectBtn.className = 'btn sm primary';
        connectBtn.textContent = savedVal ? 'Save' : 'Connect';
        connectBtn.disabled = !host;
        connectBtn.onclick = save;
        row.append(inp, connectBtn);
        body.append(row);

        const foot = document.createElement('div'); foot.className = 'pay-prov-foot';
        const note = document.createElement('small');
        note.textContent = p.id === 'stripe'
          ? 'Viewers pay by Card, Apple Pay or Google Pay directly to your Stripe.'
          : `Payments go 100% directly to your ${p.name} account.`;
        const footActs = document.createElement('div'); footActs.className = 'pay-prov-foot-acts';
        if (savedVal) {
          const discBtn = document.createElement('button');
          discBtn.type = 'button'; discBtn.className = 'pay-prov-disc';
          discBtn.textContent = 'Disconnect';
          discBtn.disabled = !host;
          discBtn.onclick = disconnect;
          footActs.append(discBtn);
        }
        const help = document.createElement('a');
        help.href = p.helpUrl; help.target = '_blank'; help.rel = 'noopener noreferrer';
        help.className = 'pay-prov-help'; help.textContent = p.helpLabel;
        footActs.append(help);
        foot.append(note, footActs);
        body.append(foot);

        if (payFieldErr[p.id]) {
          const errEl = document.createElement('p');
          errEl.className = 'pay-prov-err'; errEl.textContent = payFieldErr[p.id];
          body.append(errEl);
        }
        card.append(body);
      }
      return card;
    }));
  }

  // The Show panel's watch page section.
  function setWatch(patch) {
    const cur = watchCfg();
    const cfg = {
      ...cur,
      ...patch,
      pay: { ...cur.pay, ...(patch.pay || {}) },
      payOn: { ...cur.payOn, ...(patch.payOn || {}) },
    };
    store.set('watchPrefs', cfg); // keep the handles for the next show
    if (isHost() && S.studio) setStage({ watch: cfg });
    if ('pay' in patch || 'payOn' in patch || 'supers' in patch || 'bounties' in patch || 'min' in patch) {
      queueCloudPaySave(cfg);
    }
    renderWatchSec();
  }
  function renderWatchSec() {
    if (!window.__watchReady || !$('#watchSec')) return; // renderAll can run before this part of the module loads
    const cfg = watchCfg(), on = !!S.studio;
    $('#wpUrl').textContent = on ? watchLinkText() : 'Enter your studio to get its watch link';
    for (const id of ['#wpCopy', '#wpCard', '#wpOpen']) $(id).disabled = !on;
    $('#wpCount').textContent = on && cfg.direct ? `${VIEW.size} of ${cfg.cap} watching directly` : '';
    for (const [id, k] of [['#wpChat', 'chat'], ['#wpSupers', 'supers'], ['#wpBounties', 'bounties'], ['#wpDirect', 'direct'], ['#wpVoice', 'voice'], ['#wpBadge', 'badge']]) if ($(id) && document.activeElement !== $(id)) $(id).checked = cfg[k] !== false && !!(cfg[k] ?? true);
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
    renderDirectPayouts();
    if (S.studio && isHost() && (!CARD.checked || CARD.studio !== S.studio)) cardStatus();
    syncPayStatusCopy();
    if (document.activeElement !== $('#wpQueue')) $('#wpQueue').checked = !!cfg.queue;
    if (window.__shopReady) { renderShop(); renderPoll(); renderEmotes(); }
    renderShowcaseSec();
    renderHandle();
  }
  // ---- optional on-site card payments (Stripe Connect Express): host connects their own Stripe Express account
  const CARD = { checked: false, loading: false, studio: '', available: false, hasSecret: false, hasPublishable: false, keyError: '', connected: false, ready: false, detailsSubmitted: false, payoutsEnabled: false };
  function stripeConfigHint() {
    if (CARD.keyError) return CARD.keyError;
    if (CARD.hasSecret && !CARD.hasPublishable) return 'STRIPE_SECRET_KEY is set, but STRIPE_PUBLISHABLE_KEY is missing.';
    if (!CARD.hasSecret && CARD.hasPublishable) return 'STRIPE_PUBLISHABLE_KEY is set, but STRIPE_SECRET_KEY is missing.';
    return 'Optional: not enabled on this server. You can still take Stripe, PayPal, Venmo, Cash App & more directly above.';
  }
  function syncPayStatusCopy() {
    const cfg = watchCfg();
    const direct = activeDirectMethods(cfg);
    const totalMethods = direct.length + (CARD.ready ? 1 : 0);
    const hasAny = totalMethods > 0;
    const bountiesOn = cfg.bounties !== false;
    renderPaySteps();
    const chBox = $('#wpPayChannels');
    if (chBox) {
      const stageTips = (S.state.elements || []).filter((e) => e.type === 'tip' && !e.hidden).length;
      const rows = [
        ['Super Chats', cfg.supers && hasAny ? 'Live · Direct' : hasAny ? 'Off' : 'Connect account', !!(cfg.supers && hasAny)],
        ['Tips & QR', hasAny || stageTips > 0 ? `${Math.max(totalMethods, stageTips)} ready` : 'Connect account', hasAny || stageTips > 0],
        ['Bounties', cfg.supers && hasAny && bountiesOn ? 'Live · Direct' : !bountiesOn ? 'Paused' : hasAny ? 'Off' : 'Connect account', !!(cfg.supers && hasAny && bountiesOn)],
      ];
      replaceKids(chBox, ...rows.map(([label, val, live]) => {
        const d = document.createElement('div');
        d.className = 'pay-ch' + (live ? ' is-live' : '');
        const b = document.createElement('b'); b.textContent = label;
        const s = document.createElement('small'); s.className = 'num'; s.textContent = val;
        d.append(b, s);
        return d;
      }));
    }
    const stateEl = $('#wpSupersState');
    const statusEl = $('#wpPayStatus');
    if (stateEl) {
      stateEl.textContent = cfg.supers && hasAny
        ? `Live · ${totalMethods} ${totalMethods === 1 ? 'account' : 'accounts'}`
        : hasAny
          ? 'Ready (off)'
          : 'Connect account';
    }
    if (statusEl) {
      if (cfg.supers && hasAny) {
        const names = [...(CARD.ready ? ['Stripe Express'] : []), ...direct.map((p) => p.name)];
        const streams = bountiesOn ? 'Super Chats, tips & bounties' : 'Super Chats & tips';
        statusEl.textContent = `Live: ${streams} route directly to your ${names.join(', ')} account${names.length === 1 ? '' : 's'}.`;
      } else if (hasAny) {
        statusEl.textContent = 'Your payout account is connected. Turn on “Take Super Chats & tips” to show the green $ button in chat.';
      } else if (cfg.supers) {
        statusEl.textContent = 'Super Chats are switched on — approve and connect at least one payout account above so viewers see the green $ button.';
      } else {
        statusEl.textContent = 'Approve and connect Stripe, PayPal, Venmo, Cash App or another account above so viewer payments go straight to you.';
      }
    }
    const expSub = $('#wpExpressSub');
    if (expSub) {
      expSub.textContent = CARD.ready
        ? 'Connected · Card, Apple Pay & Google Pay auto-confirm in chat'
        : CARD.available
          ? 'Available · Connect Stripe Express for automatic in-chat confirmation'
          : 'Optional server upgrade · Direct Stripe Payment Links work above right now';
    }
  }
  async function cardStatus(force = false) {
    if (!S.studio || !isHost()) return;
    if (CARD.loading && !force) return;
    if (CARD.studio !== S.studio) {
      Object.assign(CARD, { checked: false, studio: S.studio, available: false, hasSecret: false, hasPublishable: false, keyError: '', connected: false, ready: false, detailsSubmitted: false, payoutsEnabled: false });
    }
    const wasReady = CARD.ready;
    CARD.loading = true;
    const refBtn = $('#wpCardRefresh');
    if (refBtn) { refBtn.disabled = true; refBtn.textContent = 'Checking…'; }
    syncPayStatusCopy();
    try {
      const res = await api('payCard', { ...creds(), op: 'status' });
      Object.assign(CARD, {
        checked: true,
        studio: S.studio,
        available: !!res.available,
        hasSecret: !!res.hasSecret,
        hasPublishable: !!res.hasPublishable,
        keyError: res.keyError || '',
        connected: !!res.connected,
        ready: !!res.ready,
        detailsSubmitted: !!res.detailsSubmitted,
        payoutsEnabled: !!res.payoutsEnabled,
      });
      if (!wasReady && CARD.ready) {
        toast('Stripe Express connected! Card, Apple Pay & Google Pay super chats are live.');
      }
    } catch {
      CARD.checked = false;
    } finally {
      CARD.loading = false;
      if (refBtn) { refBtn.disabled = false; refBtn.textContent = 'Refresh'; }
      renderCard();
      syncPayStatusCopy();
    }
  }
  /** Get paid, step by step: approve & connect your own account, then turn on super chats. */
  function renderPaySteps() {
    const ol = $('#wpPaySteps'); if (!ol) return;
    const cfg = watchCfg();
    const direct = activeDirectMethods(cfg);
    const hasPayout = direct.length > 0 || CARD.ready;
    const liveReady = hasPayout && !!cfg.supers;
    const names = [...(CARD.ready ? ['Stripe Express'] : []), ...direct.map((p) => p.name)];
    const steps = [
      [
        hasPayout,
        'Approve & connect your payout account',
        hasPayout
          ? `Connected: ${names.join(', ')} — 100% goes straight to you`
          : 'Click Approve on Stripe, PayPal, Venmo, Cash App or another provider below and connect your account',
      ],
      [
        liveReady,
        'Super chats live in chat',
        liveReady
          ? 'Live — viewers see the green $ button and pay directly into your account'
          : cfg.supers
            ? 'Toggle is on — connect at least one payout account above to go live'
            : 'Turn on “Take super chats” below',
      ],
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
    const exp = $('#wpExpressDetails');
    if (exp && (CARD.available || CARD.ready)) exp.open = true;
    const go = $('#wpCardGo'), st = $('#wpCardState'), refBtn = $('#wpCardRefresh');
    box.classList.toggle('on', CARD.ready);
    if (refBtn) refBtn.hidden = !S.studio || !isHost();
    if (!CARD.available) {
      go.disabled = true;
      go.className = 'btn sm ghost';
      go.textContent = CARD.keyError ? 'Key mismatch' : 'Optional';
      st.textContent = stripeConfigHint();
      return;
    }
    go.disabled = false;
    if (CARD.ready) {
      go.textContent = 'Disconnect'; go.className = 'btn sm ghost';
      st.textContent = 'Connected: viewers can pay by Card, Apple Pay or Google Pay right inside chat, straight into your Stripe Express account.';
    } else if (CARD.detailsSubmitted) {
      go.textContent = 'Check Stripe details'; go.className = 'btn sm primary';
      st.textContent = 'Your Stripe onboarding is submitted. Click Refresh once Stripe finishes verifying your account.';
    } else if (CARD.connected) {
      go.textContent = 'Finish Stripe setup'; go.className = 'btn sm primary';
      st.textContent = 'Almost there: finish your Stripe details, then return here and your status will update automatically.';
    } else {
      go.textContent = 'Connect Stripe Express'; go.className = 'btn sm primary';
      st.textContent = 'Connect your own Stripe Express account for automatic in-chat Card, Apple Pay & Google Pay super chats (0% platform cut).';
    }
  }
  $('#wpCardRefresh')?.addEventListener('click', () => cardStatus(true));
  $('#wpCardGo')?.addEventListener('click', async () => {
    if (CARD.ready) {
      if (!confirm('Stop taking cards on your watch page?')) return;
      await api('payCard', { ...creds(), op: 'disconnect' }).catch(() => {});
      Object.assign(CARD, { connected: false, ready: false, detailsSubmitted: false, payoutsEnabled: false });
      renderCard(); syncPayStatusCopy();
      return;
    }
    const go = $('#wpCardGo');
    if (go) { go.disabled = true; go.textContent = 'Opening Stripe…'; }
    const tab = window.open('', '_blank');
    try {
      const { url } = await api('payCard', { ...creds(), op: 'connect', origin: location.origin });
      if (tab && !tab.closed) tab.location = url;
      else location.assign(url);
      CARD.connected = true;
      renderCard(); syncPayStatusCopy();
    } catch (e) {
      try { tab?.close(); } catch {}
      toast(e.message, { err: true });
      renderCard(); syncPayStatusCopy();
    }
  });
  const onStripeDoneSignal = (data) => {
    if (!data || data.type !== 'gather:stripe-done') return;
    if (!S.studio || !isHost()) return;
    if (data.studio && data.studio !== S.studio) return;
    if (data.retry) toast('That Stripe link expired. Click “Finish Stripe setup” to get a new link.', { err: true });
    cardStatus(true);
  };
  window.addEventListener('message', (e) => { if (e.origin === location.origin) onStripeDoneSignal(e.data); });
  window.addEventListener('storage', (e) => {
    if (e.key !== 'gather:stripe-done' || !e.newValue) return;
    try { onStripeDoneSignal(JSON.parse(e.newValue)); } catch {}
  });
  try {
    const stripeBc = new BroadcastChannel('gather-stripe');
    stripeBc.onmessage = (e) => onStripeDoneSignal(e.data);
  } catch {}
  window.addEventListener('focus', () => { if (S.studio && isHost() && (!CARD.available || (CARD.connected && !CARD.ready))) cardStatus(true); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.studio && isHost() && CARD.connected && !CARD.ready) cardStatus(true); });

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
  function applyStreamTypeChange(nextType) {
    if (!isHost()) return;
    const prevType = S.state.streamType || 'live';
    store.set('streamType', nextType);
    const patch = { streamType: nextType };
    const els = Array.isArray(S.state.elements) ? S.state.elements : [];
    let hiddenCount = 0;

    if (nextType === 'live') {
      // Hide gaming stage layers (scoreboard, bounty board)
      if (els.some((el) => (el.type === 'score' || el.type === 'bounty') && !el.hidden)) {
        patch.elements = els.map((el) => {
          if ((el.type === 'score' || el.type === 'bounty') && !el.hidden) {
            hiddenCount++;
            return { ...el, hidden: true, _autoHiddenForLive: true };
          }
          return el;
        });
      }
      // Turn off Live Game HUD overlay
      if (window.__gatherGamerHud?.on) {
        window.__gatherGamerHud.on = false;
        window.__syncGamerHud?.();
        hiddenCount++;
      }
      // Clear active shopping overlays (pinned product, flash sale, purchase alert)
      if (S.state.shop?.pinned || S.state.shop?.sale) {
        patch.shop = { ...(S.state.shop || { items: [] }), pinned: '', sale: null };
        hiddenCount++;
      }
      if (S.state.purchaseAlert) {
        patch.purchaseAlert = null;
        hiddenCount++;
      }
      // Hide stage overlay artwork when switching from Gaming or Shopping (e.g. Esports HUD / Live Drop frame)
      const curBrand = S.state.brand || {};
      const shouldHideOverlay = (prevType === 'gamer' || prevType === 'shopping')
        || curBrand.overlayTpl === 'esports-hud'
        || curBrand.overlayTpl === 'live-shop';
      if (shouldHideOverlay && curBrand.overlay && !curBrand.overlayHidden) {
        patch.brand = { ...curBrand, overlayHidden: true };
        if ($('#ovVisibleChk')) $('#ovVisibleChk').checked = false;
        hiddenCount++;
      }
    } else if (nextType === 'gamer') {
      // Hide shopping overlays when switching to gaming
      if (S.state.shop?.pinned || S.state.shop?.sale) {
        patch.shop = { ...(S.state.shop || { items: [] }), pinned: '', sale: null };
      }
      if (S.state.purchaseAlert) patch.purchaseAlert = null;
      // Restore auto-hidden gaming elements if switching back from live
      if (els.some((el) => (el.type === 'score' || el.type === 'bounty') && el._autoHiddenForLive)) {
        patch.elements = els.map((el) => (el._autoHiddenForLive ? { ...el, hidden: false, _autoHiddenForLive: false } : el));
      }
    } else if (nextType === 'shopping') {
      // Hide gaming overlays when switching to shopping
      if (els.some((el) => (el.type === 'score' || el.type === 'bounty') && !el.hidden)) {
        patch.elements = els.map((el) => ((el.type === 'score' || el.type === 'bounty') && !el.hidden ? { ...el, hidden: true, _autoHiddenForLive: true } : el));
      }
      if (window.__gatherGamerHud?.on) {
        window.__gatherGamerHud.on = false;
        window.__syncGamerHud?.();
      }
    }

    setStage(patch);
    if (nextType === 'live' && (prevType === 'gamer' || prevType === 'shopping' || hiddenCount > 0)) {
      toast('Switched to Live Stream — gaming & shopping overlays hidden.');
    }
  }
  $('#wpStreamType')?.addEventListener('change', (e) => applyStreamTypeChange(e.target.value));
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
  for (const [id, k] of [['#wpChat', 'chat'], ['#wpSupers', 'supers'], ['#wpBounties', 'bounties'], ['#wpDirect', 'direct'], ['#wpVoice', 'voice'], ['#wpBadge', 'badge']]) if ($(id)) $(id).onchange = (e) => setWatch({ [k]: e.target.checked });
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
  let pollDraftChoices = ['', ''];
  S.pollCounts = [];
  const POLL_LETTERS = ['A', 'B', 'C', 'D'];
  const POLL_TEMPLATES = {
    yesno: { kind: 'poll', q: 'Should we do this next?', opts: ['Yes, let’s go!', 'No, skip it'] },
    rate: { kind: 'poll', q: 'Rate what you just saw (1–4)', opts: ['4 — Amazing', '3 — Solid', '2 — Okay', '1 — Needs work'] },
    next: { kind: 'poll', q: 'What should we cover next?', opts: ['Live Q&A', 'Behind the scenes', 'Audience hot takes'] },
    winner: { kind: 'predict', q: 'Who wins this round?', opts: ['Clutch victory', 'Tough defeat'] },
  };
  const getPollHistory = () => {
    const arr = store.get('pollHistory', []);
    return Array.isArray(arr) ? arr : [];
  };
  const savePollHistory = (list) => {
    store.set('pollHistory', list.slice(0, 8));
    renderPollHistory();
  };
  const recordPollHistory = (p, counts = []) => {
    if (!p?.q || !p?.opts?.length) return;
    const total = counts.reduce((a, b) => a + b, 0);
    let winIdx = p.answer >= 0 ? p.answer : -1;
    if (winIdx < 0 && total > 0) {
      let max = -1;
      counts.forEach((n, i) => { if (n > max) { max = n; winIdx = i; } });
    }
    const entry = {
      id: p.id,
      kind: p.kind || 'poll',
      q: p.q,
      opts: [...p.opts],
      total,
      winner: winIdx >= 0 ? p.opts[winIdx] : '',
      ts: Date.now(),
    };
    const next = [entry, ...getPollHistory().filter((x) => x.id !== p.id && x.q !== p.q)];
    savePollHistory(next);
  };

  function syncPollKindUI(kind) {
    pollKind = kind === 'predict' ? 'predict' : 'poll';
    $$('#pollKind button').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.kind === pollKind)));
    if ($('#pollKindHelp')) {
      $('#pollKindHelp').textContent = pollKind === 'predict'
        ? 'Viewers pick an outcome before time runs out — then you click the winning choice to settle it.'
        : 'Viewers vote live on your watch page and see results update in real time.';
    }
    if ($('#pollGo')) $('#pollGo').textContent = pollKind === 'predict' ? 'Launch prediction' : 'Launch poll';
    if ($('#pollQ')) $('#pollQ').placeholder = pollKind === 'predict' ? 'Who wins this match?' : 'Ask your audience something…';
  }
  function syncHiddenPollOpts() {
    if ($('#pollOpts')) $('#pollOpts').value = pollDraftChoices.filter((s) => s.trim()).join('\n');
  }
  function renderPollChoices(focusIdx = -1) {
    const wrap = $('#pollChoices'); if (!wrap) return;
    if (pollDraftChoices.length < 2) pollDraftChoices = ['', ''];
    replaceKids(wrap, ...pollDraftChoices.map((val, i) => {
      const row = document.createElement('div'); row.className = 'poll-choice-row';
      const badge = document.createElement('span'); badge.className = 'poll-choice-key'; badge.textContent = POLL_LETTERS[i] || String(i + 1);
      const inp = document.createElement('input');
      inp.className = 'input sm';
      inp.maxLength = 48;
      inp.placeholder = i === 0 ? 'Option A' : i === 1 ? 'Option B' : `Option ${POLL_LETTERS[i]}`;
      inp.value = val;
      inp.setAttribute('aria-label', `Choice ${POLL_LETTERS[i]}`);
      inp.oninput = () => { pollDraftChoices[i] = inp.value; syncHiddenPollOpts(); };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (i < pollDraftChoices.length - 1) wrap.querySelectorAll('input')[i + 1]?.focus();
          else if (pollDraftChoices.length < 4) { pollDraftChoices.push(''); renderPollChoices(pollDraftChoices.length - 1); }
          else $('#pollGo')?.click();
        }
      };
      row.append(badge, inp);
      if (pollDraftChoices.length > 2) {
        const rm = document.createElement('button');
        rm.type = 'button'; rm.className = 'icon-btn sm poll-choice-rm';
        rm.setAttribute('aria-label', `Remove choice ${POLL_LETTERS[i]}`);
        rm.textContent = '×';
        rm.onclick = () => { pollDraftChoices.splice(i, 1); syncHiddenPollOpts(); renderPollChoices(Math.max(0, i - 1)); };
        row.append(rm);
      }
      return row;
    }));
    if ($('#pollAddChoice')) $('#pollAddChoice').hidden = pollDraftChoices.length >= 4;
    if (focusIdx >= 0) wrap.querySelectorAll('input')[focusIdx]?.focus();
  }
  function updatePollQCount() {
    if ($('#pollQCount') && $('#pollQ')) $('#pollQCount').textContent = `${$('#pollQ').value.length} / 120`;
  }
  function launchPoll({ kind = pollKind, q, opts, mins = Number($('#pollMins')?.value || 2), hiddenOnStage = !($('#pollShowStage')?.checked ?? true) }) {
    if (!isHost()) return toast('Only the host can launch polls.', { err: true });
    const cleanQ = String(q || '').trim().slice(0, 120);
    const cleanOpts = (opts || []).map((x) => String(x || '').trim().slice(0, 48)).filter(Boolean).slice(0, 4);
    if (!cleanQ || cleanOpts.length < 2) return toast('Add a question and at least two choices.', { err: true });
    if (S.state.poll) recordPollHistory(S.state.poll, S.pollCounts);
    const durMs = Math.max(15e3, Math.round((Number(mins) || 2) * 60e3));
    const nextPoll = { id: uid().slice(0, 8), kind: kind === 'predict' ? 'predict' : 'poll', q: cleanQ, opts: cleanOpts, until: Date.now() + durMs, answer: -1, hiddenOnStage: !!hiddenOnStage };
    setStage({ poll: nextPoll });
    S.pollCounts = cleanOpts.map(() => 0);
    renderPoll();
    toast(nextPoll.kind === 'predict' ? 'Prediction is live on your watch page!' : 'Poll is live on your watch page!');
  }

  $$('#pollKind button').forEach((b) => b.addEventListener('click', () => syncPollKindUI(b.dataset.kind)));
  $('#pollQ')?.addEventListener('input', updatePollQCount);
  $('#pollAddChoice')?.addEventListener('click', () => {
    if (pollDraftChoices.length >= 4) return;
    pollDraftChoices.push('');
    syncHiddenPollOpts();
    renderPollChoices(pollDraftChoices.length - 1);
  });
  $('#pollOpts')?.addEventListener('input', () => {
    const lines = $('#pollOpts').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4);
    if (lines.length >= 2) { pollDraftChoices = lines; renderPollChoices(); }
  });
  $('#pollPresets')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ptpl]'); if (!btn) return;
    const tpl = POLL_TEMPLATES[btn.dataset.ptpl]; if (!tpl) return;
    syncPollKindUI(tpl.kind);
    if ($('#pollQ')) { $('#pollQ').value = tpl.q; updatePollQCount(); }
    pollDraftChoices = [...tpl.opts];
    syncHiddenPollOpts();
    renderPollChoices();
    $('#pollQ')?.focus();
  });
  $('#pollGo').onclick = () => {
    const q = $('#pollQ')?.value.trim() || '';
    const opts = pollDraftChoices.map((x) => x.trim()).filter(Boolean).slice(0, 4);
    launchPoll({ kind: pollKind, q, opts, mins: Number($('#pollMins')?.value || 2), hiddenOnStage: !($('#pollShowStage')?.checked ?? true) });
  };
  $('#pollEnd').onclick = () => {
    if (!S.state.poll) return;
    setStage({ poll: { ...S.state.poll, until: Math.min(S.state.poll.until, Date.now()) } });
    renderPoll();
  };
  $('#pollHistoryClear')?.addEventListener('click', () => savePollHistory([]));

  function renderPollHistory() {
    const sec = $('#pollHistorySec'), ul = $('#pollHistoryList'), cnt = $('#pollHistoryCount');
    if (!sec || !ul) return;
    const list = getPollHistory();
    sec.hidden = !list.length;
    if (cnt) cnt.textContent = list.length ? `${list.length} saved` : '';
    replaceKids(ul, ...list.map((item) => {
      const li = document.createElement('li'); li.className = 'poll-hist-item';
      const info = document.createElement('div'); info.className = 'poll-hist-info';
      const meta = document.createElement('span'); meta.className = 'poll-hist-meta';
      meta.textContent = `${item.kind === 'predict' ? 'Prediction' : 'Poll'} · ${item.total || 0} vote${item.total === 1 ? '' : 's'}${item.winner ? ` · ${item.winner}` : ''}`;
      const qEl = document.createElement('b'); qEl.textContent = item.q;
      info.append(qEl, meta);
      const acts = document.createElement('div'); acts.className = 'poll-hist-acts';
      const loadBtn = document.createElement('button'); loadBtn.type = 'button'; loadBtn.className = 'btn sm ghost'; loadBtn.textContent = 'Edit';
      loadBtn.onclick = () => {
        syncPollKindUI(item.kind);
        if ($('#pollQ')) { $('#pollQ').value = item.q; updatePollQCount(); }
        pollDraftChoices = [...item.opts];
        syncHiddenPollOpts();
        renderPollChoices();
        $('#pollQ')?.focus();
      };
      const runBtn = document.createElement('button'); runBtn.type = 'button'; runBtn.className = 'btn sm'; runBtn.textContent = 'Re-run';
      runBtn.onclick = () => launchPoll({ kind: item.kind, q: item.q, opts: item.opts });
      acts.append(loadBtn, runBtn);
      li.append(info, acts);
      return li;
    }));
  }

  function renderPoll() {
    const p = S.state.poll, box = $('#pollLive'), sec = $('#pollLiveSec'); if (!box) return;
    if (!p) {
      replaceKids(box);
      if (sec) sec.hidden = true;
      if ($('#pollState')) $('#pollState').textContent = '';
      if ($('#pollEnd')) $('#pollEnd').hidden = true;
      return;
    }
    const open = p.until > Date.now(), total = S.pollCounts.reduce((a, b) => a + b, 0);
    const settled = p.kind === 'predict' && p.answer >= 0;
    const needSettle = p.kind === 'predict' && !open && p.answer < 0;
    const statusTxt = open
      ? `Live · ${fmtTime(p.until - Date.now())} · ${total} vote${total === 1 ? '' : 's'}`
      : settled
        ? `Settled · ${total} vote${total === 1 ? '' : 's'}`
        : `Closed · ${total} vote${total === 1 ? '' : 's'}`;
    if ($('#pollState')) $('#pollState').textContent = statusTxt;
    if ($('#pollLiveSummary')) $('#pollLiveSummary').textContent = statusTxt;
    if (sec) sec.hidden = false;
    if ($('#pollEnd')) $('#pollEnd').hidden = !open;

    const head = document.createElement('div'); head.className = 'poll-live-head';
    const tag = document.createElement('span'); tag.className = 'poll-live-tag' + (open ? ' is-live' : settled ? ' is-settled' : '');
    tag.textContent = (p.kind === 'predict' ? 'Prediction' : 'Poll') + (open ? ' · Voting open' : settled ? ' · Settled' : ' · Closed');
    const qEl = document.createElement('p'); qEl.className = 'poll-live-q'; qEl.textContent = p.q;
    head.append(tag, qEl);

    const kids = [head];
    if (needSettle) {
      const prompt = document.createElement('p'); prompt.className = 'poll-settle-note';
      prompt.textContent = 'Voting closed. Click the winning outcome below to settle this prediction:';
      kids.push(prompt);
    }

    const barsWrap = document.createElement('div'); barsWrap.className = 'poll-bars';
    p.opts.forEach((o, i) => {
      const n = S.pollCounts[i] || 0, pct = total ? Math.round((n / total) * 100) : 0;
      const isWinner = p.answer === i;
      const d = document.createElement(needSettle ? 'button' : 'div');
      if (needSettle) d.type = 'button';
      d.className = 'poll-bar' + (isWinner ? ' is-winner' : '') + (needSettle ? ' is-pickable' : '');
      const bar = document.createElement('i'); bar.style.width = pct + '%';
      const l = document.createElement('span'); l.className = 'poll-bar-lbl';
      const key = document.createElement('em'); key.className = 'poll-bar-key'; key.textContent = isWinner ? '✓' : (POLL_LETTERS[i] || String(i + 1));
      const txt = document.createElement('span'); txt.textContent = o;
      l.append(key, txt);
      const r = document.createElement('b'); r.className = 'num'; r.textContent = `${pct}% · ${n}`;
      d.append(bar, l, r);
      if (needSettle) {
        d.title = 'Settle the prediction with this answer';
        d.onclick = () => {
          const updated = { ...p, answer: i };
          setStage({ poll: updated });
          recordPollHistory(updated, S.pollCounts);
          toast(`Prediction settled: “${o}” wins!`);
        };
      }
      barsWrap.append(d);
    });
    kids.push(barsWrap);

    const acts = document.createElement('div'); acts.className = 'poll-live-acts';
    if (open) {
      const endBtn = document.createElement('button'); endBtn.type = 'button'; endBtn.className = 'btn sm';
      endBtn.textContent = 'Close voting';
      endBtn.onclick = () => { setStage({ poll: { ...p, until: Date.now() } }); renderPoll(); };
      acts.append(endBtn);
    } else if (!settled) {
      const reopenBtn = document.createElement('button'); reopenBtn.type = 'button'; reopenBtn.className = 'btn sm';
      reopenBtn.textContent = '+1 min';
      reopenBtn.onclick = () => { setStage({ poll: { ...p, until: Date.now() + 60e3 } }); renderPoll(); };
      acts.append(reopenBtn);
    }
    const stageBtn = document.createElement('button'); stageBtn.type = 'button'; stageBtn.className = 'btn sm ghost';
    stageBtn.textContent = p.hiddenOnStage ? 'Show on video' : 'Hide on video';
    stageBtn.onclick = () => { setStage({ poll: { ...p, hiddenOnStage: !p.hiddenOnStage } }); renderPoll(); };
    const clearBtn = document.createElement('button'); clearBtn.type = 'button'; clearBtn.className = 'btn sm ghost';
    clearBtn.textContent = 'Remove';
    clearBtn.onclick = () => { recordPollHistory(p, S.pollCounts); setStage({ poll: null }); renderPoll(); };
    acts.append(stageBtn, clearBtn);
    kids.push(acts);

    replaceKids(box, ...kids);
  }
  syncPollKindUI('poll');
  renderPollChoices();
  updatePollQCount();
  renderPollHistory();

  /** Live 1s countdown & 2s vote sync while a poll exists. */
  let pollTick = 0;
  setInterval(async () => {
    if (!S.state.poll) return;
    pollTick++;
    if (isHost() && S.studio && pollTick % 2 === 0) {
      try { const f = await (await fetch(`/api/studio?action=wfeed&studio=${encodeURIComponent(S.studio)}`)).json(); if (f.poll?.id === S.state.poll.id) S.pollCounts = f.poll.counts; } catch {}
    }
    renderPoll();
  }, 1000);
  function drawPoll() {
    const p = S.state.poll; if (!p || p.hiddenOnStage) return;
    const open = p.until > Date.now(), total = (S.pollCounts || []).reduce((a, b) => a + b, 0);
    const w = 368, rowH = 34, h = 72 + p.opts.length * (rowH + 8), x = app.W - w - 28, y = 28;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 22; g.shadowOffsetY = 8;
    g.fillStyle = 'rgba(10,14,26,.88)'; rr(x, y, w, h, 16); g.fill();
    g.shadowColor = 'transparent';
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; rr(x + 0.5, y + 0.5, w - 1, h - 1, 16); g.stroke();
    g.fillStyle = '#9ca3af'; g.font = '800 11.5px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const meta = (p.kind === 'predict' ? 'PREDICTION' : 'POLL') + (open ? ` · ${fmtTime(p.until - Date.now())} · vote on watch page` : p.answer >= 0 ? ` · SETTLED · ${total} votes` : ` · CLOSED · ${total} votes`);
    g.fillText(meta, x + 18, y + 26);
    g.fillStyle = '#fff'; g.font = '700 17.5px Inter, sans-serif'; g.fillText(wrapLines(p.q, w - 36, 1)[0] || p.q, x + 18, y + 52);
    p.opts.forEach((o, i) => {
      const n = (S.pollCounts || [])[i] || 0, pct = total ? n / total : 0, ry = y + 66 + i * (rowH + 8);
      g.fillStyle = 'rgba(255,255,255,.08)'; rr(x + 18, ry, w - 36, rowH, 8); g.fill();
      g.fillStyle = p.answer === i ? '#16a34a' : S.state.brand.color; if (pct) { rr(x + 18, ry, Math.max(12, (w - 36) * pct), rowH, 8); g.fill(); }
      g.fillStyle = '#fff'; g.font = '600 14.5px Inter, sans-serif';
      g.fillText((p.answer === i ? '✓ ' : `${POLL_LETTERS[i] || i + 1}. `) + o, x + 30, ry + 22);
      g.textAlign = 'right'; g.font = '700 14px Inter, sans-serif';
      g.fillText(total ? Math.round(pct * 100) + '%' : '', x + w - 28, ry + 22);
      g.textAlign = 'left';
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


  return { watchSlug, watchLinkUrl, watchLinkText, viewerWant, viewerSignal, closeViewer, closeAllViewers, money, gotSuperchat, superAct, renderBountyPanel, drawBountyEl, refreshSupers, reactFloat, setWatch, renderWatchSec, shopCfg, setShop, drawProduct, drawPoll, gotQueue, renderQueue, gotVoice, dropVoice, refreshVoice, drawWatchBadge };
}
