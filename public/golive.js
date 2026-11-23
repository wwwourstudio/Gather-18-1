import { replaceKids } from './ui.js';
import { googleConfigured, googleSignedIn, saveToDrive } from './google.js';

// Recording and going live: the program (stage canvas + mix) goes to the relay and on to every platform,
// or into a local recording that can be saved to Google Drive.
// Created by app.js through createGoLive(app): `app` carries the studio state and helpers this part uses.
export function createGoLive(app) {
  const {
    $, $$, store, S, isHost, toast, fmtTime, copy, audioCtx, api, creds, wsSend, setStage, canvas,
    renderGoogle, renderDock, setTab
  } = app;
  // ---------------------------------------------------------------- recording
  // ---------------------------------------------------------------- go live: program → relay → YouTube, Twitch, …
  // The finished program (the same canvas and mix as a recording) goes over a WebSocket to the gather relay, which
  // hands it to FFmpeg and on to every destination at once. H.264 from the browser is passed through untouched.
  const PLATFORMS = {
    youtube: { name: 'YouTube', dot: '#ff2a3d', url: 'rtmp://a.rtmp.youtube.com/live2', hint: 'YouTube Studio → Go live → Stream key' },
    twitch: { name: 'Twitch', dot: '#9b6bff', url: 'rtmp://live.twitch.tv/app', hint: 'Twitch → Creator Dashboard → Settings → Stream → Primary stream key' },
    kick: { name: 'Kick', dot: '#53fc18', url: '', hint: 'Kick → Settings → Stream URL and Stream key' },
    facebook: { name: 'Facebook', dot: '#1877f2', url: 'rtmps://live-api-s.facebook.com:443/rtmp', hint: 'Facebook → Live Producer → Streaming software → Stream key' },
    linkedin: { name: 'LinkedIn', dot: '#0a66c2', url: '', hint: 'LinkedIn Live → Go Live → RTMP URL & Stream key' },
    x: { name: 'X', dot: '#e7e9ea', url: '', hint: 'X Media Studio → Producer → RTMP URL and Stream key' },
    instagram: { name: 'Instagram', dot: '#e4405f', url: '', hint: 'Instagram Live Producer → Stream URL & Stream key' },
    tiktok: { name: 'TikTok', dot: '#fe2c55', url: '', hint: 'TikTok LIVE → Cast to PC → Stream URL & key' },
    rumble: { name: 'Rumble', dot: '#85c742', url: '', hint: 'Rumble → Go Live → Stream URL and Stream key' },
    custom: { name: 'Other', dot: '#8b9bb8', url: '', hint: 'Any RTMP or RTMPS server URL and key' },
  };
  S.relayOn = false;
  S.live = null;
  let L_STATUS = {}; // per destination (index in liveDests) while live: {state: 'live'|'failed', reason}
  const CONNECT_TIMEOUT = 60_000; // a free relay can take ~30–50 s to wake
  const liveDests = () => store.get('liveDests', []); // local only: never synced, never sent to gather's server
  function saveDests(list) {
    store.set('liveDests', list);
    renderLive();
    renderSocialMatrix($('#wizSocialMatrix'));
    renderSocialMatrix($('#invSocialMatrix'));
  }
  function renderSocialMatrix(box) {
    if (!box) return;
    const list = liveDests();
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox') return;
    const order = ['youtube', 'twitch', 'kick', 'facebook', 'linkedin', 'x', 'instagram', 'tiktok', 'rumble', 'custom'];
    replaceKids(box, ...order.map((kind) => {
      const p = PLATFORMS[kind];
      const existing = list.find((d) => d.kind === kind);
      const on = !!existing?.on;
      const item = document.createElement('div');
      item.className = 'soc-item' + (on ? ' on' : '');
      const top = document.createElement('label');
      top.className = 'soc-top';
      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = on; chk.setAttribute('aria-label', `Connect ${p.name}`);
      const dot = document.createElement('i'); dot.className = 'soc-dot'; dot.style.background = p.dot;
      const nm = document.createElement('span'); nm.className = 'soc-name'; nm.textContent = p.name;
      const badge = document.createElement('span'); badge.className = 'soc-badge'; badge.textContent = on ? (existing?.key ? 'Ready' : 'On') : 'Off';
      top.append(chk, dot, nm, badge);
      item.append(top);
      chk.onchange = () => {
        const next = [...liveDests()];
        const idx = next.findIndex((d) => d.kind === kind);
        if (idx >= 0) next[idx] = { ...next[idx], on: chk.checked };
        else if (chk.checked) next.push({ kind, url: p.url, key: '', on: true });
        saveDests(next);
      };
      if (on) {
        const flds = document.createElement('div'); flds.className = 'soc-fields';
        if (!p.url || kind === 'custom') {
          const uIn = document.createElement('input'); uIn.className = 'input sm'; uIn.placeholder = 'rtmps://…'; uIn.value = existing?.url || ''; uIn.setAttribute('aria-label', `${p.name} RTMP URL`);
          uIn.onchange = () => { const all = [...liveDests()]; const i = all.findIndex((d) => d.kind === kind); if (i >= 0) { all[i] = { ...all[i], url: uIn.value.trim() }; saveDests(all); } };
          flds.append(uIn);
        }
        const kIn = document.createElement('input'); kIn.type = 'password'; kIn.className = 'input sm'; kIn.autocomplete = 'off'; kIn.placeholder = `${p.name} stream key`; kIn.value = existing?.key || ''; kIn.setAttribute('aria-label', `${p.name} stream key`);
        kIn.onchange = () => { const all = [...liveDests()]; const i = all.findIndex((d) => d.kind === kind); if (i >= 0) { all[i] = { ...all[i], key: kIn.value.trim() }; saveDests(all); } };
        flds.append(kIn);
        item.append(flds);
      }
      return item;
    }));
  }
  function pickLiveMime() {
    const opts = [['video/webm;codecs=h264,opus', 'h264'], ['video/webm;codecs=avc1,opus', 'h264'], ['video/mp4;codecs=avc1,opus', 'h264'], ['video/webm;codecs=vp8,opus', 'vp8'], ['video/webm;codecs=vp9,opus', 'vp9']];
    const hit = opts.find(([m]) => window.MediaRecorder?.isTypeSupported?.(m));
    return hit ? { mimeType: hit[0], video: hit[1] } : null;
  }
  function renderDests(force) {
    const list = liveDests(), live = !!S.live, box = $('#destList');
    // Someone joining or leaving re-renders the studio; never rebuild the list under a host who is typing a key.
    if (!force && box.contains(document.activeElement) && box.children.length === list.length) {
      box.querySelectorAll('input, [data-del]').forEach((el) => { el.disabled = live; });
      return;
    }
    $$('.plat-tile[data-plat]').forEach((t) => t.classList.toggle('added', t.dataset.plat !== 'custom' && list.some((d) => d.kind === t.dataset.plat)));
    replaceKids(box, ...list.map((d, i) => {
      const p = PLATFORMS[d.kind] || PLATFORMS.custom;
      const li = document.createElement('li'); li.className = 'dest' + (d.on ? '' : ' off');
      li.innerHTML = `<div class="dest-top"><span class="pill caps src-${d.kind}"></span><label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="on"><span>Send</span></label><button type="button" class="icon-btn sm" data-del aria-label="Remove"><svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-trash-2"/></svg></button></div>
      <input data-k="url" spellcheck="false" aria-label="Server URL" placeholder="rtmps://…">
      <input data-k="key" type="password" autocomplete="off" spellcheck="false" aria-label="Stream key" placeholder="Stream key">
      <input data-k="watch" spellcheck="false" aria-label="Public watch link" placeholder="Watch link for viewers (optional)">
      <p class="hint"></p>`;
      li.querySelector('.pill').textContent = p.name;
      li.querySelector('.hint').textContent = p.hint;
      li.querySelector('[data-k="on"]').checked = !!d.on;
      li.querySelector('[data-k="url"]').value = d.url || '';
      li.querySelector('[data-k="key"]').value = d.key || '';
      li.querySelector('[data-k="watch"]').value = d.watch || '';
      const put = (inp) => { const all = liveDests(); all[i] = { ...all[i], [inp.dataset.k]: inp.type === 'checkbox' ? inp.checked : inp.value.trim() }; return all; };
      li.querySelectorAll('input').forEach((inp) => {
        inp.disabled = live;
        // Save every keystroke (so a re-render can't lose it), and refresh the Go live button on change.
        if (inp.type !== 'checkbox') inp.addEventListener('input', () => store.set('liveDests', put(inp)));
        inp.addEventListener('change', () => saveDests(put(inp)));
      });
      if (L_STATUS[i]) { const s = document.createElement('p'); s.className = 'dest-state ' + L_STATUS[i].state; s.textContent = L_STATUS[i].state === 'failed' ? `✗ Not reaching ${p.name}: ${L_STATUS[i].reason}` : `✓ Live on ${p.name}`; li.append(s); }
      li.querySelector('[data-del]').disabled = live;
      li.querySelector('[data-del]').onclick = () => { const all = liveDests(); all.splice(i, 1); saveDests(all); };
      return li;
    }));
  }
  $('#destAdd').onchange = (e) => {
    const kind = e.target.value; e.target.value = '';
    if (!kind) return;
    saveDests([...liveDests(), { kind, url: PLATFORMS[kind].url, key: '', on: true }]);
    $('#destList li:last-child [data-k="' + (PLATFORMS[kind].url ? 'key' : 'url') + '"]')?.focus();
  };
  // Platform tiles: one click adds that destination (the select stays as the single code path).
  $$('.plat-tile[data-plat]').forEach((t) => t.addEventListener('click', () => { const s = $('#destAdd'); s.value = t.dataset.plat; s.onchange({ target: s }); }));
  const readyDests = () => liveDests().filter((d) => d.on && /^rtmps?:\/\//i.test(d.url || '') && (d.key || d.kind === 'custom'));
  /** The public page viewers can watch a destination on, as the host typed it (optional). */
  function watchUrl(d) {
    let w = String(d.watch || '').trim();
    if (w && !/^https?:\/\//i.test(w)) w = 'https://' + w;
    return /^https:\/\//i.test(w) ? w : '';
  }
  const watchLink = () => app.watchLinkUrl();
  $('#watchCopy').onclick = () => copy(watchLink(), 'Watch page link copied.');
  function fmtClock(ms) { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n, i) => (i ? String(n).padStart(2, '0') : n)).join(':').replace(/^0:/, ''); }
  function renderLive() {
    const host = isHost(), L = S.live, on = L?.phase === 'live';
    $('#liveOff').hidden = S.relayOn;
    for (const id of ['#destList', '#liveNote', '#liveBtn']) $(id).hidden = !S.relayOn;
    $('#destAdd').parentElement.hidden = !S.relayOn;
    renderDests();
    const n = readyDests().length;
    const waking = L?.phase === 'connecting' && Date.now() - L.t1 > 6000;
    const label = !L ? (n ? `Go live on ${n} platform${n === 1 ? '' : 's'}` : 'Go live') : L.phase === 'live' ? 'End the stream' : L.phase === 'stopping' ? 'Ending…' : waking ? 'Waking the live relay… (Cancel)' : 'Connecting… (Cancel)';
    // Say why the button is dimmed instead of leaving the host to guess.
    const all = liveDests();
    $('#liveWhy').hidden = !!L || !!n || !S.relayOn;
    $('#liveWhy').textContent = !host ? 'Only the host can go live.' : !S.studio ? 'Enter your studio first.' : !all.length ? 'Add where to stream: pick a platform above.' : !all.some((d) => d.on) ? 'Turn on Send for at least one destination.' : `${(PLATFORMS[all.find((d) => d.on)?.kind] || PLATFORMS.custom).name} needs ${all.find((d) => d.on && !/^rtmps?:\/\//i.test(d.url || '')) ? 'a server URL starting with rtmp:// or rtmps://' : 'a stream key'}. ${(PLATFORMS[all.find((d) => d.on)?.kind] || PLATFORMS.custom).hint}.`;
    $('#liveBtn').textContent = label;
    $('#liveBtn').disabled = !host || !S.studio || (!L && !n) || L?.phase === 'stopping';
    $('#liveBtn').classList.toggle('ending', on);
    $('#liveTop').classList.toggle('on-air', !!L);
    $('#livePillText').textContent = on ? 'Live ' + fmtClock(Date.now() - L.t0) : L ? 'Starting…' : 'Go live';
    $('#liveStats').hidden = !L;
    $('#watchRow').hidden = !S.relayOn || !S.studio;
    if (L) $('#liveStats').textContent = waking ? 'The live relay is starting up. This can take up to a minute the first time.' : on && L.stats ? [`Live on ${L.names.filter((x) => !(L.failed || []).includes(x)).join(', ') || 'nothing yet'}`, L.failed?.length && `${L.failed.join(', ')} failed`, L.stats.kbps != null && `${Math.round(L.stats.kbps).toLocaleString()} kbps`, L.stats.fps && `${Math.round(L.stats.fps)} fps`, L.slow && 'your upload is struggling'].filter(Boolean).join(' · ') : L.phase === 'connecting' ? 'Connecting to the relay…' : L.phase === 'live' ? `Live on ${L.names.join(', ')}` : '';
    syncAirPill();
  }
  function syncAirPill() {
    const pill = $('#stageAirPill');
    if (!pill) return;
    const shared = S.studio ? S.state : null;
    const on = !!(S.live?.phase === 'live' || shared?.live?.on);
    pill.classList.toggle('on', on);
    pill.classList.toggle('off', !on);
    const txt = $('#stageAirText');
    if (txt) txt.textContent = on ? 'ON AIR' : 'OFF AIR';
    const clk = $('#stageAirClock');
    if (clk) {
      const t0 = S.live?.t0 || shared?.live?.since || 0;
      clk.hidden = !(on && t0);
      if (on && t0) clk.textContent = fmtClock(Date.now() - t0);
    }
  }
  async function goLive() {
    if (S.live) return stopLive();
    if (!isHost() || !S.studio) return;
    const all = liveDests(), ready = readyDests(), dests = ready;
    const idx = all.map((d, i) => [d, i]).filter(([d]) => d.on && /^rtmps?:\/\//i.test(d.url || '') && (d.key || d.kind === 'custom')).map(([, i]) => i);
    if (!dests.length) { setTab('stream'); return toast('Add a destination and its stream key first.', { err: true }); }
    L_STATUS = {};
    const mime = pickLiveMime();
    if (!mime || !canvas.captureStream) return toast('This browser can’t stream. Use Chrome or Edge.', { err: true });
    S.live = { phase: 'connecting', names: dests.map((d) => (PLATFORMS[d.kind] || PLATFORMS.custom).name), warned: new Set(), t1: Date.now() };
    renderLive();
    const Lc = S.live;
    // Never hang on "Connecting…": say we're waking the relay, then give up with a clear message.
    Lc.wakeTimer = setInterval(() => { if (S.live !== Lc || Lc.phase !== 'connecting') return clearInterval(Lc.wakeTimer); renderLive(); }, 1000);
    Lc.giveUp = setTimeout(() => {
      if (S.live !== Lc || Lc.phase !== 'connecting') return;
      try { Lc.ws?.close(4100); } catch {}
      endLive(Lc);
      toast('The live relay didn’t answer, so nothing went out. Try Go live again in a moment.', { err: true, ms: 10000, action: ['Try again', goLive] });
    }, CONNECT_TIMEOUT);
    let url;
    try { ({ url } = await api('relay', creds())); }
    catch (e) { S.live = null; renderLive(); return toast(e.message, { err: true }); }
    audioCtx();
    const L = S.live;
    // A built-in relay answers on this same site (/relay/live): turn the path into a wss:// address.
    const ws = new WebSocket(url.startsWith('/') ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + url : url); ws.binaryType = 'arraybuffer'; L.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', video: mime.video, dests: dests.map((d) => ({ url: d.url, key: d.key })) }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'ready') startFeed(L, mime);
      else if (m.t === 'dest') {
        const at = idx[m.i]; if (at == null) return;
        L_STATUS[at] = { state: m.state, reason: m.reason || '' };
        const nm = (PLATFORMS[all[at]?.kind] || PLATFORMS.custom).name;
        if (m.state === 'failed') { L.failed = [...(L.failed || []), nm]; toast(`Not reaching ${nm}: ${m.reason}. The other destinations keep going.`, { err: true, ms: 10000 }); }
        renderDests(true); renderLive();
      }
      else if (m.t === 'live' && L.phase === 'connecting') {
        clearTimeout(L.giveUp);
        L.phase = 'live'; L.t0 = Date.now(); L.timer = setInterval(renderLive, 1000); renderDock();
        setTimeout(() => { if (S.live !== L) return; const ok = L.names.filter((n) => !(L.failed || []).includes(n)); toast(ok.length ? `You’re live on ${ok.join(' and ')}.${L.failed?.length ? ` ${L.failed.join(' and ')} failed.` : ''}` : 'The relay is running, but no destination accepted the stream.', { err: !ok.length || !!L.failed?.length }); }, 1500);
        setStage({ live: { on: true, since: L.t0, links: dests.map((d) => ({ kind: d.kind, url: watchUrl(d) })).filter((x) => x.url) } });
        autoRecordStart();
      }
      else if (m.t === 'stats') { L.stats = m; renderLive(); }
      else if (m.t === 'warn' && !L.warned.has(m.message)) { L.warned.add(m.message); toast('Streaming problem: ' + m.message, { err: true }); }
      else if (m.t === 'error') toast(m.message, { err: true });
    };
    ws.onclose = (ev) => {
      if (S.live !== L) return;
      const expected = L.phase === 'stopping';
      endLive(L);
      if (!expected) toast(ev.code === 1006 ? 'The stream stopped: lost the connection to the relay.' : 'The stream stopped.', { err: true });
      else toast('Stream ended.');
    };
  }
  function startFeed(L, mime) {
    const vs = canvas.captureStream(30);
    const stream = new MediaStream([...vs.getVideoTracks(), ...app.recDest.stream.getAudioTracks()]);
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime.mimeType, videoBitsPerSecond: 4_500_000, audioBitsPerSecond: 160_000, videoKeyFrameIntervalDuration: 2000 }); }
    catch (e) { toast('Could not start the stream: ' + e.message, { err: true }); L.ws.close(1000); return; }
    rec.ondataavailable = async (e) => {
      if (!e.data.size || L.ws.readyState !== 1) return;
      L.ws.send(await e.data.arrayBuffer());
      const behind = L.ws.bufferedAmount;
      L.slow = behind > 4_000_000;
      if (behind > 40_000_000) { toast('Your upload can’t keep up, so the stream was stopped. Try a wired connection.', { err: true }); stopLive(); }
    };
    rec.start(250);
    Object.assign(L, { rec, vs });
  }
  function stopLive() {
    const L = S.live;
    if (!L || L.phase === 'stopping') return;
    L.phase = 'stopping'; renderLive();
    try { L.rec?.state !== 'inactive' && L.rec?.stop(); } catch {}
    setTimeout(() => { try { L.ws?.close(1000); } catch {} }, 600);
    setTimeout(() => { if (S.live === L) endLive(L); }, 4000);
  }
  /** Settings → Auto-record every live show: a local recording starts with the stream and stops when it ends. */
  function autoRecordStart() {
    if (!store.get('streamPrefs', {}).autoRec || S.rec) return;
    toggleRecord();
    if (S.rec) { S.rec.auto = true; toast('Recording this show automatically. Turn it off in Account → Studio defaults.', { ms: 5000 }); }
  }
  function endLive(L) {
    if (S.rec?.auto) { try { S.rec.recorder.stop(); } catch {} }
    clearInterval(L.timer); clearTimeout(L.giveUp); clearInterval(L.wakeTimer); L_STATUS = {};
    if (L.phase === 'live' || L.t0) setStage({ live: null });
    try { L.rec?.state !== 'inactive' && L.rec?.stop(); } catch {}
    L.vs?.getTracks().forEach((t) => t.stop());
    S.live = null; renderLive(); renderDock();
  }
  $('#liveBtn').onclick = goLive;
  let wokeAt = 0;
  /** Opening Go live wakes a sleeping relay, so it's ready by the time the host clicks. */
  function wakeRelay() {
    if (!S.relayOn || !isHost() || !S.studio || Date.now() - wokeAt < 5 * 60_000) return;
    wokeAt = Date.now();
    api('relayWake', creds()).catch(() => {});
  }

  function pickMime() {
    const opts = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
    return opts.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  }
  function toggleRecord() {
    if (S.rec) return S.rec.recorder.stop();
    if (!window.MediaRecorder || !canvas.captureStream) return toast('Recording is not supported in this browser.', { err: true });
    audioCtx();
    const vs = canvas.captureStream(30);
    const stream = new MediaStream([...vs.getVideoTracks(), ...app.recDest.stream.getAudioTracks()]);
    const mimeType = pickMime();
    let recorder;
    try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 160_000 }); }
    catch (e) { return toast('Could not start recording: ' + e.message, { err: true }); }
    const chunks = [];
    const t0 = Date.now();
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      clearInterval(S.rec.timer);
      vs.getTracks().forEach((t) => t.stop());
      const dur = Date.now() - t0;
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      S.rec = null;
      wsSend({ type: 'recording', on: false });
      if (isHost()) setStage({ rec: null });
      renderDock();
      showRecording(blob, dur);
    };
    recorder.start(1000);
    S.rec = { recorder, t0, timer: setInterval(renderDock, 500) };
    wsSend({ type: 'recording', on: true });
    if (isHost()) setStage({ rec: { on: true, since: t0 } }); // everyone sees the REC badge for as long as it runs
    toast('Recording the stage. Everything you see is captured.');
    renderDock();
  }
  let lastRecUrl = null, lastRec = null, driveBusy = false;
  function renderDriveButton() {
    const b = $('#recDrive');
    b.disabled = !googleConfigured() || driveBusy || !!lastRec?.saved;
    b.lastChild.textContent = lastRec?.saved ? 'Saved to Drive' : driveBusy ? 'Uploading…' : 'Save to Google Drive';
    if (!googleConfigured()) b.dataset.tip = 'Google sign-in isn’t set up on this server yet';
  }
  async function uploadRecording() {
    if (!lastRec || driveBusy) return;
    const rec = lastRec;
    driveBusy = true; renderDriveButton();
    const bar = $('#recDriveBar'), note = $('#recDriveNote');
    bar.hidden = false; note.hidden = false; note.textContent = 'Connecting to Google Drive…'; bar.firstElementChild.style.width = '0%';
    try {
      const file = await saveToDrive(rec.blob, rec.name, (f) => {
        bar.firstElementChild.style.width = Math.round(f * 100) + '%';
        note.textContent = `Uploading to Drive · ${Math.round(f * 100)}% of ${(rec.blob.size / 1048576).toFixed(1)} MB`;
      });
      rec.saved = file;
      replaceKids(note, document.createTextNode('Saved to Drive → gather recordings. '));
      if (file.webViewLink) { const a = document.createElement('a'); a.href = file.webViewLink; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open in Drive'; note.append(a); }
      if (!$('#recDlg').open) toast('Recording saved to Google Drive.');
    } catch (e) {
      note.textContent = e.message;
      bar.hidden = true;
    } finally { driveBusy = false; renderDriveButton(); renderGoogle(); }
  }
  $('#recDrive').onclick = uploadRecording;
  function showRecording(blob, dur) {
    if (lastRecUrl) URL.revokeObjectURL(lastRecUrl);
    lastRecUrl = URL.createObjectURL(blob);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    $('#recVideo').src = lastRecUrl;
    $('#recDownload').href = lastRecUrl;
    $('#recDownload').download = `gather-${S.studio || 'studio'}-${stamp}.${ext}`;
    $('#recInfo').textContent = `${fmtTime(dur)} long · ${(blob.size / 1048576).toFixed(1)} MB · ${ext.toUpperCase()}`;
    lastRec = { blob, name: $('#recDownload').download, saved: null };
    $('#recDriveBar').hidden = true; $('#recDriveNote').hidden = true;
    renderDriveButton();
    $('#recDlg').showModal();
    if (store.get('driveAuto', false)) {
      if (googleSignedIn('drive')) uploadRecording();
      else { $('#recDriveNote').hidden = false; $('#recDriveNote').textContent = 'Your Google sign-in has expired. Click Save to Google Drive to sign in again and upload.'; }
    }
  }

  return { liveDests, renderSocialMatrix, readyDests, renderLive, syncAirPill, stopLive, wakeRelay, toggleRecord, renderDriveButton };
}
