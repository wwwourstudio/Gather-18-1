// Standalone 3D Broadcast Remote synced in real time with the host's Gather Studio via BroadcastChannel + localStorage fallback.
const $ = (s, r = document) => r.querySelector(s);

const params = new URLSearchParams(location.search);
const pathCode = location.pathname.replace(/^\/controller\/?/, '').trim();
let studioCode = (params.get('studio') || pathCode || '').replace(/[^a-z0-9-]/gi, '').slice(0, 48);
if (!studioCode) {
  try { studioCode = (localStorage.getItem('gather:activeStudio') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 48); } catch {}
}

const SNAP_KEY_PREFIX = 'gather:ctrlSnap:';
const CMD_KEY_PREFIX = 'gather:ctrlCmd:';

const waitBanner = $('#ctrlWaitBanner');
const showTitleEl = $('#ctrlShowTitle');
const statusMetaEl = $('#ctrlStatusMeta');
const syncMetaEl = $('#ctrlSyncMeta');
const airLedEl = $('#ctrlAirLed');
const transportEl = $('#ctrlTransport');
const metaEl = $('#multiCamMeta');
const gridEl = $('#multiCamGrid');
const scenesEl = $('#ctrlScenes');
const bannerInput = $('#ctrlBannerInput');
const bannerShowBtn = $('#ctrlBannerShow');
const bannerHideBtn = $('#ctrlBannerHide');
const bannerPresetsEl = $('#ctrlBannerPresets');
const supersSec = $('#ctrlSupersSec');
const supersCount = $('#ctrlSupersCount');
const supersList = $('#ctrlSupersList');
const superBar = $('#ctrlSuperBar');
const superTitle = $('#ctrlSuperTitle');
const superAmt = $('#ctrlSuperAmt');
const superMsg = $('#ctrlSuperMsg');
const superActs = $('#ctrlSuperActs');
const superAirBtn = $('#ctrlSuperAir');
const superDismissBtn = $('#ctrlSuperDismiss');
const tickPrevBtn = $('#ctrlTickPrev');
const tickPauseBtn = $('#ctrlTickPause');
const tickNextBtn = $('#ctrlTickNext');
const tickSlide = $('#ctrlTickSlide');
const tickWho = $('#ctrlTickWho');
const tickTxt = $('#ctrlTickTxt');
const tickStageBtn = $('#ctrlTickStage');
const aiCtxEl = $('#ctrlAiCtx');
const aiRecNameEl = $('#ctrlAiRecName');
const aiRecReasonEl = $('#ctrlAiRecReason');
const aiApplyBtn = $('#ctrlAiApply');
const aiActionsEl = $('#ctrlAiActions');

try {
  const savedTheme = JSON.parse(localStorage.getItem('gather:theme') || '"dark"');
  document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark');
} catch {}

let lastSnap = null;
let lastRecvAt = 0;
let tickIdx = 0;
let tickPaused = false;
let currentTickerMsg = null;
let currentSuperItem = null;
let lastSeenSuperId = '';
let dismissedSuperIds = new Set();

if (!studioCode) {
  if (waitBanner) {
    waitBanner.hidden = false;
    waitBanner.textContent = 'Open this 3D Stream Remote from the Control tab inside your Gather studio.';
  }
  if (syncMetaEl) syncMetaEl.textContent = 'No studio linked';
}

const bc = studioCode && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('gather-director:' + studioCode)
  : null;

function postRaw(msg) {
  if (!studioCode) return;
  if (bc) {
    try { bc.postMessage(msg); } catch {}
  }
  try {
    localStorage.setItem(CMD_KEY_PREFIX + studioCode, JSON.stringify({ ...msg, _t: Date.now() + Math.random() }));
  } catch {}
}

function sendCmd(action, payload = {}) {
  postRaw({ type: 'cmd', action, payload });
}

const makeInitials = (name) => String(name || 'G').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || 'G';

