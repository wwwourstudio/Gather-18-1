// OBS Studio Integration (OBS WebSocket v5 local / LAN client)
// Extracted into a standalone module for Gather Studio's control deck.
export function createObsIntegration({ $, store, toast, copy, replaceKids, togglePopover, sceneList }) {
  const DEFAULT_URL = 'ws://127.0.0.1:4455';
  const OP = { Hello: 0, Identify: 1, Identified: 2, Reidentify: 3, Event: 5, Request: 6, RequestResponse: 7 };
  // EventSubscription bitmask: General (1) | Scenes (4) | Outputs (64) | Ui (1024) = 1093
  const EVENT_SUBS = 1 | 4 | 64 | 1024;

  const state = {
    status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'warning' | 'error'
    hadHandshake: false,
    url: store.get('obsUrl', DEFAULT_URL) || DEFAULT_URL,
    autoSync: store.get('obsAutoSync', true) !== false,
    sceneMap: store.get('obsSceneMap', {}) || {},
    scenes: [],
    sceneThumbs: {},
    currentProgramScene: '',
    currentPreviewScene: '',
    studioMode: false,
    streaming: false,
    recording: false,
    streamBusy: false,
    recordBusy: false,
    obsVersion: '',
    lastError: '',
  };

  const MAX_RECONNECT_ATTEMPTS = 4;
  const THUMB_TTL_MS = 8000;
  const HOVER_THUMB_TTL_MS = 2500;
  const THUMB_POLL_MS = 8000;
  const VALID_THUMB_RE = /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i;

  let ws = null;
  let reqSeq = 0;
  let manualClose = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const pending = new Map();
  let lastPassword = '';
  let thumbGen = 0;
  let thumbPollTimer = null;
  const sceneThumbTs = new Map();
  const sceneThumbFailed = new Set();
  let hoverCardEl = null;
  let hoveredScene = '';
  let hoverAnchorEl = null;

  // RFC 6234 SHA-256 fallback so OBS WebSocket auth works even on plain HTTP LAN origins where crypto.subtle is undefined.
  function sha256BytesFallback(inputBytes) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = inputBytes.length;
    const bitLen = l * 8;
    const paddedLen = Math.ceil((l + 9) / 64) * 64;
    const msg = new Uint8Array(paddedLen);
    msg.set(inputBytes);
    msg[l] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
    dv.setUint32(paddedLen - 4, bitLen >>> 0, false);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < paddedLen; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    const out = new Uint8Array(32);
    const outDv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, H[i], false);
    return out;
  }

  async function sha256Base64(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    let digest;
    if (globalThis.crypto?.subtle?.digest) {
      digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    } else {
      digest = sha256BytesFallback(bytes);
    }
    let bin = '';
    for (let i = 0; i < digest.length; i++) bin += String.fromCharCode(digest[i]);
    return btoa(bin);
  }

  async function computeAuth(password, salt, challenge) {
    const secret = await sha256Base64(String(password || '') + String(salt || ''));
    return sha256Base64(secret + String(challenge || ''));
  }

  function normalizeObsUrl(raw) {
    let val = String(raw || '').trim();
    if (!val) val = DEFAULT_URL;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(val)) val = 'ws://' + val;
    let parsed;
    try { parsed = new URL(val); } catch { return { error: 'Enter a valid ws:// or wss:// OBS WebSocket URL.' }; }
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return { error: 'OBS WebSocket URL must start with ws:// or wss://.' };
    }
    const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname.toLowerCase());
    const mixedLan = location.protocol === 'https:' && parsed.protocol === 'ws:' && !isLoopback;
    if (mixedLan) {
      return {
        url: parsed.toString(),
        mixedLan: true,
        warn: 'HTTPS blocks insecure ws:// to LAN IPs (browsers allow ws:// only for 127.0.0.1). Proxy OBS with wss:// (see LAN help below).',
      };
    }
    return { url: parsed.toString(), mixedLan: false };
  }

  function clearPending(reason) {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason || 'OBS connection closed'));
    }
    pending.clear();
  }

  function sendPacket(op, d) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ op, d }));
    return true;
  }

  function request(requestType, requestData = {}) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || state.status !== 'connected') {
        return reject(new Error('OBS Studio is not connected.'));
      }
      const requestId = `gather-obs-${++reqSeq}`;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`OBS request timed out (${requestType})`));
      }, 8000);
      pending.set(requestId, { resolve, reject, timer });
      const ok = sendPacket(OP.Request, { requestType, requestId, requestData });
      if (!ok) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(new Error('OBS WebSocket is not open.'));
      }
    });
  }

  function isValidThumb(url) {
    return typeof url === 'string' && url.length < 220000 && VALID_THUMB_RE.test(url);
  }

  function patchMapThumbDom(sceneName, dataUrl) {
    const list = $('#obsMapList');
    if (!list || !isValidThumb(dataUrl)) return;
    for (const row of list.querySelectorAll('.obs-map-row')) {
      if (row.dataset.resolvedObs !== sceneName) continue;
      const box = row.querySelector('.obs-map-thumb');
      if (!box) continue;
      let img = box.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        replaceKids(box, img);
      }
      if (img.src !== dataUrl) img.src = dataUrl;
      box.classList.add('has-img');
    }
  }

  function findMappedGatherScenes(obsSceneName) {
    if (!obsSceneName) return [];
    const list = typeof sceneList === 'function' ? sceneList() : [];
    const matched = [];
    for (const sc of list) {
      if (state.sceneMap[sc.id] === obsSceneName) matched.push(sc.name);
    }
    return matched;
  }

  function ensureHoverPreview() {
    if (hoverCardEl && hoverCardEl.isConnected) return hoverCardEl;
    const el = document.createElement('div');
    el.className = 'obs-hover-preview glass raised';
    el.id = 'obsHoverPreview';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    const frame = document.createElement('div');
    frame.className = 'obs-hp-frame';
    const img = document.createElement('img');
    img.className = 'obs-hp-img';
    img.alt = '';
    img.decoding = 'async';
    img.hidden = true;
    const ph = document.createElement('div');
    ph.className = 'obs-hp-ph';
    const badge = document.createElement('span');
    badge.className = 'obs-hp-badge num';
    frame.append(img, ph, badge);

    const meta = document.createElement('div');
    meta.className = 'obs-hp-meta';
    const title = document.createElement('div');
    title.className = 'obs-hp-title';
    const sub = document.createElement('div');
    sub.className = 'obs-hp-sub';
    meta.append(title, sub);

    el.append(frame, meta);
    document.body.append(el);
    hoverCardEl = el;
    return el;
  }

  function updateHoverPreviewContent(sceneName) {
    if (!hoverCardEl || hoverCardEl.hidden || hoveredScene !== sceneName) return;
    const thumbUrl = state.sceneThumbs[sceneName];
    const hasThumb = isValidThumb(thumbUrl);
    const isProg = sceneName === state.currentProgramScene;
    const isPrev = state.studioMode && sceneName === state.currentPreviewScene && !isProg;
    const frame = hoverCardEl.querySelector('.obs-hp-frame');
    const img = hoverCardEl.querySelector('.obs-hp-img');
    const ph = hoverCardEl.querySelector('.obs-hp-ph');
    const badge = hoverCardEl.querySelector('.obs-hp-badge');
    const title = hoverCardEl.querySelector('.obs-hp-title');
    const sub = hoverCardEl.querySelector('.obs-hp-sub');

    if (frame) {
      frame.classList.toggle('is-loading', !hasThumb && !sceneThumbFailed.has(sceneName));
      frame.classList.toggle('is-program', isProg);
      frame.classList.toggle('is-preview', isPrev);
    }
    if (img) {
      if (hasThumb) {
        if (img.src !== thumbUrl) img.src = thumbUrl;
        img.hidden = false;
      } else {
        img.hidden = true;
      }
    }
    if (ph) {
      ph.hidden = hasThumb;
      ph.textContent = sceneThumbFailed.has(sceneName) ? 'No preview available' : 'Capturing preview…';
    }
    if (badge) {
      badge.textContent = isProg ? 'LIVE IN OBS' : isPrev ? 'PREVIEW' : 'READY';
      badge.dataset.kind = isProg ? 'live' : isPrev ? 'pvw' : 'ready';
    }
    if (title) title.textContent = sceneName;
    if (sub) {
      const mapped = findMappedGatherScenes(sceneName);
      const hint = state.studioMode ? 'Click: Program · Shift-click: Preview' : 'Click to switch OBS Program';
      sub.textContent = mapped.length ? `Mapped: ${mapped.slice(0, 2).join(', ')} · ${hint}` : hint;
    }
  }

  function positionHoverPreview(anchor) {
    if (!hoverCardEl || !anchor || !anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const cardW = 288;
    const cardH = 216;
    const margin = 10;
    const left = Math.max(margin, Math.min(window.innerWidth - cardW - margin, rect.left + rect.width / 2 - cardW / 2));
    const top = Math.max(margin, rect.top - cardH - 10);
    hoverCardEl.style.left = `${Math.round(left)}px`;
    hoverCardEl.style.top = `${Math.round(top)}px`;
  }

  function showHoverPreview(sceneName, anchor) {
    if (!sceneName || state.status !== 'connected') return;
    const el = ensureHoverPreview();
    hoveredScene = sceneName;
    hoverAnchorEl = anchor;
    el.hidden = false;
    updateHoverPreviewContent(sceneName);
    positionHoverPreview(anchor);
    const lastTs = sceneThumbTs.get(sceneName) || 0;
    if (!state.sceneThumbs[sceneName] || Date.now() - lastTs > HOVER_THUMB_TTL_MS) {
      captureSceneThumbnail(sceneName, { force: true });
    }
  }

  function hideHoverPreview() {
    hoveredScene = '';
    hoverAnchorEl = null;
    if (hoverCardEl) hoverCardEl.hidden = true;
  }

  function patchSceneThumbDom(sceneName, dataUrl, { failed = false } = {}) {
    const strip = $('#obsSceneStrip');
    if (strip) {
      const btn = [...strip.querySelectorAll('.obs-scene-btn')].find((b) => b.dataset.obsScene === sceneName);
      if (btn) {
        const wrap = btn.querySelector('.obs-sc-thumb');
        if (wrap) {
          if (isValidThumb(dataUrl)) {
            let img = wrap.querySelector('.obs-sc-thumb-img');
            if (!img) {
              img = document.createElement('img');
              img.className = 'obs-sc-thumb-img';
              img.alt = '';
              img.decoding = 'async';
              wrap.prepend(img);
            }
            if (img.src !== dataUrl) img.src = dataUrl;
            img.hidden = false;
            const ph = wrap.querySelector('.obs-sc-ph');
            if (ph) ph.hidden = true;
            wrap.classList.remove('is-loading', 'is-empty');
            btn.classList.add('has-thumb');
          } else if (failed) {
            wrap.classList.remove('is-loading');
            wrap.classList.add('is-empty');
          }
        }
      }
    }
    if (isValidThumb(dataUrl)) patchMapThumbDom(sceneName, dataUrl);
    if (hoveredScene === sceneName) updateHoverPreviewContent(sceneName);
  }

  async function captureSceneThumbnail(sceneName, { force = false } = {}) {
    const name = String(sceneName || '').trim();
    if (!name || state.status !== 'connected') return null;
    const lastTs = sceneThumbTs.get(name) || 0;
    if (!force && state.sceneThumbs[name] && Date.now() - lastTs < THUMB_TTL_MS) {
      return state.sceneThumbs[name];
    }
    const gen = thumbGen;
    try {
      const res = await request('GetSourceScreenshot', {
        sourceName: name,
        imageFormat: 'jpeg',
        imageWidth: 320,
        imageHeight: 180,
        imageCompressionQuality: 72,
      });
      if (gen !== thumbGen || state.status !== 'connected') return null;
      const dataUrl = typeof res?.imageData === 'string' ? res.imageData.trim() : '';
      if (!isValidThumb(dataUrl)) {
        sceneThumbFailed.add(name);
        patchSceneThumbDom(name, '', { failed: true });
        return null;
      }
      sceneThumbFailed.delete(name);
      state.sceneThumbs[name] = dataUrl;
      sceneThumbTs.set(name, Date.now());
      patchSceneThumbDom(name, dataUrl);
      return dataUrl;
    } catch {
      if (gen === thumbGen && !state.sceneThumbs[name]) {
        sceneThumbFailed.add(name);
        patchSceneThumbDom(name, '', { failed: true });
      }
      return null;
    }
  }

  function isObsTabVisible() {
    const layer = $('#obsDeckLayer');
    return !!(layer && layer.classList.contains('on') && !document.hidden);
  }

  function startThumbPolling() {
    if (thumbPollTimer) return;
    thumbPollTimer = setInterval(() => {
      if (state.status !== 'connected' || !state.scenes.length) return;
      if (!isObsTabVisible()) return;
      refreshSceneThumbnails(null, { force: true });
    }, THUMB_POLL_MS);
  }

  function stopThumbPolling() {
    if (thumbPollTimer) {
      clearInterval(thumbPollTimer);
      thumbPollTimer = null;
    }
  }

  async function refreshSceneThumbnails(sceneNames = null, { force = false } = {}) {
    if (state.status !== 'connected') return;
    const gen = thumbGen;
    const names = Array.isArray(sceneNames) && sceneNames.length
      ? sceneNames.map((n) => String(n || '').trim()).filter(Boolean)
      : state.scenes.map((s) => s.name);
    if (!names.length) return;
    const prioritized = [];
    const seen = new Set();
    for (const first of [state.currentProgramScene, state.currentPreviewScene, ...names]) {
      if (first && !seen.has(first)) {
        seen.add(first);
        prioritized.push(first);
      }
      if (prioritized.length >= 24) break;
    }
    const queue = prioritized.slice();
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length && gen === thumbGen && state.status === 'connected') {
        const next = queue.shift();
        if (next) await captureSceneThumbnail(next, { force });
      }
    });
    await Promise.allSettled(workers);
  }

  async function refreshScenes({ silent = false } = {}) {
    if (state.status !== 'connected') return [];
    try {
      const [listRes, studioRes, streamRes, recRes] = await Promise.allSettled([
        request('GetSceneList'),
        request('GetStudioModeEnabled'),
        request('GetStreamStatus'),
        request('GetRecordStatus'),
      ]);
      if (listRes.status === 'fulfilled' && listRes.value) {
        const raw = Array.isArray(listRes.value.scenes) ? listRes.value.scenes : [];
        state.scenes = raw.slice().reverse().map((s) => ({
          name: String(s.sceneName || ''),
          index: Number(s.sceneIndex ?? 0),
        })).filter((s) => s.name);
        state.currentProgramScene = String(listRes.value.currentProgramSceneName || '');
        state.currentPreviewScene = String(listRes.value.currentPreviewSceneName || '');
        const validNames = new Set(state.scenes.map((s) => s.name));
        for (const k of Object.keys(state.sceneThumbs)) {
          if (!validNames.has(k)) { delete state.sceneThumbs[k]; sceneThumbTs.delete(k); }
        }
      }
      if (studioRes.status === 'fulfilled' && studioRes.value) {
        state.studioMode = !!studioRes.value.studioModeEnabled;
      }
      if (streamRes.status === 'fulfilled' && streamRes.value) {
        state.streaming = !!streamRes.value.outputActive;
      }
      if (recRes.status === 'fulfilled' && recRes.value) {
        state.recording = !!recRes.value.outputActive;
      }
      renderObsUI();
      refreshSceneThumbnails(null, { force: !silent });
      return state.scenes;
    } catch (err) {
      if (!silent) toast(`OBS refresh failed: ${err.message || 'Unknown error'}`, { err: true });
      return [];
    }
  }

  async function switchScene(sceneName, { silent = false, preview = false } = {}) {
    const name = String(sceneName || '').trim();
    if (!name) return false;
    if (state.status !== 'connected') {
      if (!silent) toast('Connect OBS Studio first to trigger scene switches.', { err: true });
      return false;
    }
    const usePreview = preview && state.studioMode;
    try {
      await request(usePreview ? 'SetCurrentPreviewScene' : 'SetCurrentProgramScene', { sceneName: name });
      if (usePreview) state.currentPreviewScene = name;
      else state.currentProgramScene = name;
      renderObsUI();
      setTimeout(() => { captureSceneThumbnail(name, { force: true }); }, 180);
      if (!silent) toast(`OBS ${usePreview ? 'preview' : 'scene'} → ${name}`);
      return true;
    } catch (err) {
      if (!silent) toast(`OBS scene switch failed: ${err.message || 'Request rejected'}`, { err: true });
      return false;
    }
  }

  async function toggleStream() {
    if (state.status !== 'connected' || state.streamBusy) return false;
    state.streamBusy = true;
    renderObsUI();
    const stopping = state.streaming;
    try {
      await request(stopping ? 'StopStream' : 'StartStream');
      state.streaming = !stopping;
      toast(stopping ? 'OBS stream stopping…' : 'OBS stream starting…');
      return true;
    } catch (err) {
      toast(`OBS stream failed: ${err.message || 'Request rejected'}`, { err: true });
      return false;
    } finally {
      state.streamBusy = false;
      renderObsUI();
    }
  }

  async function toggleRecord() {
    if (state.status !== 'connected' || state.recordBusy) return false;
    state.recordBusy = true;
    renderObsUI();
    const stopping = state.recording;
    try {
      await request(stopping ? 'StopRecord' : 'StartRecord');
      state.recording = !stopping;
      toast(stopping ? 'OBS recording stopped.' : 'OBS recording started.');
      return true;
    } catch (err) {
      toast(`OBS recording failed: ${err.message || 'Request rejected'}`, { err: true });
      return false;
    } finally {
      state.recordBusy = false;
      renderObsUI();
    }
  }

  async function triggerCut() {
    if (state.status !== 'connected' || !state.studioMode) return false;
    try {
      await request('TriggerStudioModeTransition');
      toast('OBS Studio Mode transition triggered.');
      return true;
    } catch (err) {
      toast(`OBS Cut failed: ${err.message || 'Request rejected'}`, { err: true });
      return false;
    }
  }

  function handleObsEvent(ev) {
    if (!ev || !ev.eventType) return;
    const d = ev.eventData || {};
    switch (ev.eventType) {
      case 'CurrentProgramSceneChanged':
        state.currentProgramScene = String(d.sceneName || '');
        renderObsUI();
        if (state.currentProgramScene) setTimeout(() => { captureSceneThumbnail(state.currentProgramScene, { force: true }); }, 180);
        break;
      case 'CurrentPreviewSceneChanged':
        state.currentPreviewScene = String(d.sceneName || '');
        renderObsUI();
        if (state.currentPreviewScene) setTimeout(() => { captureSceneThumbnail(state.currentPreviewScene, { force: true }); }, 180);
        break;
      case 'SceneListChanged':
        if (Array.isArray(d.scenes)) {
          state.scenes = d.scenes.slice().reverse().map((s) => ({
            name: String(s.sceneName || ''),
            index: Number(s.sceneIndex ?? 0),
          })).filter((s) => s.name);
          renderObsUI();
          refreshSceneThumbnails(null, { force: false });
        } else {
          refreshScenes({ silent: true });
        }
        break;
      case 'StudioModeStateChanged':
        state.studioMode = !!d.studioModeEnabled;
        renderObsUI();
        break;
      case 'StreamStateChanged':
        state.streaming = !!d.outputActive;
        renderObsUI();
        break;
      case 'RecordStateChanged':
        state.recording = !!d.outputActive;
        renderObsUI();
        break;
      default:
        break;
    }
  }

  function scheduleReconnect() {
    if (manualClose || reconnectTimer || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    const delay = Math.min(15000, 2000 * Math.pow(2, reconnectAttempts));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!manualClose && state.status !== 'connected') {
        connect(state.url, lastPassword, { silent: true, isReconnect: true });
      }
    }, delay);
  }

  function disconnect({ silent = false } = {}) {
    manualClose = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    stopThumbPolling();
    hideHoverPreview();
    reconnectAttempts = 0;
    thumbGen++;
    const sock = ws;
    ws = null;
    clearPending('Disconnected from OBS Studio');
    if (sock) {
      try { sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null; sock.close(1000, 'User disconnect'); } catch {}
    }
    state.status = 'disconnected';
    state.hadHandshake = false;
    state.scenes = [];
    state.sceneThumbs = {};
    sceneThumbTs.clear();
    sceneThumbFailed.clear();
    state.currentProgramScene = '';
    state.currentPreviewScene = '';
    state.studioMode = false;
    state.streaming = false;
    state.recording = false;
    state.streamBusy = false;
    state.recordBusy = false;
    state.obsVersion = '';
    state.lastError = '';
    renderObsUI();
    if (!silent) toast('Disconnected from OBS Studio.');
  }

  function connect(rawUrl, password = '', { silent = false, isReconnect = false } = {}) {
    const norm = normalizeObsUrl(rawUrl ?? $('#obsUrl')?.value ?? state.url);
    if (norm.error) {
      state.status = 'error';
      state.lastError = norm.error;
      renderObsUI();
      if (!silent) toast(norm.error, { err: true });
      return false;
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) {
      try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(1000, 'Reconnect'); } catch {}
      ws = null;
    }
    clearPending('Reconnecting to OBS Studio');
    manualClose = false;
    thumbGen++;
    if (!isReconnect) {
      state.hadHandshake = false;
      reconnectAttempts = 0;
      state.sceneThumbs = {};
      sceneThumbTs.clear();
    }
    state.url = norm.url;
    lastPassword = String(password || '');
    store.set('obsUrl', state.url);
    if (isReconnect && state.hadHandshake) {
      state.status = 'warning';
    } else {
      state.status = 'connecting';
      state.lastError = norm.warn || '';
    }
    renderObsUI();

    let sock;
    try {
      toast.dismiss('obs-err');
      sock = new WebSocket(state.url);
    } catch (err) {
      state.status = 'error';
      state.lastError = err?.message || 'Could not open OBS WebSocket connection.';
      renderObsUI();
      if (!silent) toast(state.lastError, { err: true, key: 'obs-err' });
      return false;
    }
    ws = sock;

    sock.onmessage = async (ev) => {
      if (ws !== sock) return;
      let msg;
      try { msg = JSON.parse(String(ev.data || '{}')); } catch { return; }
      const { op, d } = msg || {};
      if (op === OP.Hello) {
        state.obsVersion = String(d?.obsWebSocketVersion || '5.x');
        const identify = { rpcVersion: Number(d?.rpcVersion || 1), eventSubscriptions: EVENT_SUBS };
        if (d?.authentication?.challenge && d?.authentication?.salt) {
          try {
            identify.authentication = await computeAuth(lastPassword, d.authentication.salt, d.authentication.challenge);
          } catch {
            state.status = 'error';
            state.lastError = 'Failed to compute OBS WebSocket authentication hash.';
            renderObsUI();
            return;
          }
        }
        sendPacket(OP.Identify, identify);
      } else if (op === OP.Identified) {
        reconnectAttempts = 0;
        state.hadHandshake = true;
        state.status = 'connected';
        state.lastError = '';
        toast.dismiss('obs-err');
        renderObsUI();
        if (!silent) toast(`Connected to OBS Studio (${state.obsVersion || 'WebSocket v5'}).`, { key: 'obs-conn', ms: 3200 });
        await refreshScenes({ silent: true });
        startThumbPolling();
      } else if (op === OP.Event) {
        handleObsEvent(d);
      } else if (op === OP.RequestResponse) {
        const entry = pending.get(d?.requestId);
        if (!entry) return;
        pending.delete(d.requestId);
        clearTimeout(entry.timer);
        if (d?.requestStatus?.result) {
          entry.resolve(d.responseData || {});
        } else {
          const comment = d?.requestStatus?.comment || `OBS error code ${d?.requestStatus?.code ?? 'unknown'}`;
          entry.reject(new Error(comment));
        }
      }
    };

    sock.onerror = () => {
      if (ws !== sock) return;
      if (state.status === 'connecting') {
        state.lastError = norm.warn || 'Could not reach OBS WebSocket. Verify OBS 28+ is running with WebSocket Server enabled.';
      } else if (state.hadHandshake) {
        state.lastError = 'OBS WebSocket connection interrupted.';
      }
    };

    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      const wasConnected = state.status === 'connected';
      const droppedAfterHandshake = wasConnected || state.hadHandshake;
      clearPending('OBS WebSocket closed');
      if (manualClose) {
        state.status = 'disconnected';
        renderObsUI();
        return;
      }
      if (ev.code === 4009) {
        manualClose = true;
        state.status = 'error';
        state.lastError = 'OBS authentication failed. Check your WebSocket server password.';
        renderObsUI();
        if (!silent) toast(state.lastError, { err: true, key: 'obs-err' });
        return;
      }
      const reasonDetail = ev?.reason
        ? `: ${String(ev.reason).slice(0, 120)}`
        : (ev?.code && ev.code !== 1000 ? ` (code ${ev.code})` : '');

      if (droppedAfterHandshake) {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          state.status = 'warning';
          state.lastError = `OBS connection dropped${reasonDetail}. Retrying (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})…`;
          renderObsUI();
          if (wasConnected && !silent) toast(`OBS connection dropped${reasonDetail}. Retrying…`, { err: true, key: 'obs-err' });
          scheduleReconnect();
        } else {
          state.status = 'error';
          state.lastError = `OBS connection lost after handshake${reasonDetail}. Auto-reconnect stopped — click Reconnect.`;
          renderObsUI();
          if (!silent) toast(state.lastError, { err: true, key: 'obs-err' });
        }
        return;
      }

      state.status = 'error';
      if (!state.lastError) {
        state.lastError = norm.warn || (`Could not reach OBS WebSocket at ${state.url}${reasonDetail}`);
      }
      renderObsUI();
      if (!silent && !isReconnect) toast(state.lastError, { err: true, key: 'obs-err' });
    };

    return true;
  }

  function resolveMappedObsScene(sc) {
    if (!sc) return '';
    const id = typeof sc === 'string' ? sc : String(sc.id || '').trim();
    const mapped = id ? String(state.sceneMap[id] || '').trim() : '';
    if (mapped && (!state.scenes.length || state.scenes.some((s) => s.name === mapped))) return mapped;
    const rawName = typeof sc === 'string' ? sc : String(sc.name || '').trim();
    const needle = rawName.toLowerCase();
    if (!needle) return '';
    const match = state.scenes.find((s) => s.name.trim().toLowerCase() === needle);
    return match ? match.name : '';
  }

  let lastAutoTarget = '';
  let lastAutoAt = 0;

  async function syncObsToGatherScene(sc) {
    if (!state.autoSync || state.status !== 'connected' || !sc) return false;
    const target = resolveMappedObsScene(sc);
    if (!target || target === state.currentProgramScene) return false;
    const now = Date.now();
    if (target === lastAutoTarget && now - lastAutoAt < 120) return false;
    lastAutoTarget = target;
    lastAutoAt = now;
    try {
      await request('SetCurrentProgramScene', { sceneName: target });
      state.currentProgramScene = target;
      renderObsUI();
      setTimeout(() => { captureSceneThumbnail(target, { force: true }); }, 180);
      toast(`OBS synced → ${target}`, { key: 'obs-sync', ms: 2600 });
      return true;
    } catch (err) {
      toast(`OBS auto-sync failed (${target}): ${err?.message || 'Request rejected'}`, { err: true, key: 'obs-sync' });
      return false;
    }
  }

  function onGatherScene(sc) {
    return syncObsToGatherScene(sc);
  }

  function handleGatherSceneSwitch(ev) {
    const detail = ev?.detail;
    if (!detail) return;
    let sc = detail.scene || detail;
    if (typeof sc === 'string') {
      const list = typeof sceneList === 'function' ? sceneList() : [];
      sc = list.find((item) => item.id === sc || item.name === sc) || { id: sc, name: sc };
    } else if (sc && (!sc.name || !sc.id)) {
      const list = typeof sceneList === 'function' ? sceneList() : [];
      const found = list.find((item) => (sc.id && item.id === sc.id) || (sc.name && item.name === sc.name));
      if (found) sc = { ...found, ...sc };
    }
    syncObsToGatherScene(sc);
  }

  window.addEventListener('gather:scene-switch', handleGatherSceneSwitch);

  function renderMapPopover() {
    const list = $('#obsMapList');
    if (!list) return;
    const gatherScenes = sceneList().slice(0, 12);
    const rows = gatherScenes.map((sc) => {
      const row = document.createElement('div');
      row.className = 'obs-map-row';

      const resolvedName = resolveMappedObsScene(sc);
      row.dataset.resolvedObs = resolvedName;

      const thumbBox = document.createElement('span');
      thumbBox.className = 'obs-map-thumb';
      const thumbUrl = resolvedName ? state.sceneThumbs[resolvedName] : '';
      if (isValidThumb(thumbUrl)) {
        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = '';
        img.decoding = 'async';
        thumbBox.append(img);
        thumbBox.classList.add('has-img');
      } else {
        const ph = document.createElement('span');
        ph.className = 'obs-map-thumb-ph';
        ph.textContent = resolvedName ? resolvedName.slice(0, 2).toUpperCase() : '—';
        thumbBox.append(ph);
      }

      const lbl = document.createElement('span');
      lbl.className = 'obs-map-lbl';
      lbl.textContent = sc.name;

      const sel = document.createElement('select');
      sel.className = 'input sm obs-map-sel';
      sel.setAttribute('aria-label', `OBS scene for ${sc.name}`);
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = state.scenes.length ? 'Match by name / None' : 'Connect OBS to choose…';
      sel.append(noneOpt);
      for (const os of state.scenes) {
        const opt = document.createElement('option');
        opt.value = os.name;
        opt.textContent = os.name;
        sel.append(opt);
      }
      const saved = state.sceneMap[sc.id] || '';
      if (saved && !state.scenes.some((s) => s.name === saved)) {
        const opt = document.createElement('option');
        opt.value = saved;
        opt.textContent = `${saved} (saved)`;
        sel.append(opt);
      }
      sel.value = saved;
      sel.onchange = () => {
        if (sel.value) state.sceneMap[sc.id] = sel.value;
        else delete state.sceneMap[sc.id];
        store.set('obsSceneMap', state.sceneMap);
        renderMapPopover();
        if (sel.value && state.status === 'connected' && !state.sceneThumbs[sel.value]) {
          captureSceneThumbnail(sel.value);
        }
      };
      row.append(thumbBox, lbl, sel);
      return row;
    });
    replaceKids(list, ...rows);
  }

  function renderObsUI() {
    const statusEl = $('#obsStatus');
    const statusTxt = $('#obsStatusText');
    const metaEl = $('#obsMeta');
    const tabDot = $('#obsTabDot');
    const deckTab = $('#obsDeckTab');
    const urlInput = $('#obsUrl');
    const passInput = $('#obsPass');
    const connBtn = $('#obsConnectBtn');
    const refBtn = $('#obsRefreshBtn');
    const cutBtn = $('#obsCutBtn');
    const streamBtn = $('#obsStreamBtn');
    const recordBtn = $('#obsRecordBtn');
    const syncChk = $('#obsAutoSync');
    const strip = $('#obsSceneStrip');
    const empty = $('#obsEmpty');
    const hint = $('#obsHint');
    if (!statusEl) return;

    const connected = state.status === 'connected';
    const connecting = state.status === 'connecting';
    const warning = state.status === 'warning';
    const errored = state.status === 'error';

    statusEl.dataset.state = state.status;
    if (tabDot) tabDot.dataset.state = connected ? 'on' : connecting ? 'busy' : warning ? 'warn' : errored ? 'err' : 'off';
    const statusLabel = connected
      ? 'Connected'
      : connecting
        ? 'Connecting…'
        : warning
          ? 'Connection dropped'
          : errored
            ? (state.hadHandshake ? 'Connection lost' : 'Connection failed')
            : 'Disconnected';
    if (statusTxt) statusTxt.textContent = statusLabel;

    if (state.lastError) {
      statusEl.dataset.tip = state.lastError;
      statusEl.dataset.hasError = '1';
      statusEl.title = state.lastError;
      statusEl.tabIndex = 0;
      statusEl.setAttribute('aria-label', `${statusLabel}: ${state.lastError}`);
      if (deckTab) deckTab.dataset.tip = `OBS ${statusLabel.toLowerCase()}: ${state.lastError}`;
    } else {
      delete statusEl.dataset.tip;
      delete statusEl.dataset.hasError;
      statusEl.removeAttribute('title');
      statusEl.removeAttribute('tabindex');
      statusEl.removeAttribute('aria-label');
      if (deckTab) delete deckTab.dataset.tip;
    }

    if (metaEl) {
      const parts = [];
      if (connected && state.scenes.length) parts.push(`${state.scenes.length} scene${state.scenes.length === 1 ? '' : 's'}`);
      if (connected && state.streaming) parts.push('OBS Live');
      if (connected && state.recording) parts.push('OBS Rec');
      if (warning) parts.push('Retrying…');
      metaEl.textContent = parts.join(' · ');
      metaEl.hidden = !parts.length;
    }

    if (urlInput && document.activeElement !== urlInput && !urlInput.value) urlInput.value = state.url;
    if (urlInput) urlInput.disabled = connected || connecting;
    if (passInput) passInput.disabled = connected || connecting;

    if (connBtn) {
      connBtn.textContent = connected
        ? 'Disconnect'
        : connecting
          ? 'Cancel'
          : (warning || (errored && state.hadHandshake))
            ? 'Reconnect'
            : 'Connect';
      connBtn.classList.toggle('primary', !connected && !connecting);
      connBtn.classList.toggle('ghost', connected || connecting);
    }
    if (refBtn) refBtn.hidden = !connected;
    if (cutBtn) cutBtn.hidden = !connected || !state.studioMode;
    if (streamBtn) {
      streamBtn.hidden = !connected;
      streamBtn.disabled = state.streamBusy;
      streamBtn.classList.toggle('is-active', state.streaming);
      streamBtn.setAttribute('aria-pressed', String(state.streaming));
      const lbl = streamBtn.querySelector('span');
      if (lbl) lbl.textContent = state.streaming ? 'Stop OBS' : 'OBS Stream';
      streamBtn.dataset.tip = state.streaming ? 'Stop OBS live stream' : 'Start OBS live stream';
    }
    if (recordBtn) {
      recordBtn.hidden = !connected;
      recordBtn.disabled = state.recordBusy;
      recordBtn.classList.toggle('is-active', state.recording);
      recordBtn.setAttribute('aria-pressed', String(state.recording));
      const lbl = recordBtn.querySelector('span');
      if (lbl) lbl.textContent = state.recording ? 'Stop Rec' : 'OBS Rec';
      recordBtn.dataset.tip = state.recording ? 'Stop OBS recording' : 'Start OBS recording';
    }
    if (syncChk) syncChk.checked = state.autoSync;

    if (strip && empty) {
      if (connected && state.scenes.length) {
        strip.hidden = false;
        empty.hidden = true;
        const buttons = state.scenes.map((sc, idx) => {
          const isProg = sc.name === state.currentProgramScene;
          const isPrev = state.studioMode && sc.name === state.currentPreviewScene && !isProg;
          const thumbUrl = state.sceneThumbs[sc.name];
          const hasThumb = isValidThumb(thumbUrl);
          const isFailed = !hasThumb && sceneThumbFailed.has(sc.name);
          const mappedNames = findMappedGatherScenes(sc.name);
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.obsScene = sc.name;
          b.className = 'obs-scene-btn has-thumb' + (isProg ? ' is-program' : '') + (isPrev ? ' is-preview' : '');
          b.setAttribute('aria-pressed', String(isProg));
          b.tabIndex = isProg || (idx === 0 && !state.currentProgramScene) ? 0 : -1;
          b.setAttribute('aria-label', `${sc.name}${isProg ? ' (Live in OBS)' : isPrev ? ' (Preview)' : ''}`);

          const badge = document.createElement('span');
          badge.className = 'obs-sc-idx num';
          badge.textContent = isProg ? 'LIVE' : isPrev ? 'PVW' : String(idx + 1).padStart(2, '0');

          const thumb = document.createElement('span');
          thumb.className = 'obs-sc-thumb' + (hasThumb ? '' : isFailed ? ' is-empty' : ' is-loading');

          const img = document.createElement('img');
          img.className = 'obs-sc-thumb-img';
          img.alt = '';
          img.decoding = 'async';
          if (hasThumb) img.src = thumbUrl;
          else img.hidden = true;

          const ph = document.createElement('span');
          ph.className = 'obs-sc-ph';
          ph.textContent = sc.name.slice(0, 2).toUpperCase();
          ph.hidden = hasThumb;

          thumb.append(img, ph, badge);

          if (mappedNames.length) {
            const mapBadge = document.createElement('span');
            mapBadge.className = 'obs-sc-mapped';
            mapBadge.title = `Mapped to Gather: ${mappedNames.join(', ')}`;
            mapBadge.textContent = 'SYNC';
            thumb.append(mapBadge);
          }

          const name = document.createElement('span');
          name.className = 'obs-sc-name';
          name.textContent = sc.name;

          b.append(thumb, name);
          b.addEventListener('pointerenter', () => showHoverPreview(sc.name, b));
          b.addEventListener('pointerleave', () => { if (hoverAnchorEl === b) hideHoverPreview(); });
          b.addEventListener('focus', () => showHoverPreview(sc.name, b));
          b.addEventListener('blur', () => { if (hoverAnchorEl === b) hideHoverPreview(); });
          b.onclick = (ev) => {
            hideHoverPreview();
            switchScene(sc.name, { preview: !!(ev.shiftKey && state.studioMode) });
          };
          return b;
        });
        replaceKids(strip, ...buttons);
      } else {
        hideHoverPreview();
        strip.hidden = true;
        empty.hidden = false;
        if (hint) {
          hint.textContent = state.lastError
            ? state.lastError
            : connected
              ? 'Connected to OBS Studio — no scenes found in the active scene collection.'
              : 'Connect to local OBS Studio 28+ (Tools → WebSocket Server Settings · port 4455) to trigger scene switches from this deck.';
        }
      }
    }
    renderMapPopover();
    if (hoveredScene) updateHoverPreviewContent(hoveredScene);
  }

  // Bind OBS deck controls once
  const urlInput = $('#obsUrl');
  const passInput = $('#obsPass');
  const lanBtn = $('#obsLanBtn');
  const lanGuide = $('#obsLanGuide');
  const lanClose = $('#obsLanClose');
  const lanCopyBtn = $('#obsLanCopyBtn');
  const lanUseLocalBtn = $('#obsLanUseLocalBtn');
  let lanGuideForced = null;

  if (urlInput) urlInput.value = state.url;

  function syncLanGuide(rawUrl) {
    if (!lanGuide) return;
    const norm = normalizeObsUrl(rawUrl ?? urlInput?.value ?? state.url);
    const show = lanGuideForced !== null ? lanGuideForced : !!norm.mixedLan;
    lanGuide.hidden = !show;
    lanGuide.dataset.mixed = norm.mixedLan ? '1' : '0';
    if (lanBtn) {
      lanBtn.setAttribute('aria-expanded', String(show));
      lanBtn.classList.toggle('on', show);
    }
  }

  const triggerConnect = () => {
    if (state.status === 'connected' || state.status === 'connecting') {
      disconnect();
    } else {
      const norm = normalizeObsUrl(urlInput?.value || state.url);
      if (norm.mixedLan) { lanGuideForced = true; syncLanGuide(urlInput?.value); }
      connect(urlInput?.value || state.url, passInput?.value || lastPassword || '');
    }
  };
  $('#obsConnectBtn')?.addEventListener('click', triggerConnect);
  urlInput?.addEventListener('input', () => { lanGuideForced = null; syncLanGuide(urlInput.value); });
  urlInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); triggerConnect(); } });
  passInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); triggerConnect(); } });
  $('#obsRefreshBtn')?.addEventListener('click', () => refreshScenes());
  $('#obsCutBtn')?.addEventListener('click', () => triggerCut());
  $('#obsStreamBtn')?.addEventListener('click', () => toggleStream());
  $('#obsRecordBtn')?.addEventListener('click', () => toggleRecord());
  $('#obsAutoSync')?.addEventListener('change', (e) => {
    state.autoSync = !!e.target.checked;
    store.set('obsAutoSync', state.autoSync);
    toast(state.autoSync ? 'OBS Auto-sync on — switching Gather scenes updates OBS.' : 'OBS Auto-sync off.');
  });

  lanBtn?.addEventListener('click', () => {
    lanGuideForced = lanGuide ? lanGuide.hidden : true;
    syncLanGuide();
  });
  lanClose?.addEventListener('click', () => {
    lanGuideForced = false;
    syncLanGuide();
  });
  lanCopyBtn?.addEventListener('click', () => {
    const cmd = $('#obsLanCmd')?.textContent?.trim() || 'caddy reverse-proxy --from :4456 --to 127.0.0.1:4455';
    copy(cmd, 'Caddy WSS command copied.');
  });
  lanUseLocalBtn?.addEventListener('click', () => {
    if (urlInput) urlInput.value = DEFAULT_URL;
    state.url = DEFAULT_URL;
    store.set('obsUrl', DEFAULT_URL);
    lanGuideForced = false;
    syncLanGuide(DEFAULT_URL);
    toast('OBS URL set to ws://127.0.0.1:4455.');
  });

  const mapBtn = $('#obsMapBtn');
  const mapPop = $('#obsMapPop');
  if (mapBtn && mapPop) {
    mapBtn.addEventListener('click', () => {
      renderMapPopover();
      togglePopover(mapPop, mapBtn);
    });
  }

  $('#obsDeckTab')?.addEventListener('click', () => {
    if (state.status === 'connected') refreshSceneThumbnails(null, { force: false });
  });
  $('#obsSceneStrip')?.addEventListener('scroll', hideHoverPreview, { passive: true });
  $('#obsSceneStrip')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideHoverPreview(); return; }
    const all = [...$('#obsSceneStrip').querySelectorAll('.obs-scene-btn')];
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    const next = all[Math.max(0, Math.min(all.length - 1, to))];
    all.forEach((b) => { b.tabIndex = b === next ? 0 : -1; });
    next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  renderObsUI();
  syncLanGuide();

  const api = {
    connect,
    disconnect,
    switchScene,
    toggleStream,
    toggleRecord,
    triggerCut,
    refreshScenes,
    refreshSceneThumbnails,
    captureSceneThumbnail,
    request,
    onGatherScene,
    dispose: () => {
      window.removeEventListener('gather:scene-switch', handleGatherSceneSwitch);
      stopThumbPolling();
      hideHoverPreview();
      if (hoverCardEl) { hoverCardEl.remove(); hoverCardEl = null; }
      disconnect({ silent: true });
    },
    setMapping: (gatherSceneId, obsSceneName) => {
      if (!gatherSceneId) return;
      if (obsSceneName) state.sceneMap[gatherSceneId] = String(obsSceneName);
      else delete state.sceneMap[gatherSceneId];
      store.set('obsSceneMap', state.sceneMap);
      renderMapPopover();
    },
    getState: () => ({
      status: state.status,
      hadHandshake: state.hadHandshake,
      url: state.url,
      autoSync: state.autoSync,
      scenes: state.scenes.map((s) => s.name),
      sceneThumbs: { ...state.sceneThumbs },
      currentProgramScene: state.currentProgramScene,
      currentPreviewScene: state.currentPreviewScene,
      studioMode: state.studioMode,
      streaming: state.streaming,
      recording: state.recording,
      obsVersion: state.obsVersion,
      lastError: state.lastError,
      sceneMap: { ...state.sceneMap },
    }),
  };
  window.__gatherObs = api;
  return api;
}