function renderTicker(step = 0) {
  const msgs = Array.isArray(lastSnap?.recentComments) ? lastSnap.recentComments : [];
  if (!msgs.length) {
    currentTickerMsg = null;
    if (tickWho) tickWho.textContent = 'Live feed';
    if (tickTxt) tickTxt.textContent = 'Viewer & studio comments rotate here automatically.';
    if (tickStageBtn) { tickStageBtn.disabled = true; tickStageBtn.textContent = 'Stage'; tickStageBtn.classList.remove('is-on'); }
    return;
  }
  if (step !== 0) tickIdx = (tickIdx + step + msgs.length) % msgs.length;
  else if (tickIdx >= msgs.length) tickIdx = msgs.length - 1;
  const m = msgs[tickIdx];
  currentTickerMsg = m;
  const srcTag = m.src && m.src !== 'studio' ? ` · ${m.src}` : '';
  if (tickWho) tickWho.textContent = `${m.name}${srcTag}${m.paid ? ` · ${m.paid}` : ''}`;
  if (tickTxt) tickTxt.textContent = m.text || '(attachment)';
  if (tickSlide && step !== 0) {
    tickSlide.classList.remove('ctk-swap');
    void tickSlide.offsetWidth;
    tickSlide.classList.add('ctk-swap');
  }
  if (tickStageBtn) {
    const isFeat = !!(lastSnap?.featuredId && lastSnap.featuredId === m.id);
    tickStageBtn.disabled = !lastSnap?.isHost;
    tickStageBtn.textContent = isFeat ? 'On air' : 'Stage';
    tickStageBtn.classList.toggle('is-on', isFeat);
  }
}

function renderSuperBar(snap) {
  const all = (Array.isArray(snap.recentSupers) ? snap.recentSupers : (snap.pendingSupers || []))
    .filter((s) => s && !dismissedSuperIds.has(s.id));
  const pending = all.filter((s) => s.status === 'pending');
  const top = pending[0] || all[0] || null;
  currentSuperItem = top;
  if (!top) {
    superBar?.classList.remove('has-alert', 'is-pulse');
    if (superTitle) superTitle.textContent = 'Super Chats Ready';
    if (superAmt) superAmt.hidden = true;
    if (superMsg) superMsg.textContent = 'Paid tips & bounties alert here for 1-tap stage airing.';
    if (superActs) superActs.hidden = true;
    return;
  }
  superBar?.classList.add('has-alert');
  if (top.id !== lastSeenSuperId) {
    lastSeenSuperId = top.id;
    superBar?.classList.remove('is-pulse');
    void superBar?.offsetWidth;
    superBar?.classList.add('is-pulse');
  }
  if (superTitle) superTitle.textContent = `${top.name}${top.bounty ? ' · Bounty' : ''}${pending.length > 1 ? ` (+${pending.length - 1})` : ''}`;
  if (superAmt) { superAmt.hidden = false; superAmt.textContent = `$${Number(top.amount || 0).toFixed(top.amount % 1 ? 2 : 0)}`; }
  if (superMsg) superMsg.textContent = top.text || 'Sent a Super Chat!';
  if (superActs) superActs.hidden = false;
  if (superAirBtn) superAirBtn.textContent = top.status === 'pending' ? 'Air' : 'Stage';
}

function renderSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return;
  lastSnap = snap;
  lastRecvAt = Date.now();
  if (waitBanner) waitBanner.hidden = true;
  if (syncMetaEl) syncMetaEl.textContent = 'Connected';
  if (showTitleEl) showTitleEl.textContent = snap.title || 'Gather 3D Stream Remote';
  if (statusMetaEl) {
    const airLabel = snap.live ? 'On air' : snap.rec ? 'Recording' : 'Off air';
    statusMetaEl.textContent = `${airLabel} · ${Number(snap.viewers) || 0} watching`;
    statusMetaEl.classList.toggle('is-live', !!snap.live);
  }
  if (airLedEl) {
    airLedEl.classList.toggle('is-live', !!snap.live);
    airLedEl.classList.toggle('is-rec', !snap.live && !!snap.rec);
  }

  renderSuperBar(snap);
  renderTicker(0);

  // AI Director
  if (snap.aiRec) {
    if (aiCtxEl) aiCtxEl.textContent = snap.aiRec.ctx || 'Studio';
    if (aiRecNameEl) aiRecNameEl.textContent = snap.aiRec.isActive ? `${snap.aiRec.name} (active)` : `${snap.aiRec.name} recommended`;
    if (aiRecReasonEl) aiRecReasonEl.textContent = snap.aiRec.reason || '';
    if (aiApplyBtn) {
      aiApplyBtn.dataset.sceneId = snap.aiRec.id || '';
      aiApplyBtn.disabled = !snap.isHost || !!snap.aiRec.isActive;
      aiApplyBtn.textContent = snap.aiRec.isActive ? 'Active' : 'Apply';
      aiApplyBtn.classList.toggle('is-active', !!snap.aiRec.isActive);
    }
  }

  const setKey = (key, on, labelOn, labelOff, hot = false) => {
    const btn = transportEl?.querySelector(`[data-ctrl="${key}"]`);
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(!!on));
    btn.classList.toggle('is-on', !!on);
    btn.classList.toggle('is-hot', !!on && hot);
    btn.disabled = !snap.isHost;
    const lbl = btn.querySelector('span') || btn;
    if (labelOn && labelOff) lbl.textContent = on ? labelOn : labelOff;
  };
  setKey('mic', !!snap.micOn, 'Mic on', 'Mic muted');
  setKey('cam', !!snap.camOn, 'Cam on', 'Cam off');
  setKey('rec', !!snap.rec, 'Stop rec', 'Record', true);
  setKey('live', !!snap.live, 'End live', 'Go live', true);
  setKey('captions', !!snap.captionsOn, 'CC on', 'Captions');

  // Multi-Cam Switcher
  const peers = Array.isArray(snap.peers) ? snap.peers : [];
  const onStageCount = peers.filter((p) => p.onStage).length;
  if (metaEl) {
    metaEl.textContent = peers.length
      ? `${peers.length} camera${peers.length === 1 ? '' : 's'} · ${onStageCount} on stage`
      : 'Waiting for feeds';
  }
  if (!peers.length) {
    if (!gridEl.querySelector('.mc-empty')) {
      gridEl.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'mc-empty';
      empty.textContent = 'No camera feeds in this studio yet.';
      gridEl.append(empty);
    }
  } else {
    gridEl.querySelector('.mc-empty')?.remove();
    const keep = new Set(peers.map((p) => p.id));
    for (const el of gridEl.querySelectorAll('.mc-tile')) {
      if (!keep.has(el.dataset.id)) el.remove();
    }
    for (const p of peers) {
      let tile = gridEl.querySelector(`.mc-tile[data-id="${CSS.escape(p.id)}"]`);
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'mc-tile';
        tile.dataset.id = p.id;
        const vbox = document.createElement('div');
        vbox.className = 'mc-video-box';
        const img = document.createElement('img');
        img.className = 'mc-thumb';
        img.hidden = true;
        const ini = document.createElement('div');
        ini.className = 'mc-ini';
        ini.append(document.createElement('span'));
        const st = document.createElement('span');
        st.className = 'mc-state';
        const vu = document.createElement('div');
        vu.className = 'mc-vu';
        vu.append(document.createElement('i'));
        vbox.append(img, ini, st, vu);

        const foot = document.createElement('div');
        foot.className = 'mc-foot';
        const nm = document.createElement('span');
        nm.className = 'mc-name';
        const btns = document.createElement('div');
        btns.className = 'mc-btns';
        const sBtn = document.createElement('button');
        sBtn.type = 'button';
        sBtn.className = 'mc-btn mc-stage-btn';
        sBtn.addEventListener('click', () => sendCmd('stage', { id: p.id }));
        const mBtn = document.createElement('button');
        mBtn.type = 'button';
        mBtn.className = 'mc-btn mc-mute-btn';
        mBtn.textContent = 'Mute';
        mBtn.addEventListener('click', () => sendCmd('mute', { id: p.id }));
        btns.append(sBtn, mBtn);
        foot.append(nm, btns);
        tile.append(vbox, foot);
        gridEl.append(tile);
      }

      tile.classList.toggle('on-stage', !!p.onStage);
      const img = tile.querySelector('.mc-thumb');
      const ini = tile.querySelector('.mc-ini');
      const iniSpan = ini?.querySelector('span');
      if (p.thumb && p.thumb.startsWith('data:image/jpeg;base64,')) {
        if (img) { img.src = p.thumb; img.alt = `${p.name} camera preview`; img.hidden = false; }
        if (ini) ini.hidden = true;
      } else if (!p.cam) {
        if (img) img.hidden = true;
        if (ini) ini.hidden = false;
      }
      if (iniSpan) iniSpan.textContent = makeInitials(p.name);
      const st = tile.querySelector('.mc-state');
      if (st) { st.textContent = p.onStage ? 'On stage' : 'Backstage'; st.classList.toggle('on', !!p.onStage); }
      const bar = tile.querySelector('.mc-vu i');
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(p.level) || 0))}%`;
      const nm = tile.querySelector('.mc-name');
      if (nm) nm.textContent = p.name + (p.isHost ? ' (Host)' : p.me ? ' (You)' : '');
      const sBtn = tile.querySelector('.mc-stage-btn');
      if (sBtn) { sBtn.textContent = p.onStage ? 'Take off' : 'On stage'; sBtn.classList.toggle('on', !!p.onStage); sBtn.disabled = !snap.isHost; }
      const mBtn = tile.querySelector('.mc-mute-btn');
      if (mBtn) { mBtn.hidden = !!p.me; mBtn.disabled = !snap.isHost || !p.mic; }
    }
  }

  // Quick Scenes
  const scenes = Array.isArray(snap.scenes) ? snap.scenes : [];
  const scSig = `${snap.isHost ? 1 : 0}|${snap.activeSceneId || ''}|` + scenes.map((s) => `${s.id}:${s.name}`).join('|');
  if (scenesEl.dataset.sig !== scSig) {
    scenesEl.dataset.sig = scSig;
    scenesEl.textContent = '';
    for (const sc of scenes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctrl-scene-btn' + (sc.id === snap.activeSceneId ? ' is-active' : '');
      const led = document.createElement('i');
      led.className = 'ctrl-led';
      led.setAttribute('aria-hidden', 'true');
      const sp = document.createElement('span');
      sp.textContent = sc.name;
      b.append(led, sp);
      b.disabled = !snap.isHost;
      b.setAttribute('aria-pressed', String(sc.id === snap.activeSceneId));
      b.addEventListener('click', () => sendCmd('scene', { id: sc.id }));
      scenesEl.append(b);
    }
  }

  // Pending Super Chats & Bounties
  const supers = Array.isArray(snap.pendingSupers) ? snap.pendingSupers : [];
  supersSec.hidden = supers.length === 0;
  if (supersCount) supersCount.textContent = String(supers.length);
  const supSig = supers.map((x) => `${x.id}:${x.amount}:${x.text}`).join('|');
  if (supersList.dataset.sig !== supSig) {
    supersList.dataset.sig = supSig;
    supersList.textContent = '';
    for (const item of supers) {
      const row = document.createElement('div');
      row.className = 'ctrl-super-item';
      const top = document.createElement('div');
      top.className = 'ctrl-super-top';
      const amt = document.createElement('b');
      amt.className = 'num';
      amt.textContent = `$${item.amount}`;
      const who = document.createElement('span');
      who.textContent = `${item.name}${item.bounty ? ' · Bounty' : ''}`;
      top.append(amt, who);
      const msg = document.createElement('p');
      msg.textContent = item.text || '(no message)';
      const acts = document.createElement('div');
      acts.className = 'ctrl-super-acts';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn primary';
      ok.textContent = 'Confirm & air';
      ok.addEventListener('click', () => sendCmd('confirmSuper', { id: item.id }));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'btn ghost';
      no.textContent = 'Dismiss';
      no.addEventListener('click', () => sendCmd('dismissSuper', { id: item.id }));
      acts.append(ok, no);
      row.append(top, msg, acts);
      supersList.append(row);
    }
  }
}

transportEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ctrl]');
  if (!btn) return;
  sendCmd(btn.dataset.ctrl);
});
superAirBtn?.addEventListener('click', () => {
  if (!currentSuperItem) return;
  if (currentSuperItem.status === 'pending') sendCmd('confirmSuper', { id: currentSuperItem.id });
  else sendCmd('featureComment', { msg: { id: 'sc-' + currentSuperItem.id, src: 'watch', name: currentSuperItem.name, text: currentSuperItem.text || 'Sent a Super Chat!', paid: `$${currentSuperItem.amount}` } });
});
superDismissBtn?.addEventListener('click', () => {
  if (!currentSuperItem) return;
  dismissedSuperIds.add(currentSuperItem.id);
  sendCmd('dismissSuper', { id: currentSuperItem.id });
  if (lastSnap) renderSuperBar(lastSnap);
});
tickPrevBtn?.addEventListener('click', () => renderTicker(-1));
tickNextBtn?.addEventListener('click', () => renderTicker(1));
tickPauseBtn?.addEventListener('click', () => {
  tickPaused = !tickPaused;
  tickPauseBtn.setAttribute('aria-pressed', String(tickPaused));
  tickPauseBtn.textContent = tickPaused ? '▶' : '⏸';
});
tickStageBtn?.addEventListener('click', () => {
  if (!currentTickerMsg) return;
  if (lastSnap?.featuredId === currentTickerMsg.id) sendCmd('featureComment', { clear: true });
  else sendCmd('featureComment', { msg: currentTickerMsg });
});
aiApplyBtn?.addEventListener('click', () => {
  const id = aiApplyBtn.dataset.sceneId;
  if (id) sendCmd('scene', { id });
});
aiActionsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ai-act]');
  if (!btn) return;
  sendCmd('aiAction', { kind: btn.dataset.aiAct });
});
bannerShowBtn?.addEventListener('click', () => {
  const txt = (bannerInput?.value || '').trim();
  if (!txt) return;
  sendCmd('banner', { text: txt });
});
bannerHideBtn?.addEventListener('click', () => sendCmd('banner', { text: '' }));
bannerPresetsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-banner]');
  if (!btn) return;
  if (bannerInput) bannerInput.value = btn.dataset.banner || '';
  sendCmd('banner', { text: btn.dataset.banner || '' });
});
bannerInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); bannerShowBtn?.click(); }
});

setInterval(() => { if (!tickPaused) renderTicker(1); }, 4500);

function readStorageSnapshot() {
  if (!studioCode) return;
  try {
    const raw = localStorage.getItem(SNAP_KEY_PREFIX + studioCode);
    if (!raw) return;
    const snap = JSON.parse(raw);
    if (snap?.type === 'snapshot' && (!lastSnap || (snap.ts || 0) >= (lastSnap.ts || 0))) {
      renderSnapshot(snap);
    }
  } catch {}
}

window.addEventListener('storage', (ev) => {
  if (!studioCode) return;
  if (ev.key === SNAP_KEY_PREFIX + studioCode && ev.newValue) {
    try { renderSnapshot(JSON.parse(ev.newValue)); } catch {}
  }
});

if (bc) {
  bc.onmessage = (ev) => {
    const msg = ev?.data;
    if (msg?.type === 'snapshot') renderSnapshot(msg);
  };
}

if (studioCode) {
  readStorageSnapshot();
  postRaw({ type: 'hello' });
  setInterval(() => {
    postRaw({ type: 'ping' });
    readStorageSnapshot();
    if (lastSnap && Date.now() - lastRecvAt > 8000 && syncMetaEl) {
      syncMetaEl.textContent = 'Studio paused';
    }
  }, 2000);
}
