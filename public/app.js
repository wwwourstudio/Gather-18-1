import { createAudioChain, createVideoFx, needsProcessing } from './fx.js';
import { initPanels, refreshSections } from './panels.js';
import { icon, busy, togglePopover, cssEsc, replaceKids } from './ui.js';
import { TIERS, tierOf, drawOrder, isSystem, ensureSystem, blockerFor, snapMove, snapResize, resolve, SAFE, GRID, PRESETS, materialize } from './layout.js';
import { createNotifier } from './notify.js';
import { drawThemedFeatured, drawPurchaseAlert, drawShopDropBadge, drawVoiceOnAir, drawGoalConfetti, drawCountdownScreen, drawSponsorCard } from './stage-theme.js';
import { initAudioStudio } from './audio-studio.js';
import { initStudioTools } from './studio-tools.js';
import * as liveEvents from './live-events.js';
import { createAudience } from './audience.js';
import { createInvite } from './invite.js';
import { createProducer } from './producer.js';
import { createGoLive } from './golive.js';
import { createDesigner } from './designer.js';
import { createBroadcast } from './broadcast.js';
import { createAccount } from './account.js';
import { createAssistant } from './assistant.js';
import { createSamChat } from './sam-chat.js';
import { createAutoMoments } from './auto-moments.js';
import { createLiveChat } from './livechat.js';
import { createViewerCount } from './viewers.js';
// gather — client. Full-mesh WebRTC studio with a canvas-composited stage.
// The stage canvas is the single source of truth for what you see AND what gets recorded.

const $ = (s, r = document) => r.querySelector(s);
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const smooth = () => (reduceMotion() ? 'auto' : 'smooth');
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// Pictures (avatar, camera and camera-off backgrounds, brand images) are too big for localStorage's
// ~5 MB quota, so they live in IndexedDB behind the same synchronous store API.
const BIG_KEYS = new Set(['avatar', 'fxBg', 'offBg', 'brandImgs', 'arrangements']);
const bigMem = new Map();
function bigDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('gather-images', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
let bigDbP = null;
function bigPut(k, v) {
  (bigDbP ||= bigDb()).then((db) => { const tx = db.transaction('kv', 'readwrite'); v === undefined ? tx.objectStore('kv').delete(k) : tx.objectStore('kv').put(v, k); }).catch(() => {});
}
try {
  const db = await Promise.race([(bigDbP = bigDb()), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 1500))]);
  await new Promise((res) => {
    const tx = db.transaction('kv', 'readonly'), st = tx.objectStore('kv');
    const keys = st.getAllKeys(), vals = st.getAll();
    tx.oncomplete = () => { keys.result.forEach((k, i) => bigMem.set(k, vals.result[i])); res(); };
    tx.onerror = () => res();
  });
} catch {}
for (const k of BIG_KEYS) {
  // One-time move out of localStorage.
  try { const raw = localStorage.getItem('gather:' + k); if (raw != null) { if (!bigMem.has(k)) { bigMem.set(k, JSON.parse(raw)); bigPut(k, JSON.parse(raw)); } localStorage.removeItem('gather:' + k); } } catch {}
}
const store = mkStore(() => localStorage, true);
const sess = mkStore(() => sessionStorage);
function mkStore(get, big) {
  return {
    get(k, d) {
      if (big && BIG_KEYS.has(k)) { const v = bigMem.get(k); return v == null ? d : v; }
      try { const v = get().getItem('gather:' + k); if (v == null) return d; const p = JSON.parse(v); return p == null ? d : p; } catch { return d; }
    },
    set(k, v) {
      if (big && BIG_KEYS.has(k)) { bigMem.set(k, v); bigPut(k, v); return; }
      try { get().setItem('gather:' + k, JSON.stringify(v)); } catch {}
    },
  };
}

const BAD_ACCENTS = new Set(['#f3efe6', '#ffffff', '#5b7cff', '#4464e8', '#7c6cf2']);
if (!store.get('brandBlueV3', false)) {
  const curA = String(store.get('accent', '') || '').toLowerCase();
  if (!curA || BAD_ACCENTS.has(curA)) store.set('accent', '#3b82f6');
  const bp = store.get('brandPrefs', {});
  const curB = String(bp?.color || '').toLowerCase();
  if (bp && (!curB || BAD_ACCENTS.has(curB))) {
    bp.color = '#3b82f6';
    store.set('brandPrefs', bp);
  }
  store.set('brandBlueV3', true);
}
// One-time clean stage migration: clear legacy baked-in default overlay (old ON AIR / show title / blue frame) & frame border.
if (!store.get('cleanStageV3', false)) {
  try {
    const imgs = store.get('brandImgs', {});
    if (imgs && imgs.overlay) { delete imgs.overlay; store.set('brandImgs', imgs); }
    const bp = store.get('brandPrefs', {});
    if (bp && bp.frame && bp.frame !== 'none') { bp.frame = 'none'; store.set('brandPrefs', bp); }
  } catch {}
  store.set('cleanStageV3', true);
}

const MAX = 6;
let W = 1280, H = 720; // swapped to 720x1280 for the vertical stage
let PASS = null; // { vertical, els, layout } while the tall companion is being drawn (see drawTall)
const DEFAULT_TITLE = 'The conversation studio';
/** A new show is named after its host ("Maya's show") instead of a placeholder that reads like a real title. */
const autoTitle = () => { const first = String(S.name || '').trim().split(/\s+/)[0]; return first ? `${first}’s show`.slice(0, 60) : ''; };
const DEFAULT_PRESETS = ['Have a question? Drop it in the chat.', 'Thanks for joining us today.'];
const BGS = {
  dusk: ['#1d3f47', '#2a3566', '#3c3f74', 'rgba(255,255,255,.05)', false],
  ember: ['#3a1d24', '#6d2f2a', '#a0533a', 'rgba(255,220,200,.06)', false],
  forest: ['#10291f', '#1d4a3a', '#3b6b4b', 'rgba(220,255,230,.05)', false],
  graphite: ['#15181d', '#262b33', '#3a404b', 'rgba(255,255,255,.04)', false],
  paper: ['#f1efe9', '#e3e0d6', '#d4d0c4', 'rgba(0,0,0,.04)', true],
};

// ---------------------------------------------------------------- state
const S = {
  id: null, tok: null, studio: null, host: null, short: '', shortInvite: '', phase: 'offline', // offline | connecting | online | reconnecting
  name: store.get('name', ''),
  prefs: { startMic: store.get('startMic', true), startCam: store.get('startCam', true), camId: store.get('camId', ''), micId: store.get('micId', ''), quality: store.get('quality', '720'), noise: store.get('noise', true) },
  local: { audio: null, cam: null, screen: null, micOn: store.get('startMic', true), camOn: store.get('startCam', true), hand: false, autoMuted: false, camError: '', joinedAt: 0 },
  peers: new Map(),
  state: localState(),
  iceServers: [],
  unread: 0, tab: 'chat',
  rec: null,
  banner: { key: '', t0: 0 },
  audioBlocked: false,
  chatScope: 'guests',
  pendingChatFile: null,
  brief: null,
  briefExpanded: true,
};
function localState() {
  const imgs = store.get('brandImgs', {});
  const rawAccent = String(store.get('accent', '#3b82f6') || '#3b82f6');
  const savedAccent = BAD_ACCENTS.has(rawAccent.toLowerCase()) ? '#3b82f6' : rawAccent;
  const rawBp = store.get('brandPrefs', {});
  const bp = rawBp && typeof rawBp === 'object' ? { ...rawBp } : {};
  if (bp.color && BAD_ACCENTS.has(String(bp.color).toLowerCase())) bp.color = '#3b82f6';
  return {
    layout: 'split', stage: ['me'], banner: null, ticker: '',
    chatOpts: { guestFiles: true, defaultScope: 'guests' },
    brand: { color: savedAccent, bg: store.get('bg', 'dusk'), watermark: false, names: true, font: 'jakarta', tag: 'solid', bannerStyle: 'classic', anim: 'slide', frame: 'none', dim: 0.25, logoPos: 'tr', logoSize: 0.12,
      ...bp, bgImage: imgs.bgImage ? 'local-brand-bgImage' : '', overlay: imgs.overlay ? 'local-brand-overlay' : '', logo: imgs.logo ? 'local-brand-logo' : '' },
    title: store.get('title', ''), elements: [], featured: null, feeds: { twitch: '' },
    streamType: store.get('streamType', 'live'),
    hashtags: store.get('hashtags', []),
    notices: store.get('notices', []),
    whatNext: store.get('whatNext', null),
    aiSpotlight: store.get('aiSpotlight', null),
    aspect: store.get('streamPrefs', {}).aspect || '16:9', captions: { on: false, style: 'bar', size: 26, lang: 'en-US', ...(store.get('streamPrefs', {}).captions || {}) },
    autoMute: { on: true, sec: 30, scope: 'guests', ...(store.get('streamPrefs', {}).autoMute || {}) },
    autoGrid: store.get('streamPrefs', {}).autoGrid ?? true,
  };
}
const isHost = () => !S.studio || S.host === S.id;
const myId = () => S.id || 'me';
const WATCH_DEFAULTS = { chat: true, supers: false, join: false, queue: false, voice: true, badge: true, direct: true, cap: 6, slow: 0, min: 2, about: '', pin: '', lobby: '', rig: '', goal: { label: '', target: 0 }, reactsOnStream: true, links: [], pay: { paypal: '', venmo: '', cashapp: '', stripe: '' } };
const watchCfg = () => ({ ...WATCH_DEFAULTS, ...(S.state.watch || {}), pay: { ...WATCH_DEFAULTS.pay, ...(S.state.watch?.pay || {}) } });
function normalizeHex(hex) {
  const raw = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return '#' + raw.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw;
  return '';
}
function hexRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return [59, 130, 246];
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function hexLuminance(hex) {
  const [r, gr, b] = hexRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * gr + 0.0722 * b;
}
function applyAdaptiveAccent(hex) {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  const norm = normalizeHex(hex);
  const chosen = (!norm || BAD_ACCENTS.has(norm.toLowerCase())) ? (dark ? '#3b82f6' : '#2563eb') : norm;
  const [r, gr, b] = hexRgb(chosen);
  const lum = hexLuminance(chosen);
  const ink = lum > 0.42 ? '#070c1a' : '#ffffff';
  const root = document.documentElement.style;
  root.setProperty('--accent', chosen);
  root.setProperty('--accent-ink', ink);
  root.setProperty('--accent-hover', lum > 0.55 ? `rgb(${Math.max(0, r - 18)}, ${Math.max(0, gr - 18)}, ${Math.max(0, b - 18)})` : `rgb(${Math.min(255, r + 24)}, ${Math.min(255, gr + 24)}, ${Math.min(255, b + 24)})`);
  root.setProperty('--accent-soft', `rgba(${r}, ${gr}, ${b}, 0.16)`);
  root.setProperty('--accent-line', `rgba(${r}, ${gr}, ${b}, 0.42)`);
  const textColor = dark
    ? (lum < 0.22 ? `rgb(${Math.round(r + (255 - r) * 0.48)}, ${Math.round(gr + (255 - gr) * 0.48)}, ${Math.round(b + (255 - b) * 0.48)})` : chosen)
    : (lum > 0.45 ? `rgb(${Math.round(r * 0.45)}, ${Math.round(gr * 0.45)}, ${Math.round(b * 0.45)})` : chosen);
  root.setProperty('--accent-text', textColor);
}

// ---------------------------------------------------------------- utils (single unified notification queue)
const notifier = createNotifier($('#toasts') || '#toasts');
function toast(msg, opts = {}) { return notifier.push(msg, opts); }
toast.dismiss = (key) => notifier.dismiss(key);
toast.clear = () => notifier.clear();
// A dialog opened after a notification would cover the bar: float it above the dialog, and back into the page after.
for (const d of document.querySelectorAll('dialog')) new MutationObserver(() => { const box = $('#toasts'); if (!box?.showPopover) return; try { if (box.matches(':popover-open')) box.hidePopover(); if (d.open && box.children.length) box.showPopover(); } catch {} }).observe(d, { attributes: true, attributeFilter: ['open'] });
const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const fmtTime = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const newCode = () => 'gather-' + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
/** The kind of gather link pasted: 's' (invite), 'c' (call-in), 'w' (watch), or '' for a bare code. */
const linkKind = (v) => (String(v || '').match(/\/([scw])\/[a-z0-9-]+/i) || [])[1]?.toLowerCase() || '';
function parseCode(v) {
  v = String(v || '').trim();
  const m = v.match(/\/[scw]\/([a-z0-9-]+)/i);
  return (m ? m[1] : v).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
}
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { toast('Copy blocked by the browser. Select the text and copy it manually.', { err: true }); }
}
const inviteLink = () => `${location.origin}/s/${S.studio}`;
const shortInviteUrl = () => (S.studio && S.shortInvite ? `${location.origin}/s/${S.shortInvite}` : '');
const preferredInviteUrl = () => shortInviteUrl() || inviteLink();

// ---------------------------------------------------------------- audio graph
let actx = null, mixBus = null, recDest = null, duckBus = null, duckMonBus = null, duckToSend = false;
function audioCtx() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    mixBus = actx.createGain();
    duckBus = actx.createGain();
    duckMonBus = actx.createGain();
    recDest = actx.createMediaStreamDestination();
    mixBus.connect(recDest);
    duckBus.connect(mixBus);
    duckMonBus.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}
/** Attach a level meter to an audio track. Returns {level(), bands(), dispose()} */
function meter(track) {
  const ctx = audioCtx();
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = .3;
  src.connect(an); src.connect(mixBus);
  const buf = new Float32Array(an.fftSize);
  const freq = new Uint8Array(an.frequencyBinCount);
  const bandBins = [[1, 2], [3, 5], [6, 10], [11, 18], [19, 34]];
  const bandOut = new Float32Array(5);
  let smooth = 0;
  return {
    level() { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const rms = Math.sqrt(s / buf.length); smooth = Math.max(rms, smooth * .85); return smooth; },
    bands() {
      an.getByteFrequencyData(freq);
      for (let i = 0; i < bandBins.length; i++) {
        const [lo, hi] = bandBins[i];
        let peak = 0;
        for (let b = lo; b <= hi && b < freq.length; b++) if (freq[b] > peak) peak = freq[b];
        const v = Math.min(1, peak / 200);
        bandOut[i] = Math.max(v, bandOut[i] * .72);
      }
      return bandOut;
    },
    dispose() { try { src.disconnect(); } catch {} },
  };
}

// ---------------------------------------------------------------- local media
const media = navigator.mediaDevices;
S.audioFx = { echo: true, ns: true, agc: true, ai: false, gain: 1, duck: true, duckLevel: 0.2, duckRelease: 'normal', autoMute: true, autoMuteSec: 30, ...store.get('audioFx', {}) };
S.videoFx = { effect: 'none', bright: 0, contrast: 1, sat: 1, key: '#00ff00', tol: 0.1, spill: 0.85, edge: 0.1, blur: 1, fps: 30, mirror: true, ...store.get('videoFx', {}) };
function camConstraints() {
  const h = Number(S.prefs.quality) || 720;
  return { width: { ideal: Math.round(h * 16 / 9) }, height: { ideal: h }, frameRate: { ideal: Number(S.videoFx.fps) || 30 }, ...(S.prefs.camId ? { deviceId: { exact: S.prefs.camId } } : {}) };
}
function micConstraints() {
  const a = S.audioFx;
  return { echoCancellation: a.echo, noiseSuppression: a.ns, autoGainControl: a.agc, channelCount: 1, ...(S.prefs.micId ? { deviceId: { exact: S.prefs.micId } } : {}) };
}
function mediaErr(e) {
  if (!window.isSecureContext) return 'Camera needs HTTPS or localhost.';
  if (e?.name === 'NotAllowedError') return 'Permission was blocked. Allow it from the address bar.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No device found.';
  if (e?.name === 'NotReadableError') return 'The device is busy in another app.';
  return e?.message || 'Unavailable';
}
async function startCam() {
  if (S.local.cam) return S.local.cam;
  if (!media?.getUserMedia) { S.local.camError = 'Camera needs HTTPS or localhost.'; return null; }
  try {
    const s = await media.getUserMedia({ video: camConstraints() }).catch((e) => {
      if (S.prefs.camId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { S.prefs.camId = ''; return media.getUserMedia({ video: camConstraints() }); }
      throw e;
    });
    const raw = s.getVideoTracks()[0];
    raw.contentHint = 'motion';
    S.local.camRaw = raw;
    S.local.camError = '';
    raw.onended = () => { if (S.local.camRaw !== raw) return; stopCam(); if (S.local.camOn) { S.local.camOn = false; syncMedia(); toast('Your camera disconnected.', { err: true }); } };
    await applyVideoFx();
    listDevices();
    return S.local.cam;
  } catch (e) { S.local.camError = mediaErr(e); return null; }
}
function stopCam() { vfx?.stop(); vfx = null; S.local.camRaw?.stop(); S.local.camRaw = null; S.local.cam = null; }
// Background effects and light correction run in fx.js; with nothing to do, the camera track goes out untouched.
let vfx = null, fxBgImg = null;
function fxBgImage() {
  const d = store.get('fxBg', '');
  if (!d) return null;
  if (!fxBgImg || fxBgImg.dataset.src !== d) {
    fxBgImg = new Image(); fxBgImg.dataset.src = d;
    fxBgImg.onload = () => vfx?.set({ bgImage: fxBgImg });
    fxBgImg.src = d;
  }
  return fxBgImg;
}
async function applyVideoFx() {
  const raw = S.local.camRaw;
  if (!raw) { vfx?.stop(); vfx = null; S.local.cam = null; return; }
  const opts = { ...S.videoFx, bgImage: fxBgImage() };
  if (!needsProcessing(opts)) { vfx?.stop(); vfx = null; S.local.cam = raw; return; }
  if (vfx && vfx.src === raw) { vfx.set(opts); S.local.cam = vfx.track; return; }
  vfx?.stop();
  try { vfx = await createVideoFx(raw, opts); vfx.src = raw; S.local.cam = vfx.track; }
  catch (e) { vfx = null; S.local.cam = raw; toast('Video effects: ' + e.message, { err: true }); }
}
let localMeter = null;
async function startMic() {
  if (S.local.audio) return S.local.audio;
  if (!media?.getUserMedia) return null;
  try {
    const s = await media.getUserMedia({ audio: micConstraints() }).catch((e) => {
      if (S.prefs.micId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { S.prefs.micId = ''; return media.getUserMedia({ audio: micConstraints() }); }
      throw e;
    });
    S.local.audio = s.getAudioTracks()[0];
    S.local.audio.enabled = S.local.micOn;
    await applyAudioFx();
    listDevices();
    return S.local.audio;
  } catch (e) { toast('Microphone: ' + mediaErr(e), { err: true }); return null; }
}
function stopMic() { afx?.dispose(); afx = null; S.local.audioOut = null; S.local.audio?.stop(); S.local.audio = null; localMeter?.dispose(); localMeter = null; }
let afx = null, fxCtx = null;
function fxAudioCtx() {
  if (!fxCtx) { try { fxCtx = new AudioContext({ sampleRate: 48000 }); } catch { fxCtx = null; } }
  fxCtx?.resume?.().catch(() => {});
  return fxCtx;
}
const micOut = () => S.local.audioOut || S.local.audio || null;
async function applyAudioFx() {
  afx?.dispose(); afx = null; S.local.audioOut = null;
  if (S.local.audio && (S.audioFx.ai || Math.abs(S.audioFx.gain - 1) > 0.01)) {
    const ctx = S.audioFx.ai ? fxAudioCtx() : audioCtx();
    if (ctx) {
      afx = await createAudioChain(ctx, S.local.audio, { aiNoise: S.audioFx.ai, gain: S.audioFx.gain });
      S.local.audioOut = afx.track;
      if (S.audioFx.ai && !afx.ai) toast('AI noise removal is unavailable here: ' + afx.note, { err: true });
    }
  }
  localMeter?.dispose(); localMeter = S.local.audio ? meter(micOut()) : null;
}
const outVideo = () => (S.local.camOn ? S.local.cam : null);

async function setMic(on, opts = {}) {
  S.local.micOn = on;
  if (on) {
    S.local.autoMuted = false;
    resetAutoMuteTimer();
    if (!S.local.audio) await startMic();
  }
  if (!on && S.local.audio) stopMic(); // muting releases the microphone, so the browser's mic indicator goes off
  if (on && !S.local.audio) S.local.micOn = false;
  if (!on && !opts.auto) S.local.autoMuted = false;
  syncMedia();
  syncCaptions();
}
async function setCam(on) {
  if (on) { await startCam(); if (!S.local.cam) { toast('Camera: ' + S.local.camError, { err: true }); on = false; } }
  else stopCam(); // turn the hardware light off
  S.local.camOn = on;
  syncMedia();
}
/** Push current local tracks to every peer and refresh UI. No renegotiation needed. */
function syncMedia() {
  const v = outVideo();
  for (const p of S.peers.values()) {
    p.aT?.sender.replaceTrack(outAudio()).catch(() => {});
    p.vT?.sender.replaceTrack(v || null).catch(() => {});
    p.pT?.sender.replaceTrack(presTrack()).catch(() => {});
  }
  const me = $('#card-' + cssId(myId()));
  const el = me && $('video', me);
  if (el) { const cur = el.srcObject?.getVideoTracks()[0]; if (cur !== v) el.srcObject = v ? new MediaStream([v]) : null; el.classList.toggle('mirror', !!S.videoFx.mirror); }
  sendMeta({ mic: S.local.micOn, cam: S.local.camOn, sharing: !!S.local.pres });
  renderDock(); renderCrew(); renderPreview(); renderPresBar();
}

async function listDevices() {
  if (!media?.enumerateDevices) return;
  const devs = await media.enumerateDevices();
  fill($('#camSelect'), devs.filter((d) => d.kind === 'videoinput'), S.local.camRaw?.getSettings().deviceId || S.prefs.camId, 'camera');
  fill($('#micSelect'), devs.filter((d) => d.kind === 'audioinput'), S.local.audio?.getSettings().deviceId || S.prefs.micId, 'microphone');
  function fill(sel, list, cur, kind) {
    replaceKids(sel, new Option(`Default ${kind}`, ''), ...list.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => new Option(d.label || `${kind[0].toUpperCase() + kind.slice(1)} ${i + 1}`, d.deviceId)));
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : '';
  }
}
media?.addEventListener?.('devicechange', listDevices);

// ---------------------------------------------------------------- presentation: screen, video file, PDF
// Each connection carries a second video track for whatever is being presented,
// so cameras stay visible while a screen, video or slide deck is on stage.
const PRES_W = 1920, PRES_H = 1080;
const presTrack = () => S.local.pres?.track || null;

// Outgoing audio: the raw mic, or mic + media audio (a video's sound, background music, a tab's sound) while one plays.
let sendMix = null;
function outAudio() {
  if (!S.local.mediaAudio) return micOut();
  const ctx = audioCtx();
  if (!sendMix) sendMix = { dest: ctx.createMediaStreamDestination(), micSrc: null, micTrack: null };
  if (!duckToSend && duckBus) { duckBus.connect(sendMix.dest); duckToSend = true; }
  if (sendMix.micTrack !== micOut()) {
    try { sendMix.micSrc?.disconnect(); } catch {}
    sendMix.micSrc = micOut() ? ctx.createMediaStreamSource(new MediaStream([micOut()])) : null;
    sendMix.micSrc?.connect(sendMix.dest);
    sendMix.micTrack = micOut();
  }
  return sendMix.dest.stream.getAudioTracks()[0];
}
function syncOutgoingAudio() {
  const a = outAudio();
  for (const p of S.peers.values()) p.aT?.sender.replaceTrack(a).catch(() => {});
}
function mixInMedia(node, opts = {}) {
  const duck = opts.duck !== false;
  const monitor = !!opts.monitor;
  S.local.mediaAudio = (S.local.mediaAudio || 0) + 1;
  outAudio();
  if (duck) {
    node.connect(duckBus);
    if (monitor) node.connect(duckMonBus);
  } else {
    node.connect(mixBus);
    node.connect(sendMix.dest);
    if (monitor) node.connect(audioCtx().destination);
  }
  updateDucking(true);
  return {
    dispose() {
      try { node.disconnect(); } catch {}
      S.local.mediaAudio = Math.max(0, (S.local.mediaAudio || 0) - 1);
      updateDucking(true);
    },
  };
}

// Auto-ducking: smoothly attenuates background music and media tracks whenever any participant speaks.
const DUCK_SPEECH_RMS = 0.018;
const DUCK_HOLD_MS = 520;
const DUCK_RELEASE_TAU = { fast: 0.22, normal: 0.55, slow: 1.1 };
const duckState = { active: false, lastSpeech: -1e9, target: 1, tau: 0.05, curGain: 1, lastTick: 0 };
function anySpeakerActive() {
  if (S.local.micOn && S.local.audio && (localMeter?.level() || 0) > DUCK_SPEECH_RMS) return true;
  if (S.studio) {
    for (const p of S.peers.values()) if (p.mic && (p.meters[0]?.level() || 0) > DUCK_SPEECH_RMS) return true;
  }
  return false;
}
function updateDucking(force = false) {
  const now = performance.now();
  if (!force && now - duckState.lastTick < 25) return;
  if (anySpeakerActive()) duckState.lastSpeech = now;
  const enabled = S.audioFx.duck !== false;
  const speakingNow = (now - duckState.lastSpeech) < DUCK_HOLD_MS;
  const lvl = Math.max(0.05, Math.min(0.75, Number(S.audioFx.duckLevel) || 0.2));
  const target = enabled && speakingNow ? lvl : 1;
  const tau = target < duckState.target ? 0.045 : (DUCK_RELEASE_TAU[S.audioFx.duckRelease] || 0.55);
  duckState.active = enabled && speakingNow;
  if (actx && duckBus && duckMonBus && (force || target !== duckState.target || tau !== duckState.tau)) {
    const t = actx.currentTime;
    duckBus.gain.cancelScheduledValues(t);
    duckBus.gain.setTargetAtTime(target, t, tau);
    duckMonBus.gain.cancelScheduledValues(t);
    duckMonBus.gain.setTargetAtTime(target, t, tau);
  }
  duckState.target = target;
  duckState.tau = tau;
  const dt = Math.min(0.1, Math.max(0, (now - (duckState.lastTick || now)) / 1000));
  duckState.lastTick = now;
  duckState.curGain += (target - duckState.curGain) * (1 - Math.exp(-dt / Math.max(0.02, tau)));
  if (Math.abs(target - duckState.curGain) < 0.004) duckState.curGain = target;
  renderDuckIndicators();
}
let lastDuckUi = { pct: -1, on: null, act: null };
function renderDuckIndicators() {
  const enabled = S.audioFx.duck !== false;
  const hasMedia = (S.local.mediaAudio || 0) > 0;
  const pct = Math.round(duckState.curGain * 100);
  const presDuck = $('#presDuck');
  if (presDuck) {
    const showPresDuck = enabled && duckState.active && hasMedia && !!S.local.pres && (S.local.pres.kind === 'video' || !!S.local.pres.hasAudio);
    if (presDuck.hidden === showPresDuck) presDuck.hidden = !showPresDuck;
  }
  const musicActive = !!(bgMusic?.el && !bgMusic.el.paused);
  const mPill = $('#musicDuckPill');
  if (mPill) {
    const showMPill = enabled && duckState.active && musicActive;
    if (mPill.hidden === showMPill) mPill.hidden = !showMPill;
    $('#musicPlayer')?.classList.toggle('ducking', showMPill);
    if (musicActive && $('#musicState')) {
      const txt = showMPill ? 'Playing · ducked' : 'Playing';
      if ($('#musicState').textContent !== txt) $('#musicState').textContent = txt;
    }
  }
  const mBar = $('#musicDuckBar');
  if (mBar && musicActive) mBar.style.width = Math.round(duckState.curGain * (bgMusic?.vol ?? 0.7) * 100) + '%';
  else if (mBar && lastDuckUi.pct !== pct) mBar.style.width = '0%';
  if ($('#settingsDlg')?.open && (lastDuckUi.pct !== pct || lastDuckUi.on !== enabled || lastDuckUi.act !== duckState.active)) {
    lastDuckUi = { pct, on: enabled, act: duckState.active };
    $('#duckGroup')?.classList.toggle('ducking', enabled && duckState.active);
    const fill = $('#duckMeterFill'); if (fill) fill.style.width = pct + '%';
    const pctEl = $('#duckMeterPct'); if (pctEl) pctEl.textContent = pct + '%';
    const pill = $('#duckLivePill');
    if (pill) {
      pill.textContent = !enabled ? 'Off' : duckState.active ? 'Ducking' : 'Ready';
      pill.className = 'pill caps' + (!enabled ? '' : duckState.active ? ' warn' : ' ok');
    }
  }
}

// Auto-mute on silence: mutes inactive participants after a configured silence window to keep background noise out of the studio mix.
const SILENCE_SPEECH_RMS = 0.018;
const SILENCE_HOLD_MS = 100;
const autoMuteState = { lastSpeech: 0, speechMs: 0, lastTick: 0, peerLastSpeech: new Map(), peerSpeechMs: new Map(), peerMutedAt: new Map() };
const fmtSec = (sec) => {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
};
function resetAutoMuteTimer() {
  const now = performance.now();
  autoMuteState.lastSpeech = now;
  autoMuteState.speechMs = 0;
}
function effectiveLocalAutoMute() {
  const pOn = S.audioFx.autoMute !== false;
  const pSec = Math.max(10, Math.min(300, Number(S.audioFx.autoMuteSec) || 30));
  const st = S.studio ? S.state?.autoMute : null;
  const stApplies = !!(st?.on && (st.scope === 'all' || !isHost()));
  const stSec = Math.max(10, Math.min(300, Number(st?.sec) || 30));
  if (stApplies && pOn) {
    const sec = Math.min(pSec, stSec);
    return { on: true, ms: sec * 1000, sec, source: stSec <= pSec ? 'studio' : 'personal' };
  }
  if (stApplies) return { on: true, ms: stSec * 1000, sec: stSec, source: 'studio' };
  if (pOn) return { on: true, ms: pSec * 1000, sec: pSec, source: 'personal' };
  return { on: false, ms: 0, sec: pSec, source: 'off' };
}
let lastAutoMuteUi = { pct: -1, label: '', cls: '', count: '' };
function renderAutoMuteIndicators(now = performance.now()) {
  if (!$('#settingsDlg')?.open) return;
  const eff = effectiveLocalAutoMute();
  const enabled = S.audioFx.autoMute !== false;
  const inStudio = !!S.studio && S.phase === 'online';
  const micActive = !!(S.local.micOn && S.local.audio);
  let pct = 0, label = 'Ready', cls = 'ok', count = '0s', imminent = false;
  if (!eff.on) {
    label = 'Off'; cls = ''; count = 'Off';
  } else if (!inStudio) {
    label = enabled ? 'Ready' : 'Studio off'; cls = 'ok'; count = fmtSec(eff.sec);
  } else if (!micActive) {
    label = S.local.autoMuted ? 'Auto-muted' : 'Muted';
    cls = S.local.autoMuted ? 'warn' : '';
    count = S.local.autoMuted ? 'Muted' : '—';
  } else {
    const silentMs = autoMuteState.lastSpeech ? Math.max(0, now - autoMuteState.lastSpeech) : 0;
    const remSec = Math.max(0, Math.ceil((eff.ms - silentMs) / 1000));
    pct = Math.min(100, Math.round((silentMs / eff.ms) * 100));
    if (silentMs < 800) { label = 'Active'; cls = 'ok'; count = fmtSec(eff.sec); }
    else if (remSec <= 5) { label = 'Muting soon'; cls = 'warn'; count = `${remSec}s`; imminent = true; }
    else { label = eff.source === 'studio' ? 'Studio rule' : 'Silent'; cls = 'ok'; count = `${remSec}s`; }
  }
  if (lastAutoMuteUi.pct !== pct || lastAutoMuteUi.label !== label || lastAutoMuteUi.cls !== cls || lastAutoMuteUi.count !== count) {
    lastAutoMuteUi = { pct, label, cls, count };
    $('#autoMuteGroup')?.classList.toggle('imminent', imminent);
    const fill = $('#autoMuteMeterFill'); if (fill) fill.style.width = pct + '%';
    const cd = $('#autoMuteCountdown'); if (cd) cd.textContent = count;
    const pill = $('#autoMutePill');
    if (pill) { pill.textContent = label; pill.className = 'pill caps' + (cls ? ' ' + cls : ''); }
  }
}
function updateAutoMute(force = false) {
  const now = performance.now();
  if (!force && now - autoMuteState.lastTick < 100) return;
  const dt = autoMuteState.lastTick ? Math.min(500, Math.max(0, now - autoMuteState.lastTick)) : 0;
  autoMuteState.lastTick = now;

  // Prune disconnected peers.
  for (const id of autoMuteState.peerLastSpeech.keys()) {
    if (!S.peers.has(id)) {
      autoMuteState.peerLastSpeech.delete(id);
      autoMuteState.peerSpeechMs.delete(id);
      autoMuteState.peerMutedAt.delete(id);
    }
  }

  // Local participant silence detection (only inside an active studio).
  if (!S.studio || S.phase !== 'online' || !S.local.micOn || !S.local.audio) {
    autoMuteState.lastSpeech = now;
    autoMuteState.speechMs = 0;
  } else {
    const lvl = localMeter?.level() || 0;
    if (lvl > SILENCE_SPEECH_RMS) {
      autoMuteState.speechMs += dt;
      if (lvl > 0.035 || autoMuteState.speechMs >= SILENCE_HOLD_MS) autoMuteState.lastSpeech = now;
    } else {
      autoMuteState.speechMs = 0;
    }
    const eff = effectiveLocalAutoMute();
    if (eff.on && autoMuteState.lastSpeech && (now - autoMuteState.lastSpeech) >= eff.ms) {
      S.local.autoMuted = true;
      autoMuteState.lastSpeech = now;
      autoMuteState.speechMs = 0;
      setMic(false, { auto: true });
      toast(`Muted after ${fmtSec(eff.sec)} of silence to keep background noise out.`, { action: ['Unmute', () => setMic(true)], ms: 7000 });
    }
  }

  // Host backup monitoring for remote peers when studio-wide auto-mute is enabled.
  if (S.studio && S.phase === 'online' && isHost() && S.state?.autoMute?.on) {
    const stSec = Math.max(10, Math.min(300, Number(S.state.autoMute.sec) || 30));
    const stMs = stSec * 1000;
    for (const p of S.peers.values()) {
      if (!p.mic || p.peer?.conn !== 'connected' || !p.meters[0]) {
        autoMuteState.peerLastSpeech.set(p.id, now);
        autoMuteState.peerSpeechMs.set(p.id, 0);
        continue;
      }
      const plvl = p.meters[0].level() || 0;
      if (plvl > SILENCE_SPEECH_RMS) {
        const ms = (autoMuteState.peerSpeechMs.get(p.id) || 0) + dt;
        autoMuteState.peerSpeechMs.set(p.id, ms);
        if (plvl > 0.035 || ms >= SILENCE_HOLD_MS) autoMuteState.peerLastSpeech.set(p.id, now);
      } else {
        autoMuteState.peerSpeechMs.set(p.id, 0);
      }
      const last = autoMuteState.peerLastSpeech.get(p.id) || now;
      if (now - last >= stMs + 2500 && now - (autoMuteState.peerMutedAt.get(p.id) || -1e9) > 8000) {
        autoMuteState.peerMutedAt.set(p.id, now);
        autoMuteState.peerLastSpeech.set(p.id, now);
        wsSend({ type: 'mute', id: p.id, reason: 'silence' });
        toast(`Auto-muted ${p.name} after ${fmtSec(stSec)} of silence.`);
      }
    }
  }

  renderAutoMuteIndicators(now);
}

function startPresentation(pres) {
  if (S.local.pres) S.local.pres.stop();
  S.local.pres = pres;
  syncMedia();
  autoPresentScene(myId());
}
function stopPresentation() {
  const pres = S.local.pres;
  if (!pres) return;
  S.local.pres = null;
  pres.stop();
  syncMedia();
  autoEndPresentScene();
}
/** Share a screen, or (game) a game window: 60 fps, up to 1080p, encoded for motion rather than sharp text. */
async function presentScreen(game = false) {
  if (!media?.getDisplayMedia) return toast('Screen sharing is not supported in this browser.', { err: true });
  try {
    const s = await media.getDisplayMedia({ video: game ? { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { frameRate: { ideal: 30 } }, audio: true, systemAudio: 'include' });
    const track = s.getVideoTracks()[0];
    track.contentHint = game ? 'motion' : 'detail';
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = new MediaStream([track]);
    $('#mediaSink').append(v); v.play().catch(() => {});
    const at = s.getAudioTracks()[0];
    const audio = at ? mixInMedia(audioCtx().createMediaStreamSource(new MediaStream([at]))) : null;
    track.onended = stopPresentation;
    startPresentation({ kind: 'screen', game, hasAudio: !!at, name: track.label || (game ? 'Game' : 'Screen'), track, source: v, stop() { s.getTracks().forEach((t) => t.stop()); v.remove(); audio?.dispose(); } });
    toast(game ? `Game mode: 60 fps${at ? ' with game sound' : ''}. Pick “Game + facecam” for your camera in the corner.` : at ? 'Sharing your screen with its sound.' : 'Sharing your screen.');
  } catch (e) { if (e?.name !== 'NotAllowedError') toast('Screen share: ' + mediaErr(e), { err: true }); }
}
function presCanvas() { const c = document.createElement('canvas'); c.width = PRES_W; c.height = PRES_H; return c; }
function fitDraw(cg, src, sw, sh, bg = '#05070d') {
  cg.fillStyle = bg; cg.fillRect(0, 0, PRES_W, PRES_H);
  if (!sw || !sh) return;
  const k = Math.min(PRES_W / sw, PRES_H / sh), dw = sw * k, dh = sh * k;
  cg.drawImage(src, (PRES_W - dw) / 2, (PRES_H - dh) / 2, dw, dh);
}
async function presentVideo(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.src = url; v.playsInline = true; v.preload = 'auto';
  const ctx = audioCtx();
  const src = ctx.createMediaElementSource(v);
  const audio = mixInMedia(src, { monitor: true });
  const c = presCanvas(), cg = c.getContext('2d');
  const track = c.captureStream(30).getVideoTracks()[0];
  track.contentHint = 'motion';
  try { await v.play(); } catch {}
  startPresentation({
    kind: 'video', name: file.name, track, source: c, video: v,
    draw() { fitDraw(cg, v, v.videoWidth, v.videoHeight); },
    stop() { v.pause(); audio.dispose(); try { src.disconnect(); } catch {} URL.revokeObjectURL(url); track.stop(); },
  });
  v.onended = () => renderPresBar();
}
/**
 * Instant replay: the last 30 s of the program (from the clip buffer's 5-second segments) plays on stage as a
 * presentation, with a REPLAY badge and a progress line, then the scene comes back by itself. Muted, so voices from
 * a moment ago don't talk over the host.
 */
async function presentReplay(sec = 30) {
  if (!isHost()) return;
  const clips = window.__gatherClips;
  const blobs = clips?.recent?.(sec * 1000) || [];
  if (!blobs.length) return toast(clips?.running ? 'Replay is warming up: it has the last 30 s after you’ve been here a few seconds.' : 'Replay works while you’re in your studio as host.', { err: true });
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto';
  const c = presCanvas(), cg = c.getContext('2d');
  const track = c.captureStream(30).getVideoTracks()[0];
  track.contentHint = 'motion';
  const urls = blobs.map((b) => URL.createObjectURL(b));
  let i = 0, over = false;
  const accent = accentOf();
  const pres = {
    kind: 'replay', name: `Replay · last ${sec} s`, track, source: c, video: v, replay: true,
    draw() {
      fitDraw(cg, v, v.videoWidth, v.videoHeight);
      // REPLAY badge and how far through we are
      cg.save();
      cg.font = '800 34px Inter, sans-serif'; cg.textBaseline = 'middle';
      const label = '↺  REPLAY', w = cg.measureText(label).width + 44;
      const by = PRES_H - 112; // bottom-left: the top-left belongs to the "is presenting" label
      cg.fillStyle = 'rgba(6,10,22,.72)'; cg.beginPath(); cg.roundRect(40, by, w, 64, 32); cg.fill();
      cg.fillStyle = accent; cg.beginPath(); cg.arc(72, by + 32, 9, 0, Math.PI * 2); cg.fill();
      cg.fillStyle = '#fff'; cg.fillText(label, 92, by + 33);
      const seg = Math.min(1, (v.currentTime || 0) / 5), p = Math.min(1, (Math.max(0, i - 1) + seg) / urls.length);
      cg.fillStyle = 'rgba(255,255,255,.18)'; cg.fillRect(0, PRES_H - 8, PRES_W, 8);
      cg.fillStyle = accent; cg.fillRect(0, PRES_H - 8, PRES_W * p, 8);
      cg.restore();
    },
    stop() { over = true; v.pause(); v.removeAttribute('src'); urls.forEach((u) => URL.revokeObjectURL(u)); track.stop(); },
  };
  const playNext = () => {
    if (over) return;
    if (i >= urls.length) { if (S.local.pres === pres) { stopPresentation(); toast('Replay done: back to the show.'); } return; }
    v.src = urls[i++]; v.play().catch(() => {});
  };
  v.onended = playNext; v.onerror = playNext;
  playNext();
  startPresentation(pres);
  toast(`Replaying the last ${sec} seconds.`, { ms: 2200 });
}
window.__gatherReplay = presentReplay;
let pdfLib = null;
function loadPdfJs() {
  if (pdfLib) return pdfLib;
  pdfLib = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'; res(window.pdfjsLib); };
    sc.onerror = () => { pdfLib = null; rej(new Error('Could not load the PDF reader. Check your connection.')); };
    document.head.append(sc);
  });
  return pdfLib;
}
async function presentPDF(file) {
  if (!file) return;
  toast('Opening ' + file.name + '…');
  try {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const c = presCanvas(), cg = c.getContext('2d');
    const page = document.createElement('canvas'); // the rendered slide, repainted onto c every frame
    const track = c.captureStream(15).getVideoTracks()[0];
    track.contentHint = 'detail';
    const pres = {
      kind: 'pdf', name: file.name, page: 1, pages: doc.numPages, track, source: c,
      draw() { fitDraw(cg, page, page.width, page.height, '#0b0f1a'); },
      // Fast next/previous presses: each request renders into its own canvas and cancels the one before,
      // and only the newest finished page is shown (pdf.js can't render twice into one canvas at once).
      async go(n) {
        n = Math.max(1, Math.min(doc.numPages, n));
        pres.page = n; renderPresBar();
        const ticket = ++pres.ticket;
        try { pres.task?.cancel(); } catch {}
        const pg = await doc.getPage(n);
        if (ticket !== pres.ticket) return;
        const base = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: Math.min(PRES_W / base.width, PRES_H / base.height) * 1.5 });
        const off = document.createElement('canvas'); off.width = Math.round(vp.width); off.height = Math.round(vp.height);
        pres.task = pg.render({ canvasContext: off.getContext('2d'), viewport: vp });
        try { await pres.task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
        if (ticket !== pres.ticket) return;
        page.width = off.width; page.height = off.height; page.getContext('2d').drawImage(off, 0, 0);
        renderPresBar();
      },
      ticket: 0, task: null,
      stop() { track.stop(); doc.destroy(); },
    };
    await pres.go(1);
    startPresentation(pres);
  } catch (e) { toast('PDF: ' + (e.message || 'could not open that file'), { err: true }); }
}

// Background music player (plays audio tracks into the studio mix alongside any camera or presentation)
const bgMusic = { el: null, src: null, gain: null, mix: null, url: '', name: '', vol: Number(store.get('musicVol', 0.7)) || 0.7, loop: true };
function ensureBgMusic() {
  const ctx = audioCtx();
  if (!bgMusic.el) {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.loop = bgMusic.loop;
    a.addEventListener('play', () => {
      if (!bgMusic.mix && bgMusic.gain) { bgMusic.mix = mixInMedia(bgMusic.gain, { monitor: true }); syncOutgoingAudio(); }
      renderBgMusic();
    });
    const onStop = () => {
      if (bgMusic.mix) { bgMusic.mix.dispose(); bgMusic.mix = null; syncOutgoingAudio(); }
      renderBgMusic();
    };
    a.addEventListener('pause', onStop);
    a.addEventListener('ended', onStop);
    a.addEventListener('timeupdate', renderBgMusic);
    a.addEventListener('loadedmetadata', renderBgMusic);
    bgMusic.el = a;
    bgMusic.src = ctx.createMediaElementSource(a);
    bgMusic.gain = ctx.createGain();
    bgMusic.gain.gain.value = bgMusic.vol;
    bgMusic.src.connect(bgMusic.gain);
  }
  return bgMusic;
}
async function playBgMusicFile(file) {
  if (!file) return;
  const m = ensureBgMusic();
  if (m.mix) { m.mix.dispose(); m.mix = null; syncOutgoingAudio(); }
  m.el.pause();
  if (m.url) URL.revokeObjectURL(m.url);
  m.url = URL.createObjectURL(file);
  m.name = file.name.replace(/\.[^.]+$/, '') || file.name;
  m.el.src = m.url;
  m.el.loop = m.loop;
  try { await m.el.play(); } catch {}
  if (isHost()) { setTab('music'); if ($('#musicSec')) $('#musicSec').open = true; }
  renderBgMusic();
}
function stopBgMusic(clearTrack = false) {
  if (!bgMusic.el) return;
  bgMusic.el.pause();
  if (bgMusic.mix) { bgMusic.mix.dispose(); bgMusic.mix = null; syncOutgoingAudio(); }
  if (clearTrack) {
    bgMusic.el.removeAttribute('src'); bgMusic.el.load();
    if (bgMusic.url) { URL.revokeObjectURL(bgMusic.url); bgMusic.url = ''; }
    bgMusic.name = '';
  }
  renderBgMusic();
}
function renderBgMusic() {
  const loaded = !!bgMusic.name;
  $('#musicPlayer').hidden = !loaded;
  $('#musicClear').hidden = !loaded;
  const playing = !!(loaded && bgMusic.el && !bgMusic.el.paused);
  $('#musicState').textContent = !loaded ? '' : playing ? (duckState.active && S.audioFx.duck !== false ? 'Playing · ducked' : 'Playing') : 'Paused';
  if (!loaded) { $('#musicDuckBar').style.width = '0%'; return; }
  $('#musicName').textContent = bgMusic.name;
  $('#musicPlay').textContent = playing ? 'Pause' : 'Play';
  $('#musicLoop').setAttribute('aria-pressed', String(bgMusic.loop));
  $('#musicVol').value = String(bgMusic.vol);
  $('#musicVolVal').textContent = Math.round(bgMusic.vol * 100) + '%';
  const cur = bgMusic.el.currentTime || 0, dur = bgMusic.el.duration || 0;
  $('#musicTime').textContent = `${fmtTime(cur * 1000)} / ${fmtTime(dur * 1000)}`;
  if (document.activeElement !== $('#musicSeek')) $('#musicSeek').value = dur ? String(cur / dur) : '0';
  renderDuckIndicators();
}
$('#musicPick').onclick = () => $('#musicFile').click();
$('#musicFile').onchange = (e) => { playBgMusicFile(e.target.files[0]); e.target.value = ''; };
$('#musicClear').onclick = () => stopBgMusic(true);
$('#musicPlay').onclick = async () => {
  if (!bgMusic.el || !bgMusic.name) return;
  if (bgMusic.el.paused) { audioCtx(); try { await bgMusic.el.play(); } catch {} }
  else bgMusic.el.pause();
  renderBgMusic();
};
$('#musicLoop').onclick = () => { bgMusic.loop = !bgMusic.loop; if (bgMusic.el) bgMusic.el.loop = bgMusic.loop; renderBgMusic(); };
$('#musicSeek').oninput = (e) => { if (bgMusic.el?.duration) bgMusic.el.currentTime = Number(e.target.value) * bgMusic.el.duration; };
$('#musicVol').oninput = (e) => {
  bgMusic.vol = Number(e.target.value);
  store.set('musicVol', bgMusic.vol);
  if (bgMusic.gain) bgMusic.gain.gain.value = bgMusic.vol;
  $('#musicVolVal').textContent = Math.round(bgMusic.vol * 100) + '%';
};
$('#musicDuckSettings').onclick = () => {
  openDlg('settingsDlg');
  setTimeout(() => { $('#duckChk')?.scrollIntoView({ behavior: smooth(), block: 'center' }); $('#duckChk')?.focus(); }, 100);
};
renderBgMusic();

// Present menu + presenter controls
$('#shareBtn').onclick = (ev) => {
  if (S.local.pres) return stopPresentation();
  togglePopover($('#presentMenu'), ev.currentTarget, 'top');
};
$('#presentMenu').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-present]'); if (!b) return;
  $('#presentMenu').hidePopover();
  const kind = b.dataset.present;
  if (kind === 'screen') presentScreen();
  if (kind === 'game') presentScreen(true);
  if (kind === 'video') $('#videoFile').click();
  if (kind === 'replay') presentReplay();
  if (kind === 'music') {
    if (bgMusic.name) { setTab('music'); if ($('#musicSec')) { $('#musicSec').open = true; $('#musicSec').scrollIntoView({ behavior: smooth(), block: 'nearest' }); } }
    else $('#musicFile').click();
  }
  if (kind === 'pdf') $('#pdfFile').click();
  if (kind === 'image') $('#imageFile').click();
  if (kind === 'ai') { setTab('ai'); $('#aiInput').focus(); }
});
$('#videoFile').onchange = (e) => { presentVideo(e.target.files[0]); e.target.value = ''; };
$('#pdfFile').onchange = (e) => { presentPDF(e.target.files[0]); e.target.value = ''; };
function renderPresBar() {
  const bar = $('#presBar'), pres = S.local.pres;
  bar.hidden = !pres;
  if (!pres) return;
  bar.dataset.kind = pres.kind;
  $('#presKind').textContent = { screen: 'Screen', video: 'Video', pdf: 'Slides', replay: 'Replay' }[pres.kind];
  $('#presName').textContent = pres.name;
  $('#presPdf').hidden = pres.kind !== 'pdf';
  $('#presVid').hidden = pres.kind !== 'video';
  if (pres.kind === 'pdf') $('#presPage').textContent = `${pres.page} / ${pres.pages}`;
  if (pres.kind === 'video') {
    const v = pres.video;
    $('#presPlay').textContent = v.paused ? 'Play' : 'Pause';
    $('#presTime').textContent = `${fmtTime(v.currentTime * 1000)} / ${fmtTime((v.duration || 0) * 1000)}`;
    if (document.activeElement !== $('#presSeek')) $('#presSeek').value = v.duration ? String(v.currentTime / v.duration) : '0';
    $('#presLoop').setAttribute('aria-pressed', String(v.loop));
  }
  renderDuckIndicators();
}
$('#presPrev').onclick = () => S.local.pres?.go?.(S.local.pres.page - 1);
$('#presNext').onclick = () => S.local.pres?.go?.(S.local.pres.page + 1);
$('#presPlay').onclick = () => { const v = S.local.pres?.video; if (!v) return; v.paused ? v.play() : v.pause(); renderPresBar(); };
$('#presSeek').oninput = (e) => { const v = S.local.pres?.video; if (v?.duration) v.currentTime = Number(e.target.value) * v.duration; };
$('#presLoop').onclick = () => { const v = S.local.pres?.video; if (v) { v.loop = !v.loop; renderPresBar(); } };
$('#presStop').onclick = stopPresentation;
setInterval(() => { if (S.local.pres?.kind === 'video') renderPresBar(); }, 250);

// ---------------------------------------------------------------- signaling (HTTP + adaptive polling; runs on Vercel)
async function api(action, body) {
  let res;
  try { res = await fetch('/api/studio?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  catch { const e = new Error('Could not reach the studio server. Check your connection and try again.'); e.status = 0; throw e; }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const hint = res.status === 404 ? 'The studio API was not found (404). In Vercel, check that the deployment includes the api folder, then redeploy.'
      : `The studio server answered ${res.status}. Check the function logs in Vercel.`;
    const e = new Error(data.error || hint); e.status = res.status; throw e;
  }
  return data;
}
const creds = () => ({ studio: S.studio, id: S.id, tok: S.tok });
/** A random id this browser keeps (local only, never synced or shown), so a removed guest can't walk back in. */
function deviceId() {
  let d = store.get('dev', '');
  if (!/^[a-f0-9]{24}$/.test(d)) { d = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join(''); store.set('dev', d); }
  return d;
}
// Outgoing messages are batched: a burst of ICE candidates becomes one request.
let outbox = [], flushT = null, flushing = false;
function wsSend(m) {
  if (!S.studio) return;
  outbox.push(m);
  if (!flushT && !flushing) flushT = setTimeout(flush, m.type === 'signal' ? 40 : 0);
}
async function flush() {
  flushT = null;
  if (!S.studio) { outbox = []; return; }
  if (!outbox.length) return;
  flushing = true;
  const ops = outbox.splice(0, 100);
  try {
    const r = await api('send', { ...creds(), ops });
    // The host's own state is authoritative locally; applying the echo could undo edits made since.
    for (const m of r.results || []) if (m.type !== 'state') onServer(m);
  } catch (e) {
    flushing = false;
    if (e.status === 403) return kickedOut(e.message);
    if (e.status === 410) return lostStudio();
    outbox.unshift(...ops); flushT = setTimeout(flush, 1000); return;
  }
  flushing = false;
  if (outbox.length && !flushT) flushT = setTimeout(flush, 0);
}
const sig = (to, data) => wsSend({ type: 'signal', to, data });
function sendMeta(m) { if (S.studio) wsSend({ type: 'meta', ...m }); }

let pollGen = 0;
async function pollLoop(gen) {
  let lastBeat = Date.now(), fails = 0;
  while (gen === pollGen && S.studio) {
    const beat = Date.now() - lastBeat > 4000;
    let n = 0;
    try {
      const r = await api('poll', { ...creds(), beat });
      if (gen !== pollGen) return;
      if (beat) lastBeat = Date.now();
      n = r.msgs.length;
      for (const m of r.msgs) await onServer(m);
      if (fails) { fails = 0; setPhase('online'); }
    } catch (e) {
      if (gen !== pollGen) return;
      if (e.status === 403) return kickedOut(e.message);
      if (e.status === 410) return lostStudio();
      if (++fails === 2) setPhase('reconnecting');
    }
    const negotiating = [...S.peers.values()].some((p) => p.conn !== 'connected');
    const wait = fails ? Math.min(8000, 500 * 2 ** fails) : n ? 120 : negotiating ? 300 : document.hidden ? 2500 : 1000;
    await new Promise((r) => setTimeout(r, wait));
  }
}
function lostStudio() {
  // Our membership expired (a sleeping laptop, a long network drop). Rejoin the same studio.
  const code = S.studio;
  pollGen++; outbox = [];
  teardownPeers();
  S.studio = null; S.id = null; S.tok = null; S.short = ""; S.shortInvite = "";
  setPhase('reconnecting');
  setTimeout(() => join(code).catch((e) => { if (e.status === 403) return kickedOut(e.message); toast(e.message, { err: true }); setPhase('offline'); }), 800);
}
function beaconLeave(why) {
  if (!S.studio) return;
  const body = JSON.stringify({ ...creds(), why }); // why 'left' (the Leave button) hands the host seat over for good
  pollGen++;
  if (!(navigator.sendBeacon && navigator.sendBeacon('/api/studio?action=leave', new Blob([body], { type: 'application/json' })))) api('leave', JSON.parse(body)).catch(() => {});
}
addEventListener('pagehide', () => beaconLeave());

async function iceConfig(serverIce) {
  const ice = [...(serverIce || [])];
  const url = sess.get('turnUrl', ''), user = sess.get('turnUser', ''), pass = sess.get('turnPass', '');
  if (url) {
    // A bad entry makes the browser refuse to connect at all, so check it and fall back to the built-in servers.
    const urls = url.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = urls.find((u) => !/^(stun|turns?):[^\s]+$/i.test(u));
    const needsLogin = urls.some((u) => /^turns?:/i.test(u)) && (!user || !pass);
    if (bad || needsLogin) toast(bad ? `Your TURN server “${bad}” isn’t a valid address (it should start with turn:, turns: or stun:), so it was skipped. Fix it in Settings.` : 'Your TURN server needs a username and password, so it was skipped. Add them in Settings.', { err: true, ms: 9000 });
    else ice.push({ urls, username: user || undefined, credential: pass || undefined });
  }
  S.serverIce = serverIce || [];
  return ice;
}

async function join(code, opts = {}) {
  setPhase(S.phase === 'reconnecting' ? 'reconnecting' : 'connecting');
  audioCtx();
  const pass = opts.pass || S.joinPass?.[code];
  let r;
  // Only "Create studio" may open a studio; every other path (invite links, the Join box, reconnects) joins one.
  const intent = opts.create ? 'create' : 'join';
  try { r = await api('join', { studio: code, dev: deviceId(), name: S.name || 'Guest', mic: S.local.micOn, cam: S.local.camOn, acct: acct.token || undefined, pass, callin: opts.callin || undefined, intent }); }
  catch (e) {
    if (e.status === 423 && $('#enterDlg').open) { setPhase('offline'); startKnock(code, opts.callin); return; }
    if (e.status === 404 && intent === 'join' && !opts.callin && !opts.noWait && $('#enterDlg').open) { setPhase('offline'); waitForHost(code, e.message); return; }
    if (e.status === 401) {
      setPhase('offline');
      if (acct.token || acct.user) signedOut();
      if ($('#enterDlg').open && intent === 'create') {
        $('#enterDlg').close();
        needAccountThen(() => openEnter('create', code));
        throw Object.assign(new Error(e.message), { status: 401, handled: true });
      }
    }
    if (e.status === 403) { setPhase('offline'); }
    throw e;
  }
  if (pass) (S.joinPass ||= {})[code] = pass; // a reconnect after a network drop keeps our admission
  await onServer(r);
}

async function onServer(m) {
  switch (m.type) {
    case 'joined': {
      const wasHosting = isHost() && !S.studio;
      S.id = m.id; S.tok = m.tok; S.studio = m.studio; S.host = m.host; S.short = m.short || ""; S.shortInvite = m.inviteShort || "";
      S.local.joinedAt = Date.now();
      if (S.voiceOnly && S.local.camOn) setCam(false); // joined by voice from the watch page: camera stays off
      if (wasHosting || isHost()) samChat?.onJoin();
      S.iceServers = await iceConfig(m.iceServers);
      const pre = S.state;
      S.state = m.state;
      // Clear any legacy server-saved frame border or old baked-in default overlay when rejoining an older studio.
      if (S.state?.brand && (S.state.brand.frame === 'border' || S.state.brand.frame === 'corners')) {
        S.state.brand.frame = 'none';
      }
      if (S.host === S.id && !store.get('cleanRoomOverlayV3:' + S.studio, false)) {
        store.set('cleanRoomOverlayV3:' + S.studio, true);
        if (S.state?.brand && (S.state.brand.overlay || S.state.brand.frame !== 'none')) {
          S.state.brand.overlay = '';
          S.state.brand.frame = 'none';
          setTimeout(() => { if (S.host === S.id) setStage({ brand: { overlay: '', frame: 'none' } }); }, 150);
        }
      }
      S.brief = m.brief || null;
      S.chatScope = m.state?.chatOpts?.defaultScope === 'every' ? 'every' : 'guests';
      S.pendingChatFile = null;
      setPhase('online');
      history.replaceState(null, '', '/s/' + S.studio);
      $('#enterDlg').open && $('#enterDlg').close();
      stopPreviewLoop();
      $$('#msgs > *').forEach((n) => n.remove());
      for (const msg of m.history) addMsg(msg);
      for (const p of m.peers) createPeer(p, true); // newcomer makes the offers
      pollLoop(++pollGen);
      if (S.host === S.id && wasHosting) {
        // Bring the look you set up before creating the studio.
        setStage({ aspect: pre.aspect, captions: pre.captions, autoMute: pre.autoMute, autoGrid: pre.autoGrid !== false, brand: { ...pre.brand, bgImage: '', overlay: '', logo: '' }, title: pre.title || autoTitle(), streamType: pre.streamType || 'live', hashtags: pre.hashtags || [], notices: pre.notices || [], whatNext: pre.whatNext || null, aiSpotlight: pre.aiSpotlight || null, watch: { ...WATCH_DEFAULTS, ...store.get('watchPrefs', {}) }, shop: { items: store.get('shopItems', []), pinned: '', sale: null }, layout: pre.layout, banner: pre.banner, ticker: pre.ticker, stage: [S.id], feeds: pre.feeds, scene: pre.scene || '', elements: (pre.elements || []).filter((e) => !(e?.type === 'image' && typeof e.asset === 'string' && e.asset.startsWith('local-'))) });
        uploadLocalAssets(pre.elements).then((elements) => { if (S.host === S.id) setStage({ elements }); });
        uploadBrandAssets(pre.brand);
        if ((pre.notices || []).some((n) => typeof n.imgAsset === 'string' && n.imgAsset.startsWith('local-'))) {
          Promise.all((pre.notices || []).map(async (n) => {
            if (typeof n.imgAsset === 'string' && n.imgAsset.startsWith('local-')) {
              const data = S.assets.get(n.imgAsset)?.data;
              if (data) return { ...n, imgAsset: await storeAsset(data).catch(() => '') };
            }
            return n;
          })).then((notices) => { if (S.host === S.id) setStage({ notices }); });
        }
        if (S.pendingStream?.id) acctApi('streamStart', { id: S.pendingStream.id }).catch(() => {});
        S.pendingStream = null;
      }
      S.local.autoMuted = false;
      resetAutoMuteTimer();
      sendMeta({ mic: S.local.micOn, cam: S.local.camOn, sharing: !!S.local.pres, hand: false });
      uploadAvatar(); S.local.offbgId = ''; uploadOffBg();
      $('#knockWait').hidden = true; $('#enterFields').hidden = false;
      if (S.host === S.id) { refreshLobby(); refreshSupers(); refreshVoice(); }
      renderAll();
      renderChatMood();
      // No invite pop-up on entry: the header's Invite button and the footer's "Copy link" are one click away.
      // Keyboard users land on Invite rather than on the bare page.
      toast(S.host === S.id ? (m.peers.length ? 'Studio ready.' : 'Studio ready. Invite guests from the Invite button.') : `You joined ${m.peers.length ? 'the studio' : 'an empty studio'}.`);
      setTimeout(() => { const at = document.activeElement; if (!at || at === document.body) [$('#enterTop'), $('#micBtn')].find((b) => b && !b.hidden && b.offsetParent)?.focus({ preventScroll: true }); }, 350);
      tryPlayAll();
      break;
    }
    case 'peer-joined': {
      const p = addPeer(m.peer);
      sysMsg(`${p.name} joined the studio`);
      toast(`${p.name} joined`);
      chime();
      if (isHost() && m.peer.raised && S.autoStage?.has(m.peer.raised) && !S.state.stage.includes(p.id)) {
        S.autoStage.delete(m.peer.raised);
        setStage({ stage: [...S.state.stage, p.id] }); toast(`${p.name} is on the show.`);
      } else if (isHost() && !S.state.stage.includes(p.id) && S.state.stage.length < MAX) {
        // Guests wait backstage until the host brings them on (or straight on, if the host chose that).
        if (store.get('autoStage', false)) setStage({ stage: [...S.state.stage, p.id] });
        else { toast(`${p.name} is backstage`, { action: ['Put on stage', () => toggleStage(p.id)], ms: 10000 }); }
      }
      renderAll();
      break;
    }
    case 'signal': onSignal(m.from, m.data); break;
    case 'peer-left': {
      const p = S.peers.get(m.id);
      if (p) { sysMsg(`${p.name} left`); closePeer(p); if (p.sharing) setTimeout(autoEndPresentScene, 0); }
      const wasHost = S.host === S.id;
      S.host = m.host; S.state = m.state;
      if (!wasHost && S.host === S.id) {
        if (S.local.hand) { S.local.hand = false; sendMeta({ hand: false }); }
        // Say plainly why the host controls just appeared, and keep it up long enough to read.
        const who = p?.name || 'The host';
        toast(m.why === 'dropped' ? `${who}’s connection dropped. You’re hosting until they’re back.` : `${who} left and handed the studio to you. You’re the host now.`, { ms: 20000, action: ['Got it', () => {}] });
        refreshLobby();
      }
      renderAll();
      break;
    }
    case 'peer-meta': {
      const p = S.peers.get(m.peer.id);
      if (!p) break;
      const startedSharing = m.peer.sharing && !p.sharing, stoppedSharing = !m.peer.sharing && p.sharing;
      Object.assign(p, { name: m.peer.name, mic: m.peer.mic, cam: m.peer.cam, sharing: m.peer.sharing, hand: !!m.peer.hand, avatar: m.peer.avatar || '', offbg: m.peer.offbg || '' });
      if (startedSharing) autoPresentScene(p.id);
      if (stoppedSharing) autoEndPresentScene();
      renderCrew();
      break;
    }
    case 'state': startSceneFade(S.state, m.state); S.state = m.state; requestStageRender(); renderAll(); renderChatMood(); break;
    case 'chat': addMsg(m.msg); break;
    case 'guest-brief': S.brief = m.brief || null; renderGuestBrief(); break;
    case 'like': setLikes(m.id, m.n, m.from); break;
    case 'feed': for (const it of m.items || []) addExternal(it); break;
    case 'unfeed': for (const id of m.ids || []) $$(`#msgs li[data-fid="${cssEsc(id)}"]`).forEach((li) => li.remove()); break;
    case 'viewer-want': viewerWant(m.vid); break;
    case 'vsignal': viewerSignal(m.from, m.data); break;
    case 'viewer-left': closeViewer(m.vid); break;
    case 'superchat': gotSuperchat(m.item, true); break;
    case 'react': reactFloat(m.emoji); break;
    case 'wqueue': gotQueue(m); break;
    case 'voicemail': gotVoice(m.item, true); break;
    case 'voicemail-update': if (!m.item) dropVoice(m.id); else gotVoice(m.item, false); break;
    case 'queue': renderQueue(m.items); break;
    case 'wreport': if (m.count >= 3) toast(`A watch-page message was hidden after ${m.count} spam reports.`, { ms: 6000 }); break;
    case 'ai': upsertAI(m.item, false); break;
    case 'auction': case 'giveaway': case 'sales': liveEvents.onMsg(m); break;
    case 'caption': showCaption(m.from, m.name, m.text, m.final); break;
    case 'host': {
      const wasHost = S.host === S.id;
      S.host = m.host;
      if (S.host === S.id) {
        if (S.local.hand) { S.local.hand = false; sendMeta({ hand: false }); }
        toast('You are now the host.'); refreshLobby();
      }
      else if (wasHost) toast(`${S.peers.get(m.host)?.name || 'The host'} is back and hosting again.`, { ms: 8000 });
      renderAll();
      break;
    }
    case 'hand-raised': if (isHost()) handNotify(m.id, m.name); break;
    case 'mute':
      if (S.local.micOn) {
        if (m.reason === 'silence') S.local.autoMuted = true;
        setMic(false, { auto: m.reason === 'silence' });
        toast(
          m.reason === 'silence'
            ? 'Your microphone was auto-muted after a period of silence.'
            : `${m.by || 'The host'} muted you. Unmute when you’re ready to talk.`,
          m.reason === 'silence' ? { action: ['Unmute', () => setMic(true)], ms: 7000 } : undefined,
        );
      }
      break;
    case 'knock': S.lobby = m.lobby || []; renderLobby(); setDeck('lobby'); chime(); toast(`${m.who?.name || 'Someone'} ${m.who?.callin ? 'is calling in' : 'is waiting to join'}.`, { action: ['Open', () => setDeck('lobby')] }); break;
    case 'lobby': S.lobby = m.lobby || []; renderLobby(); break;
    case 'recording': toast(m.on ? `${m.by} started recording` : `${m.by} stopped recording`); break;
    case 'error':
      if ($('#enterDlg').open) { $('#enterErr').textContent = m.message; $('#enterErr').hidden = false; setPhase(S.studio ? 'online' : 'offline'); $('#enterGo').disabled = false; }
      else toast(m.message, { err: true });
      break;
  }
}

// ---------------------------------------------------------------- peers
const cssId = (id) => String(id ?? '').replace(/[^a-z0-9_-]/gi, '');
function addPeer(info) {
  let p = S.peers.get(info.id);
  if (!p) { p = { id: info.id, pc: null, stream: new MediaStream(), pending: [], meters: [], rtt: null, conn: 'new' }; S.peers.set(info.id, p); }
  Object.assign(p, { name: info.name, mic: info.mic, cam: info.cam, sharing: info.sharing, hand: !!info.hand, avatar: info.avatar || '', offbg: info.offbg || '', joinedAt: info.joinedAt });
  return p;
}
function createPeer(info, offerer) {
  const p = addPeer(info);
  if (p.pc) return p;
  let pc;
  try { pc = new RTCPeerConnection({ iceServers: S.iceServers, bundlePolicy: 'max-bundle' }); }
  catch {
    // The browser rejected a TURN entry: connect with the server's own list instead of not at all.
    S.iceServers = S.serverIce || [];
    pc = new RTCPeerConnection({ iceServers: S.iceServers, bundlePolicy: 'max-bundle' });
    toast('Your TURN settings didn’t work, so gather is using its own servers. Check them in Settings.', { err: true, ms: 9000 });
  }
  p.pc = pc; p.offerer = offerer;
  if (offerer) {
    p.aT = pc.addTransceiver('audio', { direction: 'sendrecv' });
    p.vT = pc.addTransceiver('video', { direction: 'sendrecv' });
    p.pT = pc.addTransceiver('video', { direction: 'sendrecv' }); // presentation
    p.aT.sender.replaceTrack(outAudio());
    p.vT.sender.replaceTrack(outVideo() || null);
    p.pT.sender.replaceTrack(presTrack());
    pc.onnegotiationneeded = async () => {
      try { await pc.setLocalDescription(); sig(p.id, { sdp: pc.localDescription }); } catch (e) { console.warn('offer failed', e); }
    };
  }
  pc.onicecandidate = (e) => { if (e.candidate) sig(p.id, { candidate: e.candidate }); };
  pc.ontrack = (e) => {
    // The third m-line (mid "2") is the presentation track.
    if (e.track.kind === 'video' && (e.transceiver === p.pT || e.transceiver.mid === '2')) {
      let el = $('#pres-' + cssId(p.id));
      if (!el) { el = document.createElement('video'); el.id = 'pres-' + cssId(p.id); el.muted = true; el.autoplay = true; el.playsInline = true; $('#mediaSink').append(el); }
      el.srcObject = new MediaStream([e.track]); el.play().catch(() => {});
      return;
    }
    for (const t of p.stream.getTracks()) if (t.kind === e.track.kind && t !== e.track) p.stream.removeTrack(t);
    p.stream.addTrack(e.track);
    if (e.track.kind === 'audio') { p.meters.forEach((x) => x.dispose()); p.meters = [meter(e.track)]; }
    const el = cardVideo(p.id);
    if (el) { el.srcObject = p.stream; playEl(el); }
  };
  pc.onconnectionstatechange = () => {
    p.conn = pc.connectionState;
    if (pc.connectionState === 'failed' && p.offerer) pc.restartIce();
    if (pc.connectionState === 'connected') tryPlayAll();
    renderCrew(); renderDock();
  };
  return p;
}
async function onSignal(from, data) {
  const p = S.peers.get(from) || addPeer({ id: from, name: 'Guest' });
  try {
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (!p.pc) createPeer(p, false);
        const pc = p.pc;
        await pc.setRemoteDescription(data.sdp);
        if (!p.aT) {
          for (const t of pc.getTransceivers()) {
            t.direction = 'sendrecv';
            if (t.receiver.track.kind === 'audio') p.aT = t; else if (!p.vT) p.vT = t; else p.pT = t;
          }
          await p.aT?.sender.replaceTrack(outAudio());
          await p.vT?.sender.replaceTrack(outVideo() || null);
          await p.pT?.sender.replaceTrack(presTrack());
        }
        await pc.setLocalDescription();
        sig(from, { sdp: pc.localDescription });
      } else if (p.pc) {
        await p.pc.setRemoteDescription(data.sdp);
      }
      for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
    } else if (data.candidate) {
      if (p.pc?.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
      else p.pending.push(data.candidate);
    }
  } catch (e) { console.warn('signal error', e); }
}
function closePeer(p) {
  try { p.pc?.close(); } catch {}
  p.meters.forEach((x) => x.dispose());
  S.peers.delete(p.id);
  $('#card-' + cssId(p.id))?.remove();
  $('#pres-' + cssId(p.id))?.remove();
}
function teardownPeers() { for (const p of [...S.peers.values()]) closePeer(p); }

// Autoplay: remote audio may be blocked until the viewer interacts.
function playEl(el) {
  const pr = el.play();
  pr?.catch(() => {
    if (!el.muted) { el.muted = true; el.dataset.blocked = '1'; el.play().catch(() => {}); if (!S.audioBlocked) { S.audioBlocked = true; $('#audioUnblock').hidden = false; } }
  });
}
function tryPlayAll() { for (const p of S.peers.values()) { const el = cardVideo(p.id); if (el && el.srcObject) playEl(el); } }
document.addEventListener('pointerdown', () => {
  audioCtx();
  if (!S.audioBlocked) return;
  S.audioBlocked = false; $('#audioUnblock').hidden = true;
  for (const el of $$('video[data-blocked]')) { el.muted = false; delete el.dataset.blocked; el.play().catch(() => {}); }
}, { capture: true });

// Connection stats for the crew cards + dock.
setInterval(async () => {
  for (const p of S.peers.values()) {
    if (!p.pc || p.pc.connectionState !== 'connected') { p.rtt = null; continue; }
    try {
      const st = await p.pc.getStats();
      st.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.currentRoundTripTime != null) p.rtt = Math.round(r.currentRoundTripTime * 1000); });
    } catch {}
  }
  if (S.studio) { renderCrewSubs(); renderDockNote(); }
}, 2000);

// ---------------------------------------------------------------- stage state (host-owned)
function setStage(patch) {
  if (!isHost()) return toast('Only the host can change the stage.', { err: true });
  if (patch.elements) patch = { ...patch, elements: ensureSystem(patch.elements, (patch.aspect || S.state.aspect) === '9:16', uid) };
  const next = { ...S.state, ...patch, brand: { ...S.state.brand, ...(patch.brand || {}) } };
  startSceneFade(S.state, next);
  S.state = next;
  if ('scene' in patch) store.set('lastScene', S.state.scene || '');
  else if (patch.elements) rememberArrangement();
  if (S.studio) wsSend({ type: 'state', state: S.state });
  else { store.set('accent', S.state.brand.color); store.set('bg', S.state.brand.bg); store.set('title', S.state.title); }
  applyAdaptiveAccent(S.state.brand?.color);
  requestStageRender();
  renderAll();
}
function toggleStage(id) {
  const on = S.state.stage.includes(id);
  setStage({ stage: on ? S.state.stage.filter((x) => x !== id) : [...S.state.stage, id] });
}

// ---------------------------------------------------------------- participants model
function participants() {
  const me = { id: myId(), me: true, name: S.name || 'You', mic: S.local.micOn && !!S.local.audio, cam: !!outVideo(), sharing: !!S.local.pres, hand: !!S.local.hand, avatar: S.local.avatarId || '', offbg: S.local.offbgId || '', joinedAt: S.local.joinedAt, level: localMeter?.level() || 0, meter: localMeter };
  const list = [me];
  for (const p of S.peers.values()) list.push({ id: p.id, name: p.name, mic: p.mic, cam: p.cam, sharing: p.sharing, hand: !!p.hand, avatar: p.avatar || '', offbg: p.offbg || '', joinedAt: p.joinedAt, peer: p, level: p.meters[0]?.level() || 0, meter: p.meters[0] || null });
  return list.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}
function cardVideo(id) {
  const v = $(`#card-${cssId(id)} video`);
  if (v?.paused && v.srcObject && !v.dataset.kick) { v.dataset.kick = '1'; v.play().catch(() => {}).finally(() => setTimeout(() => delete v.dataset.kick, 1000)); } // keep it running for the stage
  return v;
}

// ---------------------------------------------------------------- canvas stage
const canvas = $('#stageCanvas');
const g0 = canvas.getContext('2d');
// `g` is the context draw() paints on. It is a thin proxy so a second pass can paint the tall companion canvas
// with the very same code (and modules that were handed `g` follow along). Bound methods are cached per context.
let gCur = g0;
const gBound = new WeakMap();
const g = new Proxy(g0, {
  get(_, k) {
    const c = gCur, v = c[k];
    if (typeof v !== 'function') return v;
    let m = gBound.get(c); if (!m) gBound.set(c, (m = new Map()));
    let f = m.get(k); if (!f) m.set(k, (f = v.bind(c)));
    return f;
  },
  set(_, k, v) { gCur[k] = v; return true; },
});
const fadeSnap = document.createElement('canvas');
const fadeSnapCtx = fadeSnap.getContext('2d');
let sceneFade = { active: false, from: 0, dur: 240 };
let tileAnim = new Map(); // participant id -> { x, y, w, h, r, sx, sy, sw, sh, sr, tx, ty, tw, th, tr, t0, dur }
let lastAnimW = 0, lastAnimH = 0;

function smoothTileRect(id, target, now) {
  const tr = target.r ?? 0;
  if (editor.on || reduceMotion()) {
    tileAnim.set(id, { x: target.x, y: target.y, w: target.w, h: target.h, r: tr, sx: target.x, sy: target.y, sw: target.w, sh: target.h, sr: tr, tx: target.x, ty: target.y, tw: target.w, th: target.h, tr, t0: now, dur: 0 });
    return target;
  }
  const cur = tileAnim.get(id);
  if (!cur) {
    tileAnim.set(id, { x: target.x, y: target.y, w: target.w, h: target.h, r: tr, sx: target.x, sy: target.y, sw: target.w, sh: target.h, sr: tr, tx: target.x, ty: target.y, tw: target.w, th: target.h, tr, t0: now, dur: 0 });
    return target;
  }
  const moved = Math.abs(cur.tx - target.x) > 0.5 || Math.abs(cur.ty - target.y) > 0.5 || Math.abs(cur.tw - target.w) > 0.5 || Math.abs(cur.th - target.h) > 0.5 || Math.abs(cur.tr - tr) > 0.5;
  if (moved) {
    cur.sx = cur.x; cur.sy = cur.y; cur.sw = cur.w; cur.sh = cur.h; cur.sr = cur.r;
    cur.tx = target.x; cur.ty = target.y; cur.tw = target.w; cur.th = target.h; cur.tr = tr;
    cur.t0 = now; cur.dur = 260;
    requestStageRender();
  }
  if (cur.dur > 0) {
    const raw = (now - cur.t0) / cur.dur;
    if (raw >= 1) {
      cur.x = cur.tx; cur.y = cur.ty; cur.w = cur.tw; cur.h = cur.th; cur.r = cur.tr; cur.dur = 0;
    } else {
      const u = Math.max(0, raw), e = 1 - Math.pow(1 - u, 3);
      cur.x = cur.sx + (cur.tx - cur.sx) * e;
      cur.y = cur.sy + (cur.ty - cur.sy) * e;
      cur.w = cur.sw + (cur.tw - cur.sw) * e;
      cur.h = cur.sh + (cur.th - cur.sh) * e;
      cur.r = cur.sr + (cur.tr - cur.sr) * e;
    }
  }
  return { x: cur.x, y: cur.y, w: cur.w, h: cur.h, r: cur.r };
}

function hasActiveTileAnim(now) {
  for (const a of tileAnim.values()) {
    if (a.dur > 0 && now - a.t0 < a.dur) return true;
  }
  return false;
}

function startSceneFade(prev, next) {
  if (!prev || !next || editor.on) return;
  const prevKey = `${prev.layout || ''}|${prev.scene || ''}|${prev.presenter || ''}|${(prev.stage || []).join(',')}`;
  const nextKey = `${next.layout || ''}|${next.scene || ''}|${next.presenter || ''}|${(next.stage || []).join(',')}`;
  if (prevKey === nextKey || (prev.aspect || '16:9') !== (next.aspect || '16:9')) return;
  requestStageRender();
  if (reduceMotion() || !canvas.width || !canvas.height) { sceneFade.active = false; return; }
  if (fadeSnap.width !== canvas.width || fadeSnap.height !== canvas.height) {
    fadeSnap.width = canvas.width; fadeSnap.height = canvas.height;
  }
  fadeSnapCtx.clearRect(0, 0, fadeSnap.width, fadeSnap.height);
  fadeSnapCtx.drawImage(canvas, 0, 0);
  sceneFade = { active: true, from: performance.now(), dur: 240 };
}
const speaking = new Map(); // id -> last time above threshold

function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
const edCanvas = $('#editorCanvas'), ed = edCanvas.getContext('2d');
const editorLayers = [];
/** Queue a host-only hint. Layers flagged editorOnly draw on the editor canvas, never on the program canvas. */
function editorOnly(paint) { editorLayers.push({ editorOnly: true, paint }); }
function flushEditorLayers() {
  if (edCanvas.width !== W || edCanvas.height !== H) { edCanvas.width = W; edCanvas.height = H; }
  ed.clearRect(0, 0, W, H);
  for (const l of editorLayers.splice(0)) if (l.editorOnly && isHost()) { ed.save(); l.paint(ed); ed.restore(); }
}
function layoutRects(n, layout, area) {
  const { x, y, w, h } = area, gap = 4;
  if (!n) return [];
  if (layout === 'solo' || n === 1) return [{ x, y, w, h }];
  if (layout === 'spotlight') {
    const sh = Math.round(h * (h > w ? 0.16 : 0.22)), mh = h - sh - gap, k = n - 1;
    const tw = Math.min((w - gap * (k - 1)) / k, sh * 16 / 9);
    const total = tw * k + gap * (k - 1), sx = x + (w - total) / 2;
    return [{ x, y, w, h: mh }, ...Array.from({ length: k }, (_, i) => ({ x: sx + i * (tw + gap), y: y + mh + gap, w: tw, h: sh }))];
  }
  const portrait = h > w;
  const cols = layout === 'grid'
    ? (portrait ? (n <= 2 ? 1 : 2) : (n <= 2 ? n : n <= 4 ? 2 : 3))
    : (portrait ? (n <= 3 ? 1 : 2) : n <= 3 ? n : n === 4 ? 2 : 3);
  const rows = Math.ceil(n / cols);
  const tw = (w - gap * (cols - 1)) / cols, th = (h - gap * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols), inRow = r === rows - 1 ? n - r * cols : cols;
    const off = (w - (inRow * tw + (inRow - 1) * gap)) / 2;
    return { x: x + off + (i % cols) * (tw + gap), y: y + r * (th + gap), w: tw, h: th };
  });
}
const FONTS = { jakarta: '"Plus Jakarta Sans"', onest: 'Onest', playfair: '"Playfair Display"', bebas: '"Bebas Neue"', mono: '"JetBrains Mono"', serif: '"DM Serif Display"' };
const stageFont = () => (FONTS[S.state.brand.font] || FONTS.jakarta) + ', Inter, sans-serif';
function drawBackground(t) {
  const bgImg = assetImg(S.state.brand.bgImage);
  if (bgImg) {
    const k = Math.max(W / bgImg.naturalWidth, H / bgImg.naturalHeight), dw = bgImg.naturalWidth * k, dh = bgImg.naturalHeight * k;
    g.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    g.fillStyle = `rgba(4,8,20,${S.state.brand.dim ?? 0.25})`; g.fillRect(0, 0, W, H);
    return;
  }
  const customBg = window.__gatherCustomBg;
  if (customBg && customBg.on) {
    if (customBg.mode === 'solid') {
      g.fillStyle = customBg.c1 || '#0b1020';
      g.fillRect(0, 0, W, H);
      return;
    }
    const rad = ((Number(customBg.angle) || 135) * Math.PI) / 180;
    const dx = Math.cos(rad) * W * 0.5, dy = Math.sin(rad) * H * 0.5;
    const cg = g.createLinearGradient(W / 2 - dx, H / 2 - dy, W / 2 + dx, H / 2 + dy);
    cg.addColorStop(0, customBg.c1 || '#0b1020');
    cg.addColorStop(1, customBg.c2 || '#1d4ed8');
    g.fillStyle = cg; g.fillRect(0, 0, W, H);
    return;
  }
  const ac = accentOf();
  const [a, b, c, glow] = S.state.brand.bg === 'dusk' || !BGS[S.state.brand.bg] ? [mixHex(ac, '#05070d', 0.8), mixHex(ac, '#070a14', 0.66), mixHex(ac, '#0b0f1e', 0.5), hexA(mixHex(ac, '#ffffff', 0.5), 0.07)] : BGS[S.state.brand.bg];
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, a); grd.addColorStop(.6, b); grd.addColorStop(1, c);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const r = 640 + Math.sin(t / 4000) * 12;
  g.strokeStyle = glow; g.lineWidth = 2;
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-60, H * 0.62, r - i * 70, 0, Math.PI * 2); g.stroke(); }
  const rad = g.createRadialGradient(W * .85, H * .9, 10, W * .85, H * .9, 520);
  rad.addColorStop(0, glow); rad.addColorStop(1, 'transparent');
  g.fillStyle = rad; g.fillRect(0, 0, W, H);
}
function drawTile(p, rect, t) {
  const { x, y, w, h } = rect;
  const el = cardVideo(p.id);
  const brand = S.state.brand;
  g.save();
  const R = rect.r ?? 0;
  if (R > 0) { rr(x, y, w, h, R); g.clip(); }
  const hasVid = p.cam && el && el.readyState >= 2 && el.videoWidth > 0;
  if (hasVid) drawFitVideo(el, x, y, w, h, p.id);
  else drawAudioTile(p, x, y, w, h, t);
  g.restore();

  // Track speaking timestamps for crew cards & AI director (no flashing border drawn over the video).
  const now = performance.now();
  if (p.mic && p.level > 0.02) speaking.set(p.id, now);

  // Name tag.
  const fs = Math.max(13, Math.min(18, h * 0.045));
  let tx = x + 16;
  const ty = y + h - 16 - fs * 1.9;
  if (brand.names) {
    const label = p.name; // the program is recorded and streamed, so never "(you)" here
    g.font = `700 ${fs}px ${stageFont()}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    // A muted mic sits inside the tag, at its end, instead of in a separate box beside it.
    const muted = !p.mic, icon = muted ? fs * 1.25 : 0;
    const tw = Math.min(g.measureText(label).width, w - 80 - icon), bw = tw + fs * 1.4 + icon, bh = fs * 1.9;
    const style = brand.tag || 'solid';
    let ink = '#ffffff';
    if (style === 'solid') { g.fillStyle = brand.color; rr(tx, ty, bw, bh, 6); g.fill(); ink = contrastInk(brand.color); }
    else if (style === 'glass') { g.fillStyle = 'rgba(8,14,30,.62)'; rr(tx, ty, bw, bh, 8); g.fill(); g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1; g.stroke(); g.fillStyle = brand.color; rr(tx, ty + 6, 3, bh - 12, 2); g.fill(); }
    else if (style === 'outline') { g.strokeStyle = brand.color; g.lineWidth = 2; rr(tx + 1, ty + 1, bw - 2, bh - 2, 6); g.stroke(); g.fillStyle = 'rgba(0,0,0,.25)'; g.fill(); }
    else { g.fillStyle = brand.color; g.fillRect(tx + fs * .7, ty + bh - 3, tw, 3); }
    g.fillStyle = ink;
    if (style === 'minimal') { g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8; }
    g.save(); g.beginPath(); g.rect(tx, ty, bw - icon, bh); g.clip();
    g.fillText(label, tx + fs * .7, ty + fs * .97); g.restore();
    g.shadowColor = 'transparent';
    if (muted) drawMicOff(tx + fs * .7 + tw + fs * .3 + icon / 2, ty + bh / 2, fs * .42, style === 'solid' ? ink : '#ff6b6b');
    return;
  }
  if (!p.mic) { // name tags off: a small badge of its own
    const s = fs * 1.9;
    g.fillStyle = 'rgba(17,24,39,.82)'; rr(tx, ty, s, s, s * .3); g.fill();
    drawMicOff(tx + s / 2, ty + s / 2, s * .3);
  }
}
// A camera fills its tile only when that crops little. Otherwise (a 4:3 webcam in a 16:9 tile, a tall tile in
// side-by-side) the whole picture is shown, heads and hands included, and the spare space gets a blurred copy of
// the same video. The blur is a 48 px downscale stretched back up: cheap enough for every frame.
const fillBlur = new Map(); // tile id → small canvas
function drawFitVideo(el, x, y, w, h, id) {
  const vw = el.videoWidth, vh = el.videoHeight, ratio = (w / h) / (vw / vh);
  // The tall companion crops a wide camera to its centre, the way vertical streams frame a face.
  if ((ratio > 0.9 && ratio < 1.11) || (PASS?.vertical && ratio < 1)) { // close enough: fill, losing at most ~5% per side
    const s = Math.max(w / vw, h / vh), sw = w / s, sh = h / s;
    g.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, h);
    return;
  }
  let c = fillBlur.get(id);
  if (!c) { c = document.createElement('canvas'); c.width = 48; c.height = 27; fillBlur.set(id, c); }
  const cg = c.getContext('2d');
  cg.drawImage(el, 0, 0, c.width, c.height);
  g.save();
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const bs = Math.max(w / c.width, h / c.height) * 1.15; // a little overscan hides the soft edges
  g.drawImage(c, x + (w - c.width * bs) / 2, y + (h - c.height * bs) / 2, c.width * bs, c.height * bs);
  g.fillStyle = 'rgba(4,8,18,.35)'; g.fillRect(x, y, w, h); // keep the person the brightest thing in the tile
  g.restore();
  const s = Math.min(w / vw, h / vh), dw = vw * s, dh = vh * s;
  g.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function drawMicOff(cx, cy, r, color = '#ff6b6b') {
  g.save(); g.strokeStyle = color; g.lineWidth = Math.max(1.6, r * .2); g.lineCap = 'round';
  g.beginPath(); g.roundRect(cx - r * .35, cy - r, r * .7, r * 1.25, r * .35); g.stroke();
  g.beginPath(); g.arc(cx, cy - r * .1, r * .75, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  g.beginPath(); g.moveTo(cx, cy + r * .65); g.lineTo(cx, cy + r); g.stroke();
  g.beginPath(); g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r); g.stroke();
  g.restore();
}
// Entrance animations shared by banners and featured messages: returns {alpha, dx, scale, clip, chars}.
function entrance(t0, t, len) {
  const kind = S.state.brand.anim || 'slide';
  const k = Math.min(1, (t - t0) / (kind === 'type' ? 900 : 450)), e = 1 - Math.pow(1 - k, 3);
  if (kind === 'fade') return { alpha: e, dx: 0, scale: 1, clip: 1, chars: len };
  if (kind === 'pop') { const o = k < 1 ? 1 + Math.sin(k * Math.PI) * .06 : 1; return { alpha: Math.min(1, k * 2.5), dx: 0, scale: (.85 + .15 * e) * o, clip: 1, chars: len }; }
  if (kind === 'wipe') return { alpha: 1, dx: 0, scale: 1, clip: e, chars: len };
  if (kind === 'type') return { alpha: 1, dx: 0, scale: 1, clip: 1, chars: Math.ceil(len * k) };
  return { alpha: e, dx: -(1 - e) * 40, scale: 1, clip: 1, chars: len };
}
function drawBanner(t, r) {
  const b = S.state.banner;
  if (!b) return;
  const key = b.id + b.text + b.sub;
  if (S.banner.key !== key) S.banner = { key, t0: t };
  const brand = S.state.brand, style = brand.bannerStyle || 'classic', F = stageFont();
  const an = entrance(S.banner.t0, t, b.text.length);
  const text = b.text.slice(0, an.chars);
  const k = Math.max(.5, r.h / ((style === 'bold' ? 78 : 64) + 40));
  const big = (style === 'bold' ? 40 : 30) * k, subF = 19 * k, padX = 28 * k;
  g.save();
  g.globalAlpha = an.alpha;
  g.font = `800 ${big}px ${F}`;
  const tw = Math.min(g.measureText(style === 'bold' ? b.text.toUpperCase() : b.text).width, r.w - padX * 2);
  let subW = 0;
  if (b.sub) { g.font = `500 ${subF}px ${F}`; subW = Math.min(g.measureText(b.sub).width, r.w - padX * 2); }
  const bw = Math.min(r.w, Math.max(tw, subW) + padX * 2);
  const mainH = (style === 'bold' ? 78 : 64) * k, subH = b.sub ? 40 * k : 0;
  const x = r.x + an.dx, y = r.y + r.h - mainH - subH;
  // scale around the banner's left edge, clip for the wipe
  g.translate(x, y + (mainH + subH) / 2); g.scale(an.scale, an.scale); g.translate(-x, -(y + (mainH + subH) / 2));
  g.beginPath(); g.rect(x - 4, y - 30, (bw + 8) * an.clip, mainH + subH + 60); g.clip();
  const shadow = () => { g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 24; g.shadowOffsetY = 8; };
  let ink = contrastInk(brand.color), subInk = '#1f2937';
  if (style === 'classic') {
    shadow(); g.fillStyle = brand.color; rr(x, y, bw, mainH, b.sub ? [10, 10, 0, 0] : 10); g.fill(); g.shadowColor = 'transparent';
    if (b.sub) { g.fillStyle = '#ffffff'; rr(x, y + mainH, bw, subH, [0, 0, 10, 10]); g.fill(); }
  } else if (style === 'glass') {
    shadow(); g.fillStyle = 'rgba(8,14,30,.72)'; rr(x, y, bw, mainH + subH, 14); g.fill(); g.shadowColor = 'transparent';
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = brand.color; rr(x, y + 12, 5, mainH + subH - 24, 3); g.fill();
    ink = '#ffffff'; subInk = 'rgba(230,238,255,.85)';
  } else if (style === 'bold') {
    shadow(); g.fillStyle = brand.color; g.fillRect(x, y, bw, mainH); g.shadowColor = 'transparent';
    if (b.sub) { g.fillStyle = '#0b1020'; g.fillRect(x, y + mainH, bw, subH); subInk = '#ffffff'; }
  } else {
    ink = '#ffffff'; subInk = 'rgba(230,238,255,.9)';
    g.fillStyle = brand.color; g.fillRect(x + padX, y + mainH - 8 * k, Math.min(tw, 220 * k), 4 * k);
  }
  g.textBaseline = 'middle'; g.textAlign = 'left';
  if (style === 'minimal') { g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 12; }
  g.fillStyle = ink; g.font = `800 ${big}px ${F}`;
  g.fillText(style === 'bold' ? text.toUpperCase() : text, x + padX, y + mainH / 2 + 1);
  if (b.sub && an.chars >= b.text.length) { g.fillStyle = subInk; g.font = `500 ${subF}px ${F}`; g.fillText(b.sub, x + padX, y + mainH + subH / 2 + 1); }
  g.restore();
}
function drawTicker(t, r) {
  const text = S.state.ticker;
  if (!text) return;
  const brand = S.state.brand, fs = Math.max(12, Math.round(r.h * .43));
  g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
  g.fillStyle = brand.color; g.fillRect(r.x, r.y, r.w, r.h);
  g.font = `600 ${fs}px Inter, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'left';
  const unit = text + '     •     ', uw = g.measureText(unit).width, off = (t / 1000 * 90) % uw;
  g.fillStyle = contrastInk(brand.color);
  for (let x = r.x - off; x < r.x + r.w; x += uw) g.fillText(unit, x, r.y + r.h / 2 + 1);
  g.restore();
}
function drawFrame() {
  const brand = S.state.brand, f = brand.frame;
  if (f === 'vignette') { const r = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = r; g.fillRect(0, 0, W, H); }
  const ov = assetImg(brand.overlay);
  if (ov) g.drawImage(ov, 0, 0, W, H);
}
function drawLogo(r) {
  const logo = assetImg(S.state.brand.logo);
  if (!logo) return;
  const k = Math.min(r.w / logo.naturalWidth, r.h / logo.naturalHeight), w = logo.naturalWidth * k, h = logo.naturalHeight * k;
  const right = r.x + r.w / 2 > W / 2;
  g.drawImage(logo, right ? r.x + r.w - w : r.x, r.y + (r.h - h) / 2, w, h);
}
function drawShapeEl(e) {
  const r = px(e);
  g.save(); g.globalAlpha = e.opacity ?? 1; g.fillStyle = e.color || '#000000'; rr(r.x, r.y, r.w, r.h, e.radius || 0); g.fill(); g.restore();
}
function drawChrome() {
  g.textBaseline = 'middle';
  // The show title is no longer drawn on the stage: it lives in the header and on the watch page.
  if (window.__shopReady) { drawProduct(); drawPoll(); drawWatchBadge(); }
  drawWaves();
}
// The program is painted tier by tier: stage → media → (brand frame) → overlays → chat → ticker → system.
const TIER_Z = Object.fromEntries(TIERS.map((x) => [x.id, x.z]));
/** The scene's elements, with any missing system element (lower third, ticker, logo…) at its default spot. */
function stageElements() { return PASS ? PASS.els : ensureSystem(S.state.elements || [], isVertical(), () => 'sys'); }
function draw(now = performance.now()) {
  const t = now;
  if (!PASS) syncAspect();
  if (lastAnimW !== W || lastAnimH !== H) { tileAnim.clear(); lastAnimW = W; lastAnimH = H; }
  drawBackground(t);
  const inStudio = !!S.studio;
  const els = drawOrder(stageElements()).filter((e) => !e.hidden);
  if (!inStudio && !previewActive()) {
    drawFrame();
    const lg = els.find((e) => e.type === 'logo'); if (lg) drawLogo(px(lg));
    drawChrome(); return;
  }
  const people = participants();
  const byId = new Map(people.map((p) => [p.id, p]));
  const stageIds = inStudio ? S.state.stage : [myId()];
  const onStage = stageIds.map((id) => byId.get(id)).filter(Boolean);
  const onStageIds = new Set(onStage.map((p) => p.id));
  const lay = PASS ? PASS.layout : S.state.layout;
  const custom = lay === 'custom';
  const hasMedia = custom && els.some((e) => e.type === 'media');
  for (const id of tileAnim.keys()) {
    if (id === '__media__') { if (!hasMedia) tileAnim.delete(id); }
    else if (!onStageIds.has(id)) tileAnim.delete(id);
  }
  if (!onStage.length && !PASS) {
    editorOnly((c) => { c.fillStyle = 'rgba(255,255,255,.7)'; c.font = '600 22px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('Add someone to the stage from “In the studio”.', W / 2, H / 2); });
  }
  // Built-in layouts place cameras automatically. Single-video solo fills edge-to-edge with zero margin.
  if (!custom || !els.some((e) => e.type === 'slot')) {
    const tick = els.find((e) => e.type === 'ticker');
    const hasTicker = !!(tick && S.state.ticker && tick.y > .7);
    const hasOtherPanels = els.some((e) => !e.hidden && ['media', 'chat', 'score', 'bounty', 'ai', 'tip', 'callin', 'image', 'text', 'timer', 'shape'].includes(e.type));
    const onlyVideo = onStage.length === 1 && !hasTicker && !hasOtherPanels;
    if (onlyVideo) {
      const fullRect = smoothTileRect(onStage[0].id, { x: 0, y: 0, w: W, h: H, r: 0 }, t);
      drawTile(onStage[0], fullRect, t);
      camRects = [fullRect];
    } else {
      const bottom = hasTicker ? tick.y * H : H;
      const rects = layoutRects(onStage.length, custom ? 'split' : lay, { x: 0, y: 0, w: W, h: bottom });
      camRects = [];
      onStage.forEach((p, i) => {
        if (!rects[i]) return;
        const animRect = smoothTileRect(p.id, { ...rects[i], r: 0 }, t);
        drawTile(p, animRect, t);
        camRects.push(animRect);
      });
    }
  } else camRects = [];
  let framed = false;
  for (const e of els) {
    if (!framed && TIER_Z[tierOf(e)] >= 300) { drawFrame(); framed = true; }
    drawElement(e, t, onStage, custom);
  }
  if (!framed) drawFrame();
  drawChrome();
  // Brand-themed overlays: live drop stock badge, purchase alerts, voice waveform, sponsors, goal confetti, countdown screen.
  // Each overlay draws on its own: one that fails (bad data) must never blank the others, and logs once.
  const font = stageFont(), brand = S.state.brand || {}, wall = Date.now();
  const sh = S.state.shop, sp = S.state.sponsors;
  overlay('drop', () => { if (sh?.pinned && sh.items?.length) drawShopDropBadge(g, W, H, sh, brand, font, wall); });
  overlay('purchase', () => { if (S.state.purchaseAlert?.ts) drawPurchaseAlert(g, W, H, S.state.purchaseAlert, brand, font, wall); });
  overlay('voice', () => { if (S.state.voiceOnAir?.ts) drawVoiceOnAir(g, W, H, S.state.voiceOnAir, brand, font, t); });
  overlay('sponsor', () => { const on = sp?.activeId && (sp.slots || []).find((x) => x.id === sp.activeId); if (on) drawSponsorCard(g, W, H, on, brand, font); });
  overlay('live-events', () => liveEvents.draw(g, W, H, brand, font, wall));
  overlay('confetti', () => { if (window.__gatherConfettiUntil > wall) drawGoalConfetti(g, W, H, t, brand.color); });
  overlay('countdown', () => {
    if (!S.state.countdown?.on) return;
    if (S.state.countdown.autoLive && S.state.countdown.target && S.state.countdown.target <= wall) { if (isHost()) setStage({ countdown: { ...S.state.countdown, on: false } }); }
    else drawCountdownScreen(g, W, H, S.state.countdown, brand, font, S.feed.slice(-3), wall);
  });
  drawScAlert(t);
  if (!PASS && sceneFade.active) {
    const raw = (t - sceneFade.from) / sceneFade.dur;
    if (raw >= 1 || fadeSnap.width !== W || fadeSnap.height !== H) sceneFade.active = false;
    else {
      const ease = 1 - Math.pow(1 - Math.max(0, raw), 2.5);
      g.save(); g.globalAlpha = Math.max(0, Math.min(1, 1 - ease)); g.drawImage(fadeSnap, 0, 0, W, H); g.restore();
    }
  }
}
// Ambient surround: the letterbox around the stage shows a blurred copy of the program (never recorded).
{
  const amb = $('#stageAmbient'), ag = amb?.getContext('2d');
  const quiet = matchMedia('(prefers-reduced-motion: reduce)');
  if (ag) setInterval(() => {
    if (document.hidden || !S.studio || quiet.matches) return;
    try { ag.drawImage(canvas, 0, 0, amb.width, amb.height); amb.classList.add('on'); } catch {}
  }, 125);
}
const overlayErrs = new Set();
function overlay(name, fn) {
  try { g.save(); fn(); }
  catch (e) { if (!overlayErrs.has(name)) { overlayErrs.add(name); console.warn(`stage overlay "${name}" failed:`, e); } }
  finally { g.restore(); }
}
let camRects = []; // where the built-in layout put cameras this frame
/** Lift a banner off any small camera tile (Spotlight's thumbnails) so it never covers a guest's face. */
function clearOfCams(r) {
  const small = camRects.filter((c) => c.w * c.h < W * H * 0.25 && r.x < c.x + c.w && c.x < r.x + r.w && r.y < c.y + c.h && c.y < r.y + r.h);
  if (!small.length) return r;
  const top = Math.min(...small.map((c) => c.y));
  return { ...r, y: Math.max(44, top - r.h - 12) };
}
function drawElement(e, t, onStage, custom) {
  switch (e.type) {
    case 'slot': {
      if (!custom) return;
      const p = onStage[e.index], r = { ...px(e), r: e.radius };
      if (p) drawTile(p, smoothTileRect(p.id, r, t), t);
      else editorOnly((c) => {
        // Host-only hint for an empty seat. It lives on the editor layer above the program, so cut out every
        // overlay (scoreboard, banners, cards…) before it shows: the hint never covers what viewers see.
        const R = r.r ?? 12;
        c.fillStyle = 'rgba(255,255,255,.035)'; c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, R); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.22)'; c.setLineDash([6, 7]); c.lineWidth = 1.5; c.beginPath(); c.roundRect(r.x + .75, r.y + .75, r.w - 1.5, r.h - 1.5, R); c.stroke();
        c.setLineDash([]);
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, ic = Math.max(14, Math.min(22, r.h * .06));
        c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 2; c.lineCap = 'round';
        c.beginPath(); c.moveTo(cx - ic / 2, cy - ic); c.lineTo(cx + ic / 2, cy - ic); c.moveTo(cx, cy - ic * 1.5); c.lineTo(cx, cy - ic / 2); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.62)'; c.font = '600 15px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText('Empty seat', cx, cy + ic * .4);
        c.fillStyle = 'rgba(255,255,255,.38)'; c.font = '500 12.5px Inter, sans-serif';
        c.fillText(`Position ${e.index + 1} · invite a guest to fill it`, cx, cy + ic * .4 + 20);
        c.globalCompositeOperation = 'destination-out';
        for (const o of S.state.elements || []) {
          if (o === e || o.hidden || o.type === 'slot' || o.type === 'media') continue;
          if (TIER_Z[tierOf(o)] <= TIER_Z[tierOf(e)]) continue;
          const q = px(o); c.beginPath(); c.roundRect(q.x - 6, q.y - 6, q.w + 12, q.h + 12, 14); c.fill();
        }
        c.globalCompositeOperation = 'source-over';
      });
      return;
    }
    case 'media': if (custom) drawMediaEl(e, t); return;
    case 'shape': drawShapeEl(e); return;
    case 'ai': drawAiEl(e); return;
    case 'tip': drawTipEl(e); return;
    case 'callin': drawCallinEl(e); return;
    case 'chat': drawChatEl(e, t); return;
    case 'text': drawTextEl(e); return;
    case 'image': drawImageEl(e); return;
    case 'timer': drawTimerEl(e); return;
    case 'score': drawScoreEl(e); return;
    case 'bounty': drawBountyEl(e); return;
    case 'banner': drawBanner(t, clearOfCams(px(e))); return;
    case 'ticker': drawTicker(t, px(e)); return;
    case 'logo': drawLogo(px(e)); return;
    case 'ads': drawAds(px(e)); return;
    case 'featured': drawFeatured(t, px(e)); return;
    case 'captions': drawCaptions(clearOfCams(px(e))); return;
  }
}
/** Blend two #rrggbb colours: k = 0 gives a, k = 1 gives b. Used to tint the stage with the user's accent. */
function mixHex(a, b, k) {
  const p = (h) => { const n = parseInt(String(h).replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
const accentOf = () => normalizeHex(S.state?.brand?.color) || '#3b82f6';
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function contrastInk(hex) { const n = parseInt(hex.slice(1), 16); const [r, gg, b] = [n >> 16, (n >> 8) & 255, n & 255]; return (0.299 * r + 0.587 * gg + 0.114 * b) > 170 ? '#111827' : '#ffffff'; }

// ---------------------------------------------------------------- the tall companion (9:16 next to the 16:9 program)
// Going live to TikTok or Instagram and YouTube at once: every frame is drawn a second time on a 720x1280 canvas.
// Built-in layouts reflow by themselves (layoutRects stacks people on a portrait stage); a custom scene maps to the
// vertical template with the same parts, and the lower third, ticker and logo move to their vertical spots.
const tallCanvas = document.createElement('canvas'); tallCanvas.width = 720; tallCanvas.height = 1280;
const tallCtx = tallCanvas.getContext('2d');
const tall = {
  users: new Set(), // who needs it: 'live', 'preview'
  wanted: () => tall.users.size > 0 && S.state.aspect !== '9:16',
  anim: new Map(), key: '', cache: null, err: false,
};
/** The tall version of the current scene: { layout, els }. Cached until the scene changes. */
function tallScene() {
  const src = S.state.elements || [], layout = S.state.layout;
  const n = (S.state.stage || []).length;
  const key = `${S.state.scene}|${layout}|${n}|${src.map((e) => e.type + (e.hidden ? '-' : '') + (e.id || '')).join(',')}`;
  if (tall.key === key && tall.cache) return tall.cache;
  const on = (t) => src.some((e) => !e.hidden && e.type === t);
  let out;
  if (layout !== 'custom' || !src.some((e) => !isSystem(e))) {
    out = { layout: layout === 'custom' ? 'grid' : layout, els: [] };
  } else {
    const id = on('media') ? 'v-present' : on('ai') ? 'v-ai' : on('chat') ? 'v-chat' : n >= 2 ? 'v-stack' : 'v-solo';
    const tpl = V_TEMPLATES.find((x) => x.id === id) || V_TEMPLATES[0];
    out = { layout: 'custom', els: tpl.els.map((e, i) => withDefaults({ ...e, id: 'tall-' + i })) };
  }
  // The scene's system parts (lower third, ticker, logo…) at their vertical spots, hidden where the scene hides them.
  let k = 0;
  out.els = ensureSystem(out.els, true, () => 'tall-sys-' + k++).map((e) => {
    if (!isSystem(e)) return e;
    const s = src.find((x) => x.type === e.type);
    return s?.hidden ? { ...e, hidden: true } : e;
  });
  tall.key = key; tall.cache = out;
  return out;
}
/** Turn the companion on or off for one user ('live', 'preview', 'rec'). */
function useTall(who, on) { if (on) tall.users.add(who); else tall.users.delete(who); tall.err = false; requestStageRender(); }
window.__gatherTall = { canvas: tallCanvas, use: useTall, scene: () => tallScene() };
function drawTall(now) {
  const keep = { W, H, tileAnim, lastAnimW, lastAnimH, camRects };
  const sc = tallScene();
  PASS = { vertical: true, els: sc.els, layout: sc.layout };
  gCur = tallCtx; W = 720; H = 1280; tileAnim = tall.anim; lastAnimW = 720; lastAnimH = 1280;
  try { tallCtx.setTransform(1, 0, 0, 1, 0, 0); draw(now); }
  catch (e) { if (!tall.err) { tall.err = true; console.warn('tall companion failed to draw:', e); } }
  finally {
    gCur = g0; PASS = null;
    ({ W, H, tileAnim, lastAnimW, lastAnimH, camRects } = keep);
  }
}

// Render loop: rAF-driven while visible (full refresh rate during layout/presenter transitions, adaptive
// 30 fps steady-state to preserve CPU); background worker fallback keeps recordings alive in hidden tabs.
let lastFrame = 0, nextFrame = 0, frameGap = 1000 / 30, stageRafId = 0, stageDirty = false;
function isStageAnimating(now) {
  if (editor.on || S.local.pres?.game || sceneFade.active || hasActiveTileAnim(now)) return true;
  if (S.state.banner && S.banner.t0 && now - S.banner.t0 < 950) return true;
  return false;
}
function requestStageRender() {
  stageDirty = true;
  nextFrame = 0;
  if (!stageRafId) stageRafId = requestAnimationFrame(frame);
}
function drawProgram(now = performance.now()) {
  const t0 = performance.now();
  lastFrame = now;
  stageDirty = false;
  S.local.pres?.draw?.();
  draw(now);
  flushEditorLayers();
  if (tall.wanted()) drawTall(now);
  const cost = performance.now() - t0;
  const onAir = !!(S.rec || S.live || S.viewers?.size); // direct watch-page viewers count as on air
  const animating = isStageAnimating(now);
  // During layout switches, presenter transitions, stage editing, or game mode, paint every rAF vsync;
  // otherwise step down to 30 fps (matching capture/stream cadence) while honoring CPU headroom.
  const baseGap = animating ? 0 : (1000 / 30 - 2);
  const cpuGuard = animating ? (cost > 16 ? cost * 1.15 : 0) : cost * (onAir ? 1.25 : 2);
  frameGap = Math.max(baseGap, cpuGuard);
  nextFrame = now + frameGap;
}
function frame(now) {
  stageRafId = requestAnimationFrame(frame);
  if (stageDirty || now >= nextFrame - 1) drawProgram(now);
  meters(); speakingCards(); updateDucking(); updateAutoMute();
}
stageRafId = requestAnimationFrame(frame);
// rAF pauses in background tabs; a worker clock keeps recordings and live output flowing only while hidden or stalled.
const clock = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),33)'], { type: 'text/javascript' })));
clock.onmessage = () => {
  const now = performance.now();
  if ((document.hidden || now - lastFrame > Math.max(120, frameGap + 60)) && now >= nextFrame) {
    drawProgram(now);
    updateDucking();
    updateAutoMute();
  }
};

function meters() {
  const lvl = Math.min(100, (localMeter?.level() || 0) * 400 * (S.local.micOn ? 1 : 0));
  $('#meterFill').style.width = lvl + '%';
  $('#pMeter').style.width = lvl + '%';
}
const crewVizSmooth = new Map();
function speakingCards() {
  const now = performance.now();
  const byId = new Map();
  if (S.studio) for (const p of participants()) byId.set(p.id, p);
  for (const k of crewVizSmooth.keys()) if (!byId.has(k)) crewVizSmooth.delete(k);
  for (const li of $$('.crew-card')) {
    const p = byId.get(li.dataset.id);
    const raw = p && p.mic ? Math.min(1, (p.level || 0) * 6.5) : 0;
    if (p && p.mic && (p.level || 0) > 0.02) speaking.set(p.id, now);
    const prev = crewVizSmooth.get(li.dataset.id) || 0;
    const lv = prev + (raw - prev) * (raw > prev ? .42 : .15);
    crewVizSmooth.set(li.dataset.id, lv);
    li.classList.toggle('speaking', now - (speaking.get(li.dataset.id) || -1e9) < 450);
    const viz = $('.crew-viz', li), vu = $('.crew-vu', li);
    const on = !!(p && p.mic);
    if (viz) {
      viz.hidden = !on;
      if (on) {
        viz.classList.toggle('hot', lv > 0.08);
        const bs = p.meter?.bands?.();
        const bars = viz.children;
        for (let i = 0; i < bars.length; i++) {
          const b = bs ? bs[i] : lv * (.65 + .35 * Math.abs(Math.sin(now / 130 + i * 1.1)));
          const h = Math.min(1, .16 + Math.max(b * .84, lv * .62));
          bars[i].style.transform = `scaleY(${h.toFixed(3)})`;
        }
      }
    }
    if (vu) {
      vu.hidden = !on;
      if (on && vu.firstElementChild) vu.firstElementChild.style.transform = `scaleX(${lv.toFixed(3)})`;
    }
  }
}

// ---------------------------------------------------------------- chat feed (studio + Twitch) for overlays
const FEED_MAX = 200;
const SRC_COLOR = { studio: null, twitch: '#9146ff', youtube: '#ff0033', rumble: '#85c742', x: '#e7e9ea', kick: '#53fc18', watch: '#16a34a' };
const SRC_NAME = { studio: 'Studio', twitch: 'Twitch', youtube: 'YouTube', rumble: 'Rumble', x: 'X', kick: 'Kick', watch: 'Watch page' };
S.feed = [];
function pushFeed(m) { samChat?.onFeed(m); autoMoments?.onFeed(m); S.feed.push(m); if (S.feed.length > FEED_MAX) S.feed.splice(0, S.feed.length - FEED_MAX); }

// Twitch chat is readable anonymously over its public IRC WebSocket: no key, no server, no cost.
const twitch = { ws: null, channel: '', want: '', retry: 0, status: 'off' };
function syncTwitch() {
  const want = S.state.feeds?.twitch || '';
  if (want === twitch.want) return;
  twitch.want = want;
  twitch.retry = 0;
  try { twitch.ws?.close(); } catch {}
  twitch.ws = null;
  if (want) connectTwitch(); else setTwitchStatus('off');
}
function connectTwitch() {
  const ch = twitch.want;
  if (!ch) return;
  setTwitchStatus('connecting');
  const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  twitch.ws = ws;
  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags');
    ws.send('PASS SCHMOOPIIE');
    ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
    ws.send('JOIN #' + ch);
  };
  ws.onmessage = (e) => {
    for (const line of String(e.data).split('\r\n')) {
      if (!line) continue;
      if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue; }
      if (/ ROOMSTATE #/.test(line) || / 366 /.test(line)) { twitch.retry = 0; setTwitchStatus('live'); continue; }
      const m = line.match(/^@(\S+) :([^!]+)!\S+ PRIVMSG #\S+ :(.*)$/);
      if (!m) continue;
      const tags = Object.fromEntries(m[1].split(';').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
      let text = m[3];
      if (text.startsWith('\u0001ACTION ')) text = text.slice(8, -1);
      addExternal({ id: tags.id || Math.random().toString(36).slice(2), src: 'twitch', name: (tags['display-name'] || m[2]).replace(/\\s/g, ' '), color: /^#[0-9a-f]{6}$/i.test(tags.color) ? tags.color : '', text: text.slice(0, 500), ts: Number(tags['tmi-sent-ts']) || Date.now() });
    }
  };
  ws.onclose = () => {
    if (twitch.ws !== ws || !twitch.want) return;
    setTwitchStatus('reconnecting');
    setTimeout(() => { if (twitch.ws === ws && twitch.want) connectTwitch(); }, Math.min(15000, 1000 * 2 ** twitch.retry++));
  };
}
function setTwitchStatus(st) {
  twitch.status = st;
  const el = $('#twitchStatus');
  if (!el) return;
  el.dataset.state = st;
  el.textContent = { off: 'Not connected', connecting: 'Connecting…', live: `Reading #${twitch.want}`, reconnecting: 'Reconnecting…' }[st];
}
const seenFeed = new Set();
function addExternal(m) {
  if (seenFeed.has(m.id)) return;
  seenFeed.add(m.id);
  const em = String(m.text || '').trim(); // a message that's only emoji ("🔥🔥🔥") rises on the stream too
  if (em && em.length <= 24 && /^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f|\s)+$/u.test(em)) for (const e of [...em.matchAll(/\p{Extended_Pictographic}/gu)].slice(0, 4)) reactFloat(e[0]);
  pushFeed(m);
  const li = document.createElement('li');
  li.className = 'msg ext' + (m.paid ? ' paid' : '') + (m.hl ? ' hl' : '') + (m.reward === 'song' ? ' song' : '');
  setMsgData(li, m);
  const who = document.createElement('div'); who.className = 'who';
  const badge = document.createElement('span'); badge.className = 'pill caps src-' + m.src; badge.textContent = m.src === 'watch' ? 'Watch' : SRC_NAME[m.src] || m.src;
  const b = document.createElement('b'); b.textContent = m.name; if (m.color) b.style.color = m.color;
  who.append(badge, b);
  if (m.q) { const q = document.createElement('span'); q.className = 'q-badge'; q.textContent = 'Question'; who.append(q); }
  if (m.paid) { const amt = document.createElement('span'); amt.className = 'paid-amt'; amt.textContent = m.paid; who.append(amt); }
  const txt = document.createElement('div'); txt.className = 'txt'; txt.textContent = m.text;
  li.append(who, txt, msgActions(m));
  chatShell(li, { id: m.id, name: m.name, ts: m.ts, av: m.av, likes: m.likes });
  appendLog(li);
  applyModeration(li);
  renderChatMood();
  const log = $('#msgs'); while (log.children.length > 300) log.firstChild.remove();
}
function setMsgData(li, m) { li.dataset.fid = m.id; li.dataset.src = m.src; li.dataset.user = String(m.name || '').toLowerCase(); }

// ---------------------------------------------------------------- live chat: mood meter, moderation, YouTube and Rumble → ./livechat.js
const liveChat = createLiveChat({
  $, $$, store, S, isHost, toast, api, creds, wsSend, setStage, seenFeed, addExternal, renderAIPanel,
  syncWizAiBar, renderLive, renderDriveButton, renderProducerUI, renderVoiceNames
});
const { rumble } = liveChat;
function renderChatMood(...args) { return liveChat.renderChatMood(...args); }
function isModerated(...args) { return liveChat.isModerated(...args); }
function setLikes(...args) { return liveChat.setLikes(...args); }
function chatShell(...args) { return liveChat.chatShell(...args); }
function msgActions(...args) { return liveChat.msgActions(...args); }
function applyModeration(...args) { return liveChat.applyModeration(...args); }
function applyModerationAll(...args) { return liveChat.applyModerationAll(...args); }
function stopYouTube(...args) { return liveChat.stopYouTube(...args); }
function renderGoogle(...args) { return liveChat.renderGoogle(...args); }
function syncRumble(...args) { return liveChat.syncRumble(...args); }
function setRumbleStatus(...args) { return liveChat.setRumbleStatus(...args); }

// ---------------------------------------------------------------- stage elements: custom layouts + overlays
// Every element is a rectangle in stage units (0..1), drawn on the canvas, so it shows for every
// participant and lands in recordings and streams exactly as placed.
const uid = () => Math.random().toString(36).slice(2, 8);
const ELEMENT_DEFAULTS = {
  slot: () => ({ type: 'slot', x: .3, y: .25, w: .4, h: .5, index: 0, radius: 10 }),
  chat: () => ({ type: 'chat', x: .7, y: .1, w: .27, h: .78, max: 8, size: 18, bg: true, fade: false }),
  text: () => ({ type: 'text', x: .05, y: .82, w: .5, h: .1, text: 'Your headline here', size: 40, color: '#ffffff', bold: true, align: 'left', bg: '' }),
  image: () => ({ type: 'image', x: .82, y: .06, w: .14, h: .14, asset: '', fit: 'contain', opacity: 1, radius: 0 }),
  timer: () => ({ type: 'timer', x: .42, y: .025, w: .16, h: .08, mode: 'clock', target: 0, size: 40, color: '#ffffff', bg: '' }),
  bounty: () => ({ type: 'bounty', x: .68, y: .16, w: .3, h: .22 }),
  score: () => ({ type: 'score', x: .27, y: .025, w: .46, h: .1, a: 'Home', b: 'Away', sa: 0, sb: 0, round: '', map: '', ca: accentOf(), cb: '#f43f5e' }),
  media: () => ({ type: 'media', x: .025, y: .07, w: .7, h: .86, radius: 12 }),
  ai: () => ({ type: 'ai', x: .62, y: .07, w: .355, h: .62, size: 22 }),
  tip: () => ({ type: 'tip', x: .025, y: .64, w: .34, h: .31, provider: 'paypal', url: '', label: 'Support the show' }),
  callin: () => ({ type: 'callin', x: .66, y: .66, w: .31, h: .28, url: S.studio ? watchLinkUrl() : '', label: 'Watch & chat live', phone: '' }), // the watch-link card (QR + address)
  shape: () => ({ type: 'shape', x: .4, y: .4, w: .2, h: .2, color: '#0b1020', opacity: 1, radius: 0, label: '' }),
};
const px720 = (x, y, w, h) => ({ x: x / 1280, y: y / 720, w: w / 1280, h: h / 720 });
const TEMPLATES = [
  // Used automatically when someone presents: the slides fill the frame, cameras float on top.
  { id: 'present-full', name: 'Full-screen slides', els: [
    { type: 'media', x: 0, y: 0, w: 1, h: 1, radius: 0, stack: true },
    { type: 'slot', index: 0, ...px720(1064, 32, 184, 136), radius: 12, pip: true, stack: true },
    { type: 'slot', index: 1, ...px720(1064, 184, 184, 136), radius: 12, pip: true, stack: true },
    { type: 'slot', index: 2, ...px720(1064, 336, 184, 136), radius: 12, pip: true, stack: true }] },
  // Used by "AI window on stage" while someone presents.
  { id: 'screen-ai', name: 'Screen + AI', els: [
    { type: 'media', ...px720(48, 48, 752, 520) }, { type: 'ai', ...px720(832, 48, 400, 352) },
    { type: 'slot', index: 0, ...px720(832, 424, 400, 144) },
    { type: 'banner', ...px720(48, 584, 752, 104) }, { type: 'logo', ...px720(832, 592, 400, 88) },
    { type: 'captions', ...px720(160, 488, 960, 64), stack: true }] },
  ...PRESETS,
];
const V_TEMPLATES = [
  { id: 'v-solo', name: 'Vertical solo', els: [{ type: 'slot', index: 0, x: .04, y: .06, w: .92, h: .8, radius: 18 }] },
  { id: 'v-stack', name: 'Stacked duo', els: [{ type: 'slot', index: 0, x: .04, y: .06, w: .92, h: .42, radius: 16 }, { type: 'slot', index: 1, x: .04, y: .5, w: .92, h: .42, radius: 16 }] },
  { id: 'v-present', name: 'Vertical presentation', els: [{ type: 'media', x: .04, y: .08, w: .92, h: .3 }, { type: 'slot', index: 0, x: .04, y: .41, w: .92, h: .5, radius: 16 }] },
  { id: 'v-ai', name: 'Vertical AI', els: [{ type: 'ai', x: .04, y: .06, w: .92, h: .44, size: 26 }, { type: 'slot', index: 0, x: .04, y: .53, w: .92, h: .4, radius: 16 }] },
  { id: 'v-chat', name: 'Vertical + chat', els: [{ type: 'slot', index: 0, x: .04, y: .06, w: .92, h: .56, radius: 16 }, { type: 'chat', x: .04, y: .65, w: .92, h: .28, max: 6, size: 24, bg: true }] },
];
const TPL = Object.fromEntries([...TEMPLATES, ...V_TEMPLATES].map((t) => [t.id, t]));
const isVertical = () => (PASS ? PASS.vertical : S.state.aspect === '9:16');
const BUILTINS = [
  { id: 'b-solo', name: 'Solo', layout: 'solo' },
  { id: 'b-split', name: 'Side by side', layout: 'split' },
  { id: 'b-grid', name: 'Grid', layout: 'grid' },
  { id: 'b-spotlight', name: 'Spotlight', layout: 'spotlight' },
];
function withDefaults(e) { return { ...(ELEMENT_DEFAULTS[e.type]?.() || {}), ...e, id: e.id || uid() }; }
// Cards the host added (QR / support, call-in, images) follow them from scene to scene; if one would overlap the
// new scene it is hidden rather than allowed to collide, and the Layers list shows it.
const CARRIED = ['tip', 'callin', 'image'];
function carryInto(base) {
  const placed = [], hidden = [];
  for (const e of (S.state.elements || []).filter((x) => CARRIED.includes(x.type))) {
    const c = { ...e };
    if (!c.hidden && !c.stack && blockerFor(c, c, [...base, ...placed])) { c.hidden = true; hidden.push(elName(c)); }
    placed.push(c);
  }
  if (hidden.length) setTimeout(() => toast(`${hidden.join(', ')} hidden in this scene so nothing overlaps. Show it from Layouts → Layers.`, { ms: 5200 }), 50);
  return placed;
}
/** Elements for a scene: what the host arranged there last time, or the scene's design plus carried cards. */
function sceneElements(id, design) {
  const saved = arrangement(id);
  if (saved) return saved;
  const base = materialize(design.map(withDefaults), uid);
  return ensureSystem([...base, ...carryInto(base)], isVertical(), uid);
}
function templatePatch(tpl) { return { layout: 'custom', scene: tpl.id, elements: sceneElements(tpl.id, tpl.els) }; }
function applyTemplate(tpl) { setStage(templatePatch(tpl)); }

// ---- per-scene arrangements: saved on every edit, restored when the scene comes back (and after a reload)
let arrT = 0;
function rememberArrangement() {
  if (!isHost() || !S.state.scene) return;
  clearTimeout(arrT);
  const id = S.state.scene, els = S.state.elements;
  arrT = setTimeout(() => {
    const all = store.get('arrangements', {});
    all[id] = { layout: S.state.layout, elements: els.map((e) => (e.type === 'image' && S.assets.get(e.asset)?.data ? { ...e, _data: S.assets.get(e.asset).data } : e)), t: Date.now() };
    store.set('arrangements', all);
  }, 300);
}
function arrangement(id) {
  const a = store.get('arrangements', {})[id];
  if (!a?.elements?.length) return null;
  const els = a.elements.map(({ _data, ...e }) => e);
  const missing = a.elements.filter((e) => e._data && !assetImg(e.asset));
  if (missing.length) rehydrate(missing);
  return els;
}
// Images saved with a scene come back into a new studio by uploading their pixels again.
async function rehydrate(list) {
  for (const m of list) {
    try {
      const asset = await storeAsset(m._data);
      const els = elementsCopy(), e = els.find((x) => x.id === m.id);
      if (e) { e.asset = asset; setStage({ elements: els }); }
    } catch {}
  }
}
function resetScene() {
  const id = S.state.scene;
  if (!id) return toast('Pick a scene first.');
  const all = store.get('arrangements', {}); delete all[id]; store.set('arrangements', all);
  const sc = sceneList().find((x) => x.id === id);
  if (sc) applyScene(sc);
  toast('Scene reset to its original layout.');
}

// When anyone starts presenting, the host's stage flips to a presentation scene, and back afterwards.
const hasMediaScene = () => S.state.layout === 'custom' && (S.state.elements || []).some((e) => e.type === 'media');
function autoPresentScene(id) {
  if (!isHost()) return;
  const patch = { presenter: id };
  if (!hasMediaScene()) {
    S.prePres = { layout: S.state.layout, elements: elementsCopy(), scene: S.state.scene || '' };
    Object.assign(patch, templatePatch(isVertical() ? TPL['v-present'] : TPL['present-full']));
  }
  setStage(patch);
}
function autoEndPresentScene() {
  if (!isHost()) return;
  const still = participants().find((p) => p.sharing);
  if (still) return setStage({ presenter: still.id });
  if (S.prePres) { const pre = S.prePres; S.prePres = null; setStage({ ...pre, presenter: '' }); }
  else setStage({ presenter: '' });
}

// Images: uploaded once per studio, cached as decoded <img> for drawing.
S.assets = new Map(); // id -> { img, data, loading }
function assetImg(id) {
  if (!id || typeof id !== 'string') return null;
  let a = S.assets.get(id);
  if (!a && id.startsWith('local-brand-')) {
    const data = store.get('brandImgs', {})[id.slice(12)];
    if (data) { setAssetData(id, data); a = S.assets.get(id); }
  }
  if (!a) {
    a = { img: null, data: null, loading: true };
    S.assets.set(id, a);
    if (S.studio && !id.startsWith('local-')) api('assetGet', { ...creds(), asset: id }).then((r) => setAssetData(id, r.data)).catch(() => { a.loading = false; });
  }
  return a.img;
}
function setAssetData(id, data) {
  const a = S.assets.get(id) || {};
  const img = new Image();
  img.onload = () => { a.img = img; a.loading = false; renderEditor(); };
  img.src = data;
  a.data = data;
  S.assets.set(id, a);
}
async function storeAsset(data) {
  if (S.studio) { const { id } = await api('assetPut', { ...creds(), data }); setAssetData(id, data); return id; }
  const id = 'local-' + uid(); setAssetData(id, data); return id;
}
// Downscale big uploads so they fit the studio store and draw fast.
function compressImage(file) {
  return new Promise((res, rej) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return rej(new Error('Use a PNG, JPEG, WebP or GIF image.'));
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const max = 1280, k = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      let q = .9, out = c.toDataURL('image/webp', q);
      while (out.length > 850_000 && q > .4) { q -= .15; out = c.toDataURL('image/webp', q); }
      URL.revokeObjectURL(img.src);
      out.length > 900_000 ? rej(new Error('That image is too large. Try a smaller one.')) : res(out);
    };
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}
// When the host creates a studio, images added beforehand are uploaded and re-pointed.
async function uploadLocalAssets(elements) {
  const out = [];
  for (const e of elements || []) {
    if (e?.type === 'image' && typeof e.asset === 'string' && e.asset.startsWith('local-')) {
      const data = S.assets.get(e.asset)?.data;
      out.push(data ? { ...e, asset: await storeAsset(data).catch(() => '') } : e);
    } else out.push(e);
  }
  return out;
}

function wrapLines(text, maxW, maxLines = 99) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (let w of words) {
    while (g.measureText(w).width > maxW && w.length > 1) { // hard-break very long words
      let i = w.length; while (i > 1 && g.measureText(w.slice(0, i)).width > maxW) i--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, i)); w = w.slice(i);
    }
    const test = cur ? cur + ' ' + w : w;
    if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…'); }
  return lines;
}
const px = (e) => ({ x: e.x * W, y: e.y * H, w: e.w * W, h: e.h * H });

function drawChatEl(e, t) {
  const r = px(e), pad = 14, fs = e.size, lh = fs * 1.35;
  const now = Date.now();
  // "Guests only" studio chat stays backstage: the stage is what viewers see.
  const msgs = S.feed.filter((m) => !m.guestsOnly && !isModerated(m) && (!e.fade || now - m.ts < 90_000)).slice(-e.max);
  g.save();
  rr(r.x, r.y, r.w, r.h, 12); g.clip();
  if (e.bg) drawPanel(r.x, r.y, r.w, r.h, 12);
  let y = r.y + r.h - pad;
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  for (let i = msgs.length - 1; i >= 0 && y > r.y + pad; i--) {
    const m = msgs[i];
    g.font = `700 ${fs}px Inter, sans-serif`;
    const nameW = g.measureText(m.name + '  ').width;
    g.font = `500 ${fs}px Inter, sans-serif`;
    const lines = wrapLines(m.text, r.w - pad * 2 - 6, 4);
    // First line shares its row with the name.
    const first = wrapLines(m.text, Math.max(40, r.w - pad * 2 - nameW - 14))[0] || '';
    const rest = wrapLines(m.text.slice(m.text.indexOf(first) + first.length).trim(), r.w - pad * 2 - 14, 3);
    const rows = [first, ...rest.filter(Boolean)];
    const blockH = rows.length * lh + 8;
    const top = y - blockH;
    if (top < r.y + pad - lh) break;
    const age = (now - m.ts) / 1000, alpha = e.fade ? Math.max(0, Math.min(1, (90 - age) / 10)) : 1;
    const enter = Math.min(1, (now - m.ts) / 250);
    g.globalAlpha = alpha * enter;
    const dot = SRC_COLOR[m.src] || S.state.brand.color;
    g.fillStyle = dot; g.beginPath(); g.arc(r.x + pad + 4, top + lh * .62, 4, 0, Math.PI * 2); g.fill();
    g.font = `700 ${fs}px Inter, sans-serif`; g.fillStyle = m.color || '#9ec5ff';
    g.fillText(m.name, r.x + pad + 14, top + lh * .85);
    g.font = `500 ${fs}px Inter, sans-serif`; g.fillStyle = '#ffffff';
    rows.forEach((line, j) => g.fillText(line, j === 0 ? r.x + pad + 14 + nameW : r.x + pad + 14, top + lh * (.85 + j)));
    y = top - 6;
    g.globalAlpha = 1;
    void lines;
  }
  if (!msgs.length) {
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `500 ${Math.max(13, fs * .8)}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(S.state.feeds?.twitch ? 'Waiting for chat…' : 'Chat will appear here', r.x + r.w / 2, r.y + r.h / 2);
  }
  g.restore();
}
function drawTextEl(e) {
  const r = px(e);
  g.save();
  g.font = `${e.bold ? 800 : 500} ${e.size}px "Plus Jakarta Sans", Inter, sans-serif`;
  const lines = wrapLines(e.text, r.w - (e.bg ? 32 : 0));
  const lh = e.size * 1.15, total = lines.length * lh;
  if (e.bg) { g.fillStyle = e.bg; rr(r.x, r.y, r.w, Math.max(r.h, total + 20), 10); g.fill(); }
  g.fillStyle = e.color; g.textBaseline = 'middle'; g.textAlign = e.align;
  const ax = e.align === 'center' ? r.x + r.w / 2 : e.align === 'right' ? r.x + r.w - (e.bg ? 16 : 0) : r.x + (e.bg ? 16 : 0);
  const top = r.y + Math.max(0, (Math.max(r.h, total + (e.bg ? 20 : 0)) - total) / 2);
  if (!e.bg) { g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 12; g.shadowOffsetY = 2; }
  lines.forEach((l, i) => g.fillText(l, ax, top + lh * (i + .5)));
  g.restore();
}
function drawImageEl(e) {
  const r = px(e), img = assetImg(e.asset);
  g.save();
  if (!img) {
    editorOnly((c) => { c.strokeStyle = 'rgba(255,255,255,.35)'; c.setLineDash([6, 6]); c.lineWidth = 2; c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 8); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.6)'; c.font = '500 14px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(e.asset ? 'Loading image…' : 'Choose an image', r.x + r.w / 2, r.y + r.h / 2); });
    g.restore(); return;
  }
  g.globalAlpha = e.opacity;
  if (e.radius) { rr(r.x, r.y, r.w, r.h, e.radius); g.clip(); }
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const s = e.fit === 'cover' ? Math.max(r.w / iw, r.h / ih) : Math.min(r.w / iw, r.h / ih);
  const dw = iw * s, dh = ih * s;
  g.drawImage(img, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  g.restore();
}
// The match scoreboard: two coloured sides with big scores, round and map between them. A score that just changed flashes.
const scoreSeen = new Map();
function drawScoreEl(e) {
  // Broadcast scoreboard: a dark glass bar, a solid team-colour score tile on each side, team colour along the
  // outer edges, a centre capsule (VS, or round + map). The leader's tile glows; a new point flashes and pops.
  const r = px(e), h = r.h, R = Math.min(16, h * 0.28), now = performance.now();
  const prev = scoreSeen.get(e.id) || { sa: e.sa, sb: e.sb, ta: 0, tb: 0 };
  if (prev.sa !== e.sa) { prev.ta = now; prev.sa = e.sa; } if (prev.sb !== e.sb) { prev.tb = now; prev.sb = e.sb; }
  scoreSeen.set(e.id, prev);
  const info = e.round || e.map;
  const mid = info ? Math.min(r.w * 0.22, h * 2.1) : h * 0.95, side = (r.w - mid) / 2, tileW = Math.min(side * 0.36, h * 1.15);
  const lead = Number(e.sa) === Number(e.sb) ? 0 : Number(e.sa) > Number(e.sb) ? -1 : 1;
  g.save();
  // bar
  g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 22; g.shadowOffsetY = 8;
  const bg = g.createLinearGradient(0, r.y, 0, r.y + h); bg.addColorStop(0, 'rgba(18,24,44,.94)'); bg.addColorStop(1, 'rgba(7,10,22,.94)');
  rr(r.x, r.y, r.w, h, R); g.fillStyle = bg; g.fill();
  g.shadowColor = 'transparent';
  g.save(); rr(r.x, r.y, r.w, h, R); g.clip();
  const team = (left, col, name, score, flashAt, leads) => {
    const x0 = left ? r.x : r.x + side + mid;
    // team colour wash fading toward the centre, plus a solid edge
    const wash = g.createLinearGradient(left ? x0 : x0 + side, 0, left ? x0 + side : x0, 0);
    wash.addColorStop(0, hexA(col, .34)); wash.addColorStop(1, hexA(col, 0));
    g.fillStyle = wash; g.fillRect(x0, r.y, side, h);
    g.fillStyle = col; g.fillRect(left ? x0 : x0 + side - h * .07, r.y, h * .07, h);
    // score tile on the inner side
    const tx = left ? x0 + side - tileW : x0, pop = Math.max(0, 1 - (now - flashAt) / 700);
    const tg = g.createLinearGradient(0, r.y, 0, r.y + h); tg.addColorStop(0, hexA(col, 1)); tg.addColorStop(1, hexA(col, .72));
    g.fillStyle = tg; g.fillRect(tx, r.y, tileW, h);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(tx, r.y, tileW, h * .42); // glass sheen
    if (leads) { g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(tx, r.y, tileW, h); }
    if (pop > 0) { g.fillStyle = `rgba(255,255,255,${pop * .45})`; g.fillRect(tx, r.y, tileW, h); }
    g.save();
    g.translate(tx + tileW / 2, r.y + h / 2 + 1); const sc = 1 + pop * .22; g.scale(sc, sc);
    g.font = `900 ${h * .56}px "JetBrains Mono", ui-monospace, monospace`; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 6; g.fillText(String(score), 0, 0);
    g.restore();
    // name
    g.font = `800 ${h * .27}px Inter, sans-serif`; g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = left ? 'left' : 'right';
    const nx = left ? x0 + h * .3 : x0 + side - h * .3, maxW = side - tileW - h * .5;
    let nm = String(name || '').toUpperCase(); while (nm.length > 1 && g.measureText(nm).width > maxW) nm = nm.slice(0, -1);
    g.fillText(nm, left ? nx : nx, r.y + h / 2 + 1);
    if (leads) { g.fillStyle = hexA(col, .9); const d = h * .07; g.beginPath(); g.arc(left ? nx + g.measureText(nm).width + h * .22 : nx - g.measureText(nm).width - h * .22, r.y + h / 2, d, 0, Math.PI * 2); g.fill(); }
  };
  team(true, e.ca, e.a, e.sa, prev.ta, lead === -1);
  team(false, e.cb, e.b, e.sb, prev.tb, lead === 1);
  // centre capsule
  const cx = r.x + side + mid / 2;
  g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(r.x + side, r.y, mid, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (info) {
    g.font = `800 ${h * .22}px Inter, sans-serif`; g.fillStyle = 'rgba(255,255,255,.95)'; g.fillText(String(e.round || '').toUpperCase(), cx, r.y + h * (e.map ? .37 : .5));
    if (e.map) { g.font = `600 ${h * .17}px Inter, sans-serif`; g.fillStyle = 'rgba(203,213,225,.75)'; g.fillText(e.map, cx, r.y + h * .68); }
  } else { g.font = `800 ${h * .24}px Inter, sans-serif`; g.fillStyle = 'rgba(226,232,240,.75)'; g.fillText('VS', cx, r.y + h / 2 + 1); }
  g.restore();
  rr(r.x + .5, r.y + .5, r.w - 1, h - 1, R); g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.stroke();
  g.restore();
}
function drawTimerEl(e) {
  const r = px(e);
  let label;
  if (e.mode === 'countdown') { const left = Math.max(0, e.target - Date.now()); label = e.target ? fmtTime(left + 999) : '00:00'; }
  else label = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  g.save();
  if (e.bg) { g.fillStyle = e.bg; rr(r.x, r.y, r.w, r.h, 10); g.fill(); }
  g.font = `800 ${e.size}px "JetBrains Mono", ui-monospace, monospace`; g.fillStyle = e.color; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!e.bg) { g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 10; }
  g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 2);
  g.restore();
}
function presenterOf() {
  const people = participants();
  return people.find((p) => p.id === S.state.presenter && p.sharing) || people.find((p) => p.sharing) || null;
}
function drawMediaEl(e, t = performance.now()) {
  const r = smoothTileRect('__media__', { ...px(e), r: e.radius ?? 12 }, t), R = r.r ?? (e.radius ?? 12), who = presenterOf();
  const src = who ? (who.me ? S.local.pres?.source : $('#pres-' + cssId(who.id))) : null;
  const sw = src ? (src.videoWidth || src.width) : 0, sh = src ? (src.videoHeight || src.height) : 0;
  g.save();
  rr(r.x, r.y, r.w, r.h, R); g.clip();
  g.fillStyle = '#05070d'; g.fillRect(r.x, r.y, r.w, r.h);
  if (src && sw && sh && (src.readyState === undefined || src.readyState >= 2)) {
    const k = Math.min(r.w / sw, r.h / sh), dw = sw * k, dh = sh * k;
    g.drawImage(src, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  } else {
    const hint = who ? `Waiting for ${who.name}'s screen…` : 'Click or drop a PDF, video or image here';
    editorOnly((c) => { c.fillStyle = 'rgba(255,255,255,.5)'; c.font = '500 17px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(hint, r.x + r.w / 2, r.y + r.h / 2); });
  }
  g.restore();
  if (who && S.state.brand.names) {
    const label = `${who.name} is presenting`; // the program is shared, so never "you"
    g.font = '600 14px Inter, sans-serif';
    const tw = g.measureText(label).width;
    g.fillStyle = 'rgba(5,8,16,.72)'; rr(r.x + 12, r.y + 12, tw + 24, 28, 8); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, r.x + 24, r.y + 26.5);
  }
}
const AI_NAME = { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', grok: 'Grok' };
function plainMd(t) {
  return String(t).replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ');
}
function drawAiEl(e) {
  const r = px(e), fs = e.size || 22, pad = 22, lh = fs * 1.38;
  const items = S.ai.items, a = stageAnswer();
  const q = a ? items[items.indexOf(a) - 1] : [...items].reverse().find((i) => i.role === 'user');
  if (a && a.say && !a.text) a.text = a.say;
  g.save();
  rr(r.x, r.y, r.w, r.h, 16); g.clip();
  drawPanel(r.x, r.y, r.w, r.h, 16);
  const prov = (a || q)?.provider || S.aiProv || 'claude';
  drawOrb(r.x + pad + 10, r.y + pad + 10, 10, performance.now());
  g.fillStyle = 'rgba(255,255,255,.95)'; g.font = `800 17px ${stageFont()}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(S.aiName, r.x + pad + 30, r.y + pad + 10);
  const nw = g.measureText(S.aiName).width;
  g.fillStyle = 'rgba(220,230,255,.6)'; g.font = '600 13px Inter, sans-serif';
  g.fillText(`${AI_NAME[prov]} · ${{ thinking: 'thinking…', speaking: 'speaking', listening: 'listening' }[S.aiStatus] || 'producer'}`, r.x + pad + 40 + nw, r.y + pad + 11);
  let y = r.y + pad + 40;
  const maxW = r.w - pad * 2;
  if (!q) {
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `500 ${fs}px Inter, sans-serif`; g.textBaseline = 'alphabetic';
    g.fillText('Ready for questions.', r.x + pad, y + fs); // viewers see this: no editor instructions
    g.restore(); return;
  }
  g.font = `700 ${fs}px "Plus Jakarta Sans", Inter, sans-serif`; g.fillStyle = '#ffffff'; g.textBaseline = 'alphabetic';
  for (const l of wrapLines(q.text, maxW, 2)) { g.fillText(l, r.x + pad, y + fs); y += lh; }
  y += 10;
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.moveTo(r.x + pad, y); g.lineTo(r.x + r.w - pad, y); g.stroke();
  y += 14;
  if (a) {
    g.font = `500 ${fs}px Inter, sans-serif`;
    const lines = [];
    for (const para of plainMd(a.text).split(/\n+/)) { if (!para.trim()) continue; lines.push(...wrapLines(para, maxW)); lines.push(''); }
    if (!a.done) { if (!lines.length) lines.push(''); lines[lines.length - (lines[lines.length - 1] === '' ? 2 : 1)] += Date.now() % 900 < 450 ? ' ▍' : ''; }
    const room = Math.max(1, Math.floor((r.y + r.h - pad - y) / lh));
    const shown = lines.length > room ? lines.slice(lines.length - room) : lines; // keep the newest text in view
    g.fillStyle = a.error ? '#ff9b9b' : 'rgba(235,242,255,.95)';
    for (const l of shown) { g.fillText(l, r.x + pad, y + fs); y += l ? lh : lh * .45; }
  }
  g.restore();
}
const TIP_INFO = {
  gather: { name: 'Tip here', color: '#4c8dff' }, paypal: { name: 'PayPal', color: '#0070e0' }, venmo: { name: 'Venmo', color: '#008cff' }, cashapp: { name: 'Cash App', color: '#00d64f' },
  stripe: { name: 'Stripe', color: '#635bff' }, kofi: { name: 'Ko-fi', color: '#ff5e5b' }, patreon: { name: 'Patreon', color: '#f96854' },
  bmc: { name: 'Buy Me a Coffee', color: '#ffdd00' }, link: { name: 'Website', color: '#4c8dff' },
};
const qrCache = new Map();
let qrLib = null;
function qrFor(url) {
  if (qrCache.has(url)) return qrCache.get(url);
  qrCache.set(url, null);
  (qrLib ||= new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/vendor/qrcode.js'; sc.onload = () => res(window.qrcode); sc.onerror = rej; document.head.append(sc); }))
    .then((qrcode) => { const q = qrcode(0, 'M'); q.addData(url); q.make(); qrCache.set(url, q); }).catch(() => { qrLib = null; });
  return null;
}
async function qrReadyFor(url) {
  const cached = qrFor(url);
  if (cached) return cached;
  try {
    const qrcode = await qrLib;
    if (!qrcode) return null;
    if (qrCache.get(url)) return qrCache.get(url);
    const q = qrcode(0, 'M'); q.addData(url); q.make(); qrCache.set(url, q);
    return q;
  } catch { return null; }
}
function drawTipEl(e) {
  const r = px(e), info = TIP_INFO[e.provider] || TIP_INFO.link, pad = 16;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
  g.fillStyle = '#ffffff'; rr(r.x, r.y, r.w, r.h, 16); g.fill();
  g.shadowColor = 'transparent';
  const qs = r.h - pad * 2;
  drawQr(tipUrl(e.provider, e.url) || e.url, r.x + pad, r.y + pad, qs);
  const tx = r.x + pad * 2 + qs, tw = r.w - (tx - r.x) - pad;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = info.color; rr(tx, r.y + pad, Math.min(tw, 14 + g.measureText(info.name).width + 30), 24, 6); g.fill();
  g.fillStyle = e.provider === 'bmc' ? '#111' : '#fff'; g.font = '700 13px Inter, sans-serif'; g.fillText(info.name, tx + 10, r.y + pad + 16.5);
  g.fillStyle = '#0b1020'; g.font = '800 22px "Plus Jakarta Sans", Inter, sans-serif';
  wrapLines(e.label || 'Support the show', tw, 2).forEach((l, i) => g.fillText(l, tx, r.y + pad + 58 + i * 26));
  g.fillStyle = '#4b5563'; g.font = '500 14px Inter, sans-serif';
  const handle = (e.url || '').replace(/^https?:\/\/(www\.)?/, '');
  g.fillText(wrapLines(handle, tw, 1)[0] || '', tx, r.y + r.h - pad - 4);
  g.restore();
}
// ---- super chat alert on the stream: a burst of the amount, who sent it and their message, ~6 s
const SC_TIER = (a) => (a >= 50 ? ['#f43f5e', '#fb7185'] : a >= 20 ? ['#f59e0b', '#fbbf24'] : a >= 10 ? ['#22c55e', '#4ade80'] : [accentOf(), mixHex(accentOf(), '#ffffff', 0.3)]);
const scAnim = { id: '', t0: 0, parts: [] };
function drawScAlert(t) {
  const a = S.state.scAlert;
  if (!a?.id) return;
  const life = 5200 + Math.min(3000, (a.text || '').length * 25);
  if (Date.now() - (a.ts || 0) > life + 1500) return; // a stale alert from before this page loaded
  if (scAnim.id !== a.id) {
    scAnim.id = a.id; scAnim.t0 = t;
    const n = Math.min(70, 24 + a.amount);
    scAnim.parts = Array.from({ length: n }, () => ({ a: Math.random() * Math.PI * 2, v: 0.35 + Math.random() * 0.75, r: 4 + Math.random() * 7, spin: Math.random() * 6 - 3, hue: Math.random() }));
  }
  const el = t - scAnim.t0;
  if (el > life) return;
  const [c1, c2] = SC_TIER(a.amount);
  const inK = Math.min(1, el / 520), outK = Math.max(0, (el - (life - 450)) / 450);
  const ease = 1 - Math.pow(1 - inK, 3), pop = inK < 1 ? 0.6 + 0.4 * ease + Math.sin(inK * Math.PI) * 0.08 : 1;
  const alpha = 1 - outK;
  const cx = W / 2, cy = H * 0.3, k = Math.min(W / 1280, H / 720);
  g.save();
  // confetti burst from behind the card
  for (const p of scAnim.parts) {
    const d = Math.min(1, el / 1600), dist = (1 - Math.pow(1 - d, 2.4)) * p.v * 520 * k;
    const x = cx + Math.cos(p.a) * dist, y = cy + Math.sin(p.a) * dist * 0.6 + d * d * 240 * k;
    g.globalAlpha = Math.max(0, 1 - el / 2200) * alpha;
    g.fillStyle = p.hue > 0.66 ? '#fff' : p.hue > 0.33 ? c2 : c1;
    g.save(); g.translate(x, y); g.rotate(p.spin * d * 3); g.fillRect(-p.r * k, -p.r * 0.45 * k, p.r * 2 * k, p.r * 0.9 * k); g.restore();
  }
  g.globalAlpha = alpha;
  g.translate(cx, cy - outK * 30 * k); g.scale(pop * k, pop * k);
  const amount = money(a.amount);
  const who = `${a.name} ${a.bounty ? 'set a bounty' : a.voice ? 'sent a voice super chat' : 'sent a super chat'}`;
  g.font = '500 24px Inter, sans-serif';
  const lines = a.text ? wrapLines(a.text, 640, 2) : [];
  const cw = 720, ch = 168 + lines.length * 32, x0 = -cw / 2, y0 = -78;
  g.shadowColor = c1; g.shadowBlur = 50;
  const grd = g.createLinearGradient(x0, y0, x0 + cw, y0 + ch); grd.addColorStop(0, 'rgba(11,16,32,.94)'); grd.addColorStop(1, 'rgba(17,24,39,.88)');
  g.fillStyle = grd; rr(x0, y0, cw, ch, 28); g.fill();
  g.shadowBlur = 0; g.lineWidth = 3; g.strokeStyle = c2; rr(x0, y0, cw, ch, 28); g.stroke();
  // the amount, with a shine sweeping across it
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = '900 84px Inter, sans-serif';
  const ag = g.createLinearGradient(-200, 0, 200, 0); ag.addColorStop(0, '#ffffff'); ag.addColorStop(0.5, c2); ag.addColorStop(1, c1);
  g.fillStyle = ag; g.fillText(amount, 0, 12);
  const sweep = ((el % 2400) / 2400) * 600 - 300;
  g.save(); g.globalCompositeOperation = 'source-atop'; const sh = g.createLinearGradient(sweep - 40, 0, sweep + 40, 0); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,.55)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillText(amount, 0, 12); g.restore();
  g.fillStyle = '#fff'; g.font = '700 26px Inter, sans-serif'; g.fillText((a.voice ? '🎙 ' : a.bounty ? '🎯 ' : '') + who, 0, 54);
  g.fillStyle = 'rgba(255,255,255,.88)'; g.font = '500 24px Inter, sans-serif';
  lines.forEach((l, i) => g.fillText(l, 0, 96 + i * 32));
  g.restore();
}
/** Show a super chat on the stream with its sound (into the program mix, so every platform hears it). */
function superAlert(x) {
  setStage({ scAlert: { id: x.id + ':' + Date.now().toString(36), name: x.name, amount: x.amount, text: x.text || '', voice: !!x.voice, bounty: !!x.bounty, ts: Date.now() } });
  cashChime(x.amount);
}
function cashChime(amt) {
  try {
    const ctx = audioCtx(), out = ctx.createGain(); out.gain.value = 0.9;
    const notes = amt >= 50 ? [784, 988, 1175, 1568, 1976] : amt >= 20 ? [784, 988, 1319, 1568] : [880, 1319, 1760];
    const t0 = ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), gn = ctx.createGain(), t = t0 + i * 0.075;
      o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.setValueAtTime(f, t);
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.12, t + 0.015); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(gn).connect(out); o.start(t); o.stop(t + 0.55);
    });
    const mix = mixInMedia(out, { duck: false, monitor: true });
    setTimeout(() => mix.dispose(), 1200);
  } catch {}
}
/** A super chat's voice message: preview it (only you) or play it on air. */
const scVoiceCache = new Map();
let scVoicePlaying = null;
async function playScVoice(x, onAir) {
  try {
    scVoicePlaying?.stop();
    if (!scVoiceCache.has(x.id)) scVoiceCache.set(x.id, (await api('scVoice', { ...creds(), sc: x.id })).data);
    const a = new Audio(scVoiceCache.get(x.id));
    const mix = onAir ? mixInMedia(audioCtx().createMediaElementSource(a), { duck: false, monitor: true }) : null;
    if (onAir && isHost()) {
      setStage({ voiceOnAir: { id: x.id, name: x.name, amount: x.amount, dur: x.voice || 10, ts: Date.now() } });
      if (duckBus && actx) { try { duckBus.gain.setTargetAtTime(0.18, actx.currentTime, 0.08); } catch {} }
    }
    const stop = () => {
      try { a.pause(); } catch {}
      mix?.dispose();
      if (onAir && isHost()) {
        if (S.state.voiceOnAir?.id === x.id) setStage({ voiceOnAir: null });
        if (duckBus && actx) { try { duckBus.gain.setTargetAtTime(1, actx.currentTime, 0.25); } catch {} }
      }
      if (scVoicePlaying?.a === a) scVoicePlaying = null;
    };
    a.onended = stop; scVoicePlaying = { a, stop };
    await a.play();
    if (onAir) toast(`Playing ${x.name}’s voice super chat on air (music ducked).`);
  } catch (e) { toast(e.message || 'Couldn’t play that voice message.', { err: true }); }
}

const featAnim = { key: '', t0: 0 };
function drawFeatured(t, r) {
  const f = S.state.featured;
  if (!f) return;
  if (featAnim.key !== f.id) { featAnim.key = f.id; featAnim.t0 = t; }
  drawThemedFeatured(g, W, H, f, S.state.brand, stageFont(), t - featAnim.t0, r);
}

// ---------------------------------------------------------------- layout editor (host)
const editor = { on: false, sel: null, drag: null, commitT: null };
function elementsCopy() { return (S.state.elements || []).map((e) => ({ ...e })); }
function selEl() { return (S.state.elements || []).find((e) => e.id === editor.sel) || null; }
function commitElements(delay = 0) {
  clearTimeout(editor.commitT);
  editor.commitT = setTimeout(() => setStage({ elements: S.state.elements }), delay);
}
function addElement(type, { edit = true } = {}) {
  const e = withDefaults({ type });
  if (type === 'slot') {
    const used = new Set((S.state.elements || []).filter((x) => x.type === 'slot').map((x) => x.index));
    e.index = [0, 1, 2, 3, 4, 5].find((i) => !used.has(i)) ?? 0;
  }
  const els = stageElements();
  const spot = freeSpot(e, els);
  if (spot) Object.assign(e, spot);
  else { e.stack = true; toast(`No free space for the ${String(ELABEL[type] || type || 'element').toLowerCase()}, so it’s stacked on top. Drag it where you want it.`, { ms: 4200 }); }
  e.home = [e.x, e.y, e.w, e.h];
  const patch = { elements: [...els, e] };
  if (type === 'slot' && S.state.layout !== 'custom') patch.layout = 'custom';
  setStage(patch);
  if (edit) { editor.sel = e.id; setEditing(true); }
  return e;
}
/** First position on the 8px grid (scanning in 32px steps, inside action-safe) where a rect overlaps nothing. */
function freeSpot(e, els) {
  if (!blockerFor(e, e, els)) return null;
  const step = 32;
  for (let y = Math.round(SAFE.action * H / GRID) * GRID; y + e.h * H <= H * (1 - SAFE.action); y += step) {
    for (let x = Math.round(SAFE.action * W / GRID) * GRID; x + e.w * W <= W * (1 - SAFE.action); x += step) {
      const r = { x: x / W, y: y / H, w: e.w, h: e.h };
      if (!blockerFor(r, e, els)) return { x: r.x, y: r.y };
    }
  }
  return false;
}
function setEditing(on) {
  editor.on = on && isHost();
  document.body.classList.toggle('editing', editor.on);
  $('#editLayer').hidden = !editor.on;
  $('#editToggle').setAttribute('aria-pressed', String(editor.on));
  $('#editToggle').textContent = editor.on ? 'Done editing' : 'Edit on stage';
  renderEditor();
  evaluateSceneSuggestion();
}
const ELABEL = { bounty: 'Bounty board', score: 'Scoreboard', slot: 'Camera', chat: 'Chat box', text: 'Text', image: 'Image', timer: 'Timer', media: 'Presentation', ai: 'AI window', tip: 'Support card', callin: 'Watch link card', shape: 'Colour block', banner: 'Lower third', ticker: 'Ticker', logo: 'Logo', ads: 'Sponsor ads', featured: 'Featured chat', captions: 'Captions' };
function elName(e) {
  if (e.type === 'slot') return `Camera ${e.index + 1}`;
  if (e.type === 'text') return e.text ? `“${e.text.slice(0, 22)}”` : 'Text';
  if (e.type === 'timer') return e.mode === 'countdown' ? 'Countdown' : 'Clock';
  if (e.type === 'score') return 'Scoreboard';
  if (e.type === 'bounty') return 'Bounty board';
  if (e.type === 'tip') return `${(TIP_INFO[e.provider] || TIP_INFO.link).name} card`;
  if (e.type === 'shape' && e.label) return e.label;
  if (e.type === 'slot' && e.pip) return `Camera ${e.index + 1} (PiP)`;
  return ELABEL[e.type];
}
/** Whether a layer currently paints something on the program. */
function inUse(e) {
  switch (e.type) {
    case 'banner': return !!S.state.banner;
    case 'ticker': return !!S.state.ticker;
    case 'logo': return !!S.state.brand?.logo;
    case 'ads': return !!(S.state.ads?.on && S.state.ads.items?.length);
    case 'featured': return !!S.state.featured;
    case 'captions': return !!S.state.captions?.on;
    default: return true;
  }
}
function editableEls() {
  const custom = S.state.layout === 'custom';
  return (S.state.elements || []).filter((e) => custom || !['slot', 'media'].includes(e.type));
}
function renderEditor() {
  const els = S.state.elements || [];
  if (editor.sel && !els.some((e) => e.id === editor.sel)) editor.sel = null;
  if (editor.on && isHost() && els.length && ensureSystem(els, isVertical(), uid).length !== els.length) { setStage({ elements: els }); return; }
  // Boxes on the stage, painted in the same order as the program
  const layer = $('#editLayer');
  if (editor.on) {
    // Only what's on the picture: empty reserved spots (no banner, captions off, no sponsor…) stay out of the way
    // unless you pick them in the Layers list. Hidden layers show only when selected.
    const boxes = drawOrder(editableEls().filter((e) => e.id === editor.sel || (inUse(e) && !e.hidden))).map((e) => {
      const d = document.createElement('div');
      d.className = 'ebox' + (e.id === editor.sel ? ' sel' : '') + (e.locked ? ' locked' : '') + (e.hidden ? ' ghost' : '') + (e.stack ? ' stacked' : '');
      d.dataset.id = e.id; d.dataset.tier = tierOf(e);
      Object.assign(d.style, { left: e.x * 100 + '%', top: e.y * 100 + '%', width: e.w * 100 + '%', height: e.h * 100 + '%' });
      const lab = document.createElement('span'); lab.className = 'pill on-media elab';
      lab.innerHTML = (e.locked ? icon('lock', { size: 'sm' }) : '') + (e.hidden ? icon('eye-off', { size: 'sm' }) : '');
      lab.append(document.createTextNode(elName(e)));
      d.append(lab);
      if (!e.locked && !e.hidden) for (const h of ['nw', 'ne', 'sw', 'se']) { const k = document.createElement('i'); k.className = 'ehandle h-' + h; k.dataset.h = h; d.append(k); }
      return d;
    });
    const safe = document.createElement('div'); safe.className = 'safe-guides'; safe.setAttribute('aria-hidden', 'true');
    safe.innerHTML = `<i class="safe action" style="inset:${SAFE.action * 100}%"></i><i class="safe title" style="inset:${SAFE.title * 100}%"></i>`;
    const guides = document.createElement('div'); guides.className = 'snap-guides'; guides.id = 'snapGuides';
    replaceKids(layer, safe, ...boxes, guides);
    layer.style.setProperty('--grid-x', (GRID / W * 100) + '%'); layer.style.setProperty('--grid-y', (GRID / H * 100) + '%');
  }
  renderLayers();
  renderProps();
  renderStageToolbar();
}
// Layers: top of the list is on top of the picture, grouped by tier. Eye hides, lock freezes, reset sends home.
function renderLayers() {
  const list = $('#elList');
  if (!list) return;
  const els = editableEls(), host = isHost();
  const rows = [];
  for (const tier of [...TIERS].reverse()) {
    const inTier = els.filter((e) => tierOf(e) === tier.id).reverse();
    if (!inTier.length) continue;
    const head = document.createElement('li'); head.className = 'layer-head caps'; head.textContent = tier.label;
    rows.push(head);
    for (const e of inTier) {
      const li = document.createElement('li');
      li.className = 'el-row' + (e.id === editor.sel ? ' sel' : '') + (e.hidden || !inUse(e) ? ' dim' : '');
      li.dataset.id = e.id;
      const eye = toggleBtn(e.hidden ? 'eye-off' : 'eye', e.hidden ? `Show ${elName(e)}` : `Hide ${elName(e)}`, !e.hidden, () => patchEl(e.id, { hidden: !e.hidden }, e.hidden ? 'show' : 'hide'));
      const b = document.createElement('button'); b.type = 'button'; b.className = 'menu-item compact el-pick'; b.textContent = elName(e);
      b.onclick = () => { editor.sel = e.id; setEditing(true); };
      const lock = toggleBtn(e.locked ? 'lock' : 'lock-open', e.locked ? `Unlock ${elName(e)}` : `Lock ${elName(e)}`, !!e.locked, () => patchEl(e.id, { locked: !e.locked }));
      const reset = mkBtn('rotate-ccw', `Reset ${elName(e)}`, () => resetEl(e.id));
      reset.disabled = !host || !e.home;
      const tags = [];
      // system layers (banner, ticker, captions…) are meant to sit over the picture, so they carry no tag
      if (e.stack && tierOf(e) !== 'system' && !['banner', 'ticker', 'logo', 'ads', 'featured', 'captions'].includes(e.type)) { const t = document.createElement('span'); t.className = 'pill caps'; t.textContent = 'Overlaps'; t.dataset.tip = 'Allowed to overlap other layers'; tags.push(t); }
      else if (!inUse(e)) { const t = document.createElement('span'); t.className = 'el-idle'; t.textContent = 'not in use'; tags.push(t); }
      li.append(eye, b, ...tags, lock, reset);
      rows.push(li);
    }
  }
  replaceKids(list, ...rows);
  $('#elEmpty').hidden = !!els.length;
}
function toggleBtn(name, label, pressed, fn) {
  const b = mkBtn(name, label, fn);
  b.setAttribute('aria-pressed', String(pressed));
  b.classList.add('layer-toggle');
  return b;
}
// Scoreboard quick actions, from its settings and from the Play panel: 'a:1', 'b:-1', 'swap', 'reset'.
function scoreAction(id, act) {
  const e = (S.state.elements || []).find((x) => x.id === id); if (!e) return;
  if (act === 'swap') return patchEl(id, { a: e.b, b: e.a, sa: e.sb, sb: e.sa, ca: e.cb, cb: e.ca });
  if (act === 'reset') return patchEl(id, { sa: 0, sb: 0 });
  const [side, d] = act.split(':');
  patchEl(id, { ['s' + side]: Math.max(-999, Math.min(9999, (e['s' + side] || 0) + Number(d))) });
}
function renderScorePanel() {
  const box = $('#scoreQuick'); if (!box) return;
  const e = (S.state.elements || []).find((x) => x.type === 'score');
  $('#scoreAdd').hidden = !!e; box.hidden = !e;
  if (!e) return;
  for (const s of ['a', 'b']) {
    if (document.activeElement !== $('#scoreName-' + s)) $('#scoreName-' + s).value = e[s];
    $('#scoreVal-' + s).textContent = String(e['s' + s]);
    $('#scoreSide-' + s).style.setProperty('--c', e['c' + s]);
  }
  if (document.activeElement !== $('#scoreRound')) $('#scoreRound').value = e.round || '';
  if (document.activeElement !== $('#scoreMap')) $('#scoreMap').value = e.map || '';
}
function patchEl(id, patch, verb) {
  const els = elementsCopy(), e = els.find((x) => x.id === id);
  if (!e) return;
  // Showing a layer must not create an overlap: if its spot is taken, it comes back stacked and says so.
  if (verb === 'show' && !e.stack) {
    const blocker = blockerFor({ ...e }, e, els.filter((o) => o.id !== id));
    if (blocker) { patch = { ...patch, stack: true }; toast(`${elName(e)} overlaps ${elName(blocker)}, so it’s shown stacked. Move it, or turn off “Allow overlap” in its settings.`, { ms: 5000 }); }
  }
  Object.assign(e, patch);
  setStage({ elements: els });
}
function resetEl(id) {
  const els = elementsCopy(), e = els.find((x) => x.id === id);
  if (!e?.home) return;
  const [x, y, w, h] = e.home;
  Object.assign(e, { x, y, w, h, hidden: false, locked: false });
  const blocker = !e.stack && blockerFor(e, e, els);
  if (blocker) { e.stack = true; toast(`${elName(e)} is back home, stacked over ${elName(blocker)}.`); }
  setStage({ elements: els });
}
function mkBtn(name, title, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = 'icon-btn sm'; b.innerHTML = icon(name, { size: 'sm' }); b.setAttribute('aria-label', title); b.onclick = fn; b.disabled = !isHost(); return b; }
function moveEl(id, dir) {
  const els = elementsCopy(), i = els.findIndex((e) => e.id === id);
  if (i < 0) return;
  const tier = tierOf(els[i]);
  let j = i + dir;
  while (j >= 0 && j < els.length && tierOf(els[j]) !== tier) j += dir;
  if (j < 0 || j >= els.length) return toast(dir > 0 ? 'Already the top of its layer.' : 'Already the bottom of its layer.');
  [els[i], els[j]] = [els[j], els[i]];
  setStage({ elements: els });
}
function deleteEl(id) { setStage({ elements: elementsCopy().filter((e) => e.id !== id) }); }

// Property form for the selected element
function renderProps() {
  const box = $('#elProps');
  const e = selEl();
  box.hidden = !e;
  if (!e) return;
  const f = [];
  const field = (label, html) => f.push(`<label class="fld"><span>${label}</span>${html}</label>`);
  const val = (k) => String(e[k] ?? '').replace(/"/g, '&quot;');
  f.push(`<h3>${elName(e).replace(/</g, '&lt;')}</h3>`);
  if (e.type === 'slot') field('Shows', `<select data-k="index" data-num>${[0, 1, 2, 3, 4, 5].map((i) => `<option value="${i}" ${e.index === i ? 'selected' : ''}>Stage position ${i + 1}</option>`).join('')}</select>`);
  if (e.type === 'text') {
    field('Text', `<textarea data-k="text" rows="2" maxlength="200">${val('text').replace(/</g, '&lt;')}</textarea>`);
    field('Size', `<input type="range" min="14" max="140" data-k="size" data-num value="${e.size}">`);
    f.push(`<div class="row2"><label class="fld"><span>Colour</span><input type="color" data-k="color" value="${e.color}"></label><label class="fld"><span>Align</span><select data-k="align">${['left', 'center', 'right'].map((a) => `<option ${e.align === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label></div>`);
    f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="bold" ${e.bold ? 'checked' : ''}><span>Bold</span></label>`);
    f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-bg ${e.bg ? 'checked' : ''}><span>Background box</span></label>`);
    if (e.bg) field('Box colour', `<input type="color" data-k="bg" value="${e.bg}">`);
  }
  if (e.type === 'chat') {
    field('Messages shown', `<input type="range" min="2" max="15" data-k="max" data-num value="${e.max}">`);
    field('Text size', `<input type="range" min="12" max="36" data-k="size" data-num value="${e.size}">`);
    f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="bg" ${e.bg ? 'checked' : ''}><span>Dark backing</span></label>`);
    f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="fade" ${e.fade ? 'checked' : ''}><span>Fade out old messages</span></label>`);
    f.push(`<p class="hint">Shows studio chat${S.state.feeds?.twitch ? ` and Twitch #${S.state.feeds.twitch}` : '. Connect Twitch in the Chat panel to show viewer chat'}.</p>`);
  }
  if (e.type === 'image') {
    f.push(`<label class="btn sm"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload hidden>${e.asset ? 'Replace image' : 'Choose image'}</label>`);
    field('Fit', `<select data-k="fit"><option value="contain" ${e.fit === 'contain' ? 'selected' : ''}>Fit inside</option><option value="cover" ${e.fit === 'cover' ? 'selected' : ''}>Fill box</option></select>`);
    field('Opacity', `<input type="range" min="0.1" max="1" step="0.05" data-k="opacity" data-num value="${e.opacity}">`);
    field('Corner rounding', `<input type="range" min="0" max="120" data-k="radius" data-num value="${e.radius}">`);
  }
  if (e.type === 'score') {
    for (const [s, label] of [['a', 'Left side'], ['b', 'Right side']]) {
      f.push(`<div class="score-side"><label class="fld"><span>${label}</span><input data-k="${s}" maxlength="20" value="${val(s)}"></label>`
        + `<input type="color" data-k="c${s}" value="${e['c' + s]}" aria-label="${label} colour">`
        + `<div class="score-step"><button type="button" class="icon-btn sm" data-score="${s}:-1" aria-label="${label} minus one">−</button><b class="num">${e['s' + s]}</b><button type="button" class="icon-btn sm" data-score="${s}:1" aria-label="${label} plus one">+</button></div></div>`);
    }
    f.push(`<div class="row2"><label class="fld"><span>Round</span><input data-k="round" maxlength="24" value="${val('round')}" placeholder="Round 3 · Best of 5"></label><label class="fld"><span>Map / mode</span><input data-k="map" maxlength="32" value="${val('map')}" placeholder="Ascent"></label></div>`);
    f.push(`<div class="row"><button type="button" class="btn sm" data-score="swap">Swap sides</button><button type="button" class="btn sm ghost" data-score="reset">Reset scores</button></div>`);
  }
  if (e.type === 'timer') {
    field('Shows', `<select data-k="mode"><option value="clock" ${e.mode === 'clock' ? 'selected' : ''}>Current time</option><option value="countdown" ${e.mode === 'countdown' ? 'selected' : ''}>Countdown</option></select>`);
    if (e.mode === 'countdown') f.push(`<div class="row">${[1, 3, 5, 10, 15].map((m) => `<button type="button" class="btn sm" data-count="${m}">${m} min</button>`).join('')}</div>`);
    field('Size', `<input type="range" min="16" max="140" data-k="size" data-num value="${e.size}">`);
    f.push(`<div class="row2"><label class="fld"><span>Colour</span><input type="color" data-k="color" value="${e.color}"></label></div>`);
    f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-bg ${e.bg ? 'checked' : ''}><span>Background box</span></label>`);
    if (e.bg) field('Box colour', `<input type="color" data-k="bg" value="${e.bg}">`);
  }
  if (e.type === 'ai') f.push(`<label class="fld"><span>Text size</span><input type="range" min="14" max="34" data-k="size" data-num value="${e.size}"></label><p class="hint">Shows the latest question and answer from the AI panel. Long answers keep the newest lines in view.</p>`);
  if (e.type === 'media') f.push(`<label class="fld"><span>Corner rounding</span><input type="range" min="0" max="40" data-k="radius" data-num value="${e.radius}"></label><p class="hint">Shows whoever is presenting: a screen, a video or PDF slides.</p>`);
  if (e.type === 'tip') f.push(`<label class="fld"><span>Card text</span><input data-k="label" maxlength="60" value="${val('label')}"></label><p class="hint">Edit the link in Audience → Get paid → Tip QR cards.</p>`);
  if (e.type === 'shape') {
    field('Name', `<input data-k="label" maxlength="40" value="${val('label')}" placeholder="Colour block">`);
    f.push(`<div class="row2"><label class="fld"><span>Colour</span><input type="color" data-k="color" value="${e.color}"></label><label class="fld"><span>Opacity</span><input type="range" min="0.05" max="1" step="0.05" data-k="opacity" data-num value="${e.opacity ?? 1}"></label></div>`);
    field('Corner rounding', `<input type="range" min="0" max="120" data-k="radius" data-num value="${e.radius || 0}">`);
  }
  if (isSystem(e)) f.push(`<p class="hint">${{ banner: 'Shows the banner from Look → Overlays.', ticker: 'Shows the ticker text from Look → Overlays.', logo: 'Shows your logo from Look → Brand.', ads: 'Rotates your sponsor images from Look → Overlays.', featured: 'Shows a chat message you put on stage.', captions: 'Shows live captions when they’re on (Show tab).' }[e.type]}</p>`);
  const pxs = (v, n) => Math.round(v * n);
  f.push(`<p class="hint num">${pxs(e.w, W)} × ${pxs(e.h, H)} px at ${pxs(e.x, W)}, ${pxs(e.y, H)} · ${TIERS.find((t) => t.id === tierOf(e)).label} layer</p>`);
  f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="stack" ${e.stack ? 'checked' : ''}><span>Allow overlap <em class="dim">— stack it over other layers on purpose</em></span></label>`);
  if (e.type === 'slot') f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="pip" ${e.pip ? 'checked' : ''}><span>Picture-in-picture <em class="dim">— draw above the presentation</em></span></label>`);
  f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="hidden" ${e.hidden ? 'checked' : ''}><span>Hidden</span></label>`);
  f.push(`<label class="toggle-inline"><input type="checkbox" class="toggle sm" data-k="locked" ${e.locked ? 'checked' : ''}><span>Locked</span></label>`);
  f.push(`<div class="row"><button type="button" class="btn sm" data-order="1">${icon('arrow-up', { size: 'sm' })}Bring forward</button><button type="button" class="btn sm" data-order="-1">${icon('arrow-down', { size: 'sm' })}Send back</button><button type="button" class="btn sm" data-reset ${e.home ? '' : 'disabled'}>${icon('rotate-ccw', { size: 'sm' })}Reset</button></div>`);
  if (!isSystem(e)) f.push(`<button type="button" class="btn sm danger" data-del>${icon('trash-2', { size: 'sm' })}Delete ${String(ELABEL[e.type] || e.type || 'element').toLowerCase()}</button>`);
  box.innerHTML = f.join('');
  box.querySelectorAll('input, select, textarea').forEach((inp) => { inp.disabled = !isHost() && !inp.dataset.upload; });
}
$('#elProps').addEventListener('input', (ev) => {
  const e = selEl(), t = ev.target;
  if (!e || !isHost()) return;
  if (t.dataset.k) {
    const k = t.dataset.k, v = t.type === 'checkbox' ? t.checked : t.dataset.num !== undefined ? Number(t.value) : t.value;
    if (['hidden', 'locked', 'stack', 'pip'].includes(k)) {
      // Turning stacking off (or showing a layer) must not leave an overlap behind.
      if ((k === 'stack' && !v) || (k === 'hidden' && !v)) {
        const blocker = blockerFor(e, { ...e, stack: k === 'stack' ? false : e.stack, hidden: false }, (S.state.elements || []).filter((o) => o.id !== e.id));
        if (blocker) { t.checked = !v; return toast(`${elName(e)} overlaps ${elName(blocker)}. Move one of them first.`, { err: true }); }
      }
      return patchEl(e.id, { [k]: v });
    }
    e[k] = v;
    if (k === 'mode') { renderProps(); }
    commitElements(t.type === 'range' || t.tagName === 'TEXTAREA' ? 250 : 0);
  }
  if (t.dataset.bg !== undefined) { e.bg = t.checked ? (e.type === 'text' ? accentOf() : '#111827') : ''; renderProps(); commitElements(); }
});
$('#elProps').addEventListener('change', async (ev) => {
  const t = ev.target, e = selEl();
  if (!e || t.dataset.upload === undefined || !t.files?.[0]) return;
  const id = e.id;
  try {
    const data = await compressImage(t.files[0]);
    const asset = await storeAsset(data);
    const cur = (S.state.elements || []).find((x) => x.id === id);
    if (cur) { cur.asset = asset; commitElements(); renderProps(); toast('Image added.'); }
  }
  catch (err) { toast(err.message, { err: true }); }
});
$('#elProps').addEventListener('click', (ev) => {
  const e = selEl(); if (!e) return;
  const btn = ev.target.closest('button');
  if (!btn) return;
  if (btn.dataset.del !== undefined) deleteEl(e.id);
  if (btn.dataset.order) moveEl(e.id, Number(btn.dataset.order));
  if (btn.dataset.reset !== undefined) resetEl(e.id);
  if (btn.dataset.count) { e.target = Date.now() + Number(btn.dataset.count) * 60_000; commitElements(); toast(`Countdown set to ${btn.dataset.count} min.`); }
  if (btn.dataset.score) { scoreAction(e.id, btn.dataset.score); renderProps(); }
});

// Drag and resize on the stage: snaps to the 8px grid, safe areas and other layers' edges; refuses to overlap
// another layer unless it's stacked. Hold Alt (Option) while dragging to stack on purpose.
function showGuides(guides, blocked) {
  const box = $('#snapGuides');
  if (!box) return;
  replaceKids(box, ...guides.map((gd) => { const i = document.createElement('i'); i.className = `guide ${gd.axis} ${gd.kind}`; i.style[gd.axis === 'x' ? 'left' : 'top'] = gd.at * 100 + '%'; return i; }));
  $$('.ebox.blocking').forEach((b) => b.classList.remove('blocking'));
  if (blocked) $(`.ebox[data-id="${blocked.id}"]`)?.classList.add('blocking');
}
$('#editLayer').addEventListener('pointerdown', (ev) => {
  const box = ev.target.closest('.ebox');
  if (!box || !isHost()) { editor.sel = null; renderEditor(); return; }
  const e = (S.state.elements || []).find((x) => x.id === box.dataset.id);
  if (!e) return;
  editor.sel = e.id;
  if (e.locked || e.hidden) { renderEditor(); toast(`${elName(e)} is ${e.locked ? 'locked' : 'hidden'}. Change that in Layers.`); return; }
  const rect = $('#stage').getBoundingClientRect();
  box.classList.add('dragging');
  $('#editLayer').classList.add('dragging');
  editor.drag = { e, handle: ev.target.dataset.h || '', sx: ev.clientX, sy: ev.clientY, o: { x: e.x, y: e.y, w: e.w, h: e.h }, last: { x: e.x, y: e.y, w: e.w, h: e.h }, rw: rect.width, rh: rect.height, blocked: null, moved: false };
  box.setPointerCapture(ev.pointerId);
  renderProps(); renderLayers();
  $$('.ebox.sel').forEach((b) => b.classList.toggle('sel', b === box)); box.classList.add('sel');
  ev.preventDefault();
});
const clampRect = (r) => ({ ...r, x: Math.min(1 - r.w, Math.max(0, r.x)), y: Math.min(1 - r.h, Math.max(0, r.y)) });
$('#editLayer').addEventListener('pointermove', (ev) => {
  const d = editor.drag; if (!d) return;
  const dx = (ev.clientX - d.sx) / d.rw, dy = (ev.clientY - d.sy) / d.rh, o = d.o;
  const others = (S.state.elements || []).filter((x) => x !== d.e);
  let snapped;
  if (!d.handle) snapped = snapMove(clampRect({ ...o, x: o.x + dx, y: o.y + dy }), d.e, others, W, H);
  else {
    const c = { ...o };
    if (d.handle.includes('e')) c.w = o.w + dx;
    if (d.handle.includes('s')) c.h = o.h + dy;
    if (d.handle.includes('w')) { c.x = o.x + dx; c.w = o.w - dx; }
    if (d.handle.includes('n')) { c.y = o.y + dy; c.h = o.h - dy; }
    snapped = snapResize(c, d.handle, d.e, others, W, H);
    snapped.rect = { ...snapped.rect, x: Math.max(0, snapped.rect.x), y: Math.max(0, snapped.rect.y) };
    snapped.rect.w = Math.min(snapped.rect.w, 1 - snapped.rect.x); snapped.rect.h = Math.min(snapped.rect.h, 1 - snapped.rect.y);
  }
  let rect = snapped.rect, blocked = null;
  d.alt = ev.altKey;
  if (!ev.altKey && !d.e.stack) ({ rect, blocked } = resolve(d.last, rect, d.e, others));
  d.last = rect; d.blocked = blocked; d.moved = true;
  Object.assign(d.e, rect);
  const box = $(`.ebox[data-id="${d.e.id}"]`);
  if (box) {
    Object.assign(box.style, { left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.w * 100 + '%', height: rect.h * 100 + '%' });
    box.classList.toggle('blocked', !!blocked);
  }
  showGuides(snapped.guides, blocked);
});
// Released boxes settle back with a spring (transition on .ebox, see style.css).
function endDrag() {
  const d = editor.drag;
  $$('.ebox.dragging, .ebox.blocked').forEach((b) => b.classList.remove('dragging', 'blocked'));
  $('#editLayer').classList.remove('dragging');
  showGuides([], null);
  editor.drag = null;
  if (!d?.moved) return;
  if (d.blocked) toast(`Kept clear of ${elName(d.blocked)}. Hold Alt while dragging to stack on top of it.`);
  if (d.alt && !d.e.stack) {
    const over = blockerFor(d.e, { ...d.e, stack: false }, (S.state.elements || []).filter((x) => x !== d.e));
    if (over) { d.e.stack = true; toast(`${elName(d.e)} is now stacked over ${elName(over)}.`); }
  }
  commitElements();
  renderLayers(); renderProps();
}
$('#editLayer').addEventListener('pointerup', endDrag);
$('#editLayer').addEventListener('pointercancel', endDrag);
// Keyboard: arrows nudge the selected layer 8px (Shift: 40px), with the same snapping rules; Esc deselects.
document.addEventListener('keydown', (ev) => {
  if (!editor.on || !editor.sel || !isHost() || ev.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const e = (S.state.elements || []).find((x) => x.id === editor.sel);
  if (!e) return;
  if (ev.key === 'Escape') { editor.sel = null; renderEditor(); return; }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  if (!dir || e.locked || e.hidden) return;
  ev.preventDefault();
  const step = GRID * (ev.shiftKey ? 5 : 1);
  const cand = clampRect({ ...e, x: e.x + dir[0] * step / W, y: e.y + dir[1] * step / H });
  const others = (S.state.elements || []).filter((x) => x !== e);
  const { rect, blocked } = e.stack ? { rect: cand, blocked: null } : resolve(e, cand, e, others);
  if (blocked && rect.x === e.x && rect.y === e.y) return toast(`${elName(e)} would overlap ${elName(blocked)}.`);
  Object.assign(e, { x: rect.x, y: rect.y });
  renderEditor(); commitElements(250);
});

// Stage Editing Toolbar & Panel Wiring
function renderStageToolbar() {
  const bar = $('#stageToolbar');
  if (!bar) return;
  const host = isHost(), e = selEl();
  bar.querySelectorAll('[data-tb]').forEach((b) => {
    const act = b.dataset.tb;
    if (act === 'toggle-stack') {
      b.setAttribute('aria-pressed', String(!!e?.stack));
      b.disabled = !host || !e;
    } else if (act === 'duplicate') {
      b.disabled = !host || !e || isSystem(e);
    } else if (act === 'reset') {
      b.disabled = !host || !e || !e.home;
    } else {
      b.disabled = !host || !e || !!e.locked;
    }
  });
}
function stageToolbarAction(act) {
  if (!isHost()) return toast('Only the host can change the stage.', { err: true });
  const e = selEl();
  if (!e) return toast('Select a layer in Layers or on the stage first.');
  if (act === 'layer-up') return moveEl(e.id, 1);
  if (act === 'layer-down') return moveEl(e.id, -1);
  if (act === 'reset') return resetEl(e.id);
  if (act === 'toggle-stack') {
    const nextStack = !e.stack;
    if (!nextStack) {
      const blocker = blockerFor(e, { ...e, stack: false }, (S.state.elements || []).filter((o) => o.id !== e.id));
      if (blocker) return toast(`${elName(e)} overlaps ${elName(blocker)}. Move one of them first.`, { err: true });
    }
    return patchEl(e.id, { stack: nextStack });
  }
  if (act === 'duplicate') {
    if (isSystem(e)) return;
    const els = stageElements();
    const copyEl = { ...e, id: uid(), x: Math.min(1 - e.w, e.x + 24 / W), y: Math.min(1 - e.h, e.y + 24 / H), locked: false };
    const spot = freeSpot(copyEl, els);
    if (spot) Object.assign(copyEl, spot);
    else if (spot === false) copyEl.stack = true;
    copyEl.home = [copyEl.x, copyEl.y, copyEl.w, copyEl.h];
    setStage({ elements: [...els, copyEl] });
    editor.sel = copyEl.id;
    setEditing(true);
    return toast(`Duplicated ${elName(e)}.`);
  }
  if (e.locked) return toast(`${elName(e)} is locked. Unlock it in Layers first.`);
  const g8 = (v, n) => Math.round(v * n / GRID) * GRID / n;
  const cand = { ...e };
  if (act === 'align-l') cand.x = SAFE.action;
  if (act === 'align-cx') cand.x = g8((1 - e.w) / 2, W);
  if (act === 'align-r') cand.x = Math.max(SAFE.action, 1 - SAFE.action - e.w);
  if (act === 'align-cy') cand.y = g8((1 - e.h) / 2, H);
  if (act === 'fit-safe') {
    cand.w = Math.min(e.w, 1 - SAFE.action * 2);
    cand.h = Math.min(e.h, 1 - SAFE.action * 2);
    cand.x = Math.min(1 - SAFE.action - cand.w, Math.max(SAFE.action, e.x));
    cand.y = Math.min(1 - SAFE.action - cand.h, Math.max(SAFE.action, e.y));
  }
  const others = (S.state.elements || []).filter((x) => x.id !== e.id);
  const { rect, blocked } = e.stack ? { rect: cand, blocked: null } : resolve(e, cand, e, others);
  Object.assign(e, rect);
  if (blocked) toast(`Stopped clear of ${elName(blocked)}. Toggle Overlap to stack.`);
  setStage({ elements: elementsCopy() });
  setEditing(true);
}
$('#stageToolbar')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-tb]');
  if (b) stageToolbarAction(b.dataset.tb);
});
$('#editToggle').onclick = () => setEditing(!editor.on);
$('#resetScene').onclick = () => { if (isHost()) resetScene(); };
$$('[data-add]').forEach((b) => b.addEventListener('click', () => { if (!isHost()) return toast('Only the host can change the stage.', { err: true }); addElement(b.dataset.add); }));
function renderTemplates() {
  const wrap = $('#tplList');
  replaceKids(wrap, ...TEMPLATES.map((tpl) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'tile tpl'; b.disabled = !isHost();
    const pv = scenePreview(tpl);
    const nm = document.createElement('span'); nm.textContent = tpl.name;
    if (tpl.desc) b.dataset.tip = tpl.desc;
    b.append(pv, nm);
    b.onclick = () => applyTemplate(tpl);
    return b;
  }));
}
// Saved layouts live in this browser (images included, so they work in any new studio).
function savedLayouts() { return store.get('layouts', []); }
function renderSaved() {
  const ul = $('#savedList'), list = savedLayouts();
  replaceKids(ul, ...list.map((l, i) => {
    const li = document.createElement('li'); li.className = 'el-row';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'menu-item compact el-pick'; b.textContent = l.name; b.disabled = !isHost();
    b.onclick = () => loadLayout(l);
    li.append(b, mkBtn('trash-2', 'Delete saved scene', () => { const all = savedLayouts(); all.splice(i, 1); store.set('layouts', all); renderSaved(); }));
    return li;
  }));
  $('#savedEmpty').hidden = !!list.length;
}
$('#saveLayout').onclick = () => {
  const name = $('#layoutName').value.trim() || `Layout ${savedLayouts().length + 1}`;
  const els = elementsCopy().map((e) => (e.type === 'image' && S.assets.get(e.asset)?.data ? { ...e, _data: S.assets.get(e.asset).data } : e));
  const all = savedLayouts().filter((l) => l.name !== name);
  all.unshift({ name, layout: S.state.layout, elements: els, media: $('#sceneMedia').value || '' });
  try { store.set('layouts', all.slice(0, 20)); localStorage.getItem('gather:layouts') || 0; } catch {}
  if (!savedLayouts().some((l) => l.name === name)) return toast('Could not save. The images may be too large for this browser.', { err: true });
  $('#layoutName').value = '';
  renderSaved(); renderScenes(); toast(`Saved scene “${name}”. It's in the scene strip.`);
};
async function loadLayout(l) {
  const els = [];
  for (const e of l.elements) {
    if (e.type === 'image' && e._data) { const { _data, ...rest } = e; els.push({ ...rest, asset: await storeAsset(_data).catch(() => '') }); }
    else els.push(e);
  }
  setStage({ layout: l.layout || 'custom', elements: els, scene: 'saved:' + l.name });
  const it = l.media && S.library.find((x) => x.id === l.media);
  if (it) { if (S.local.pres) stopPresentation(); await presentLibrary(it); }
  toast(`Scene “${l.name}”.`);
}
// Twitch + chat overlay controls (Chat panel)
$('#twitchForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!isHost()) return toast('Only the host can connect platform chat.', { err: true });
  const v = $('#twitchInput').value.trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (twitch.want && (!v || v === twitch.want)) { setStage({ feeds: { twitch: '' } }); toast('Twitch chat disconnected.'); return; }
  if (!v) return toast('Enter a Twitch channel name.');
  setStage({ feeds: { twitch: v } });
});
// One switch shows or hides the chat overlay; it carries every connected platform's chat.
$('#overlaySwitch').addEventListener('change', (ev) => {
  if (!isHost()) { ev.target.checked = !ev.target.checked; return toast('Only the host can change the stage.', { err: true }); }
  const existing = (S.state.elements || []).find((e) => e.type === 'chat');
  if (!ev.target.checked && existing) setStage({ elements: elementsCopy().filter((e) => e.type !== 'chat') });
  if (ev.target.checked && !existing) { addElement('chat'); setEditing(false); toast('Chat overlay on. Move it in Layouts → Edit on stage.'); }
});
$('#rumbleForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!isHost()) return toast('Only the host can connect platform chat.', { err: true });
  if (store.get('rumbleUrl', '')) { store.set('rumbleUrl', ''); $('#rumbleInput').value = ''; syncRumble(); renderFeedUI(); return toast('Rumble chat disconnected.'); }
  const v = $('#rumbleInput').value.trim();
  if (!/^https:\/\/(www\.)?rumble\.com\/-livestream-api\//.test(v)) return toast('Paste the Live Stream API URL from Rumble → Account → Live Stream API.', { err: true });
  store.set('rumbleUrl', v);
  syncRumble(); renderFeedUI();
  toast(S.studio ? 'Rumble connected.' : 'Saved. Rumble chat connects when you enter a studio.');
});
$('#featHide').onclick = () => setStage({ featured: null });
// Touch screens have no hover: tap a message to show its actions (put on stage, hide, time out, block); tap again to close.
$('#msgs')?.addEventListener('click', (e) => {
  if (!matchMedia('(hover: none)').matches || e.target.closest('button, a, input, audio, video')) return;
  const li = e.target.closest('li.msg'); if (!li) return;
  const was = li.classList.contains('acts-open');
  document.querySelectorAll('#msgs li.acts-open').forEach((x) => x.classList.remove('acts-open'));
  li.classList.toggle('acts-open', !was);
});
function renderFeedUI() {
  const host = isHost();
  $('#twitchInput').disabled = !host;
  $('#twitchGo').disabled = !host;
  $('#twitchGo').textContent = S.state.feeds?.twitch ? 'Disconnect' : 'Connect';
  if (document.activeElement !== $('#twitchInput')) $('#twitchInput').value = S.state.feeds?.twitch || '';
  const rumbleSaved = !!store.get('rumbleUrl', '');
  $('#rumbleInput').disabled = !host || rumbleSaved;
  $('#rumbleGo').disabled = !host;
  $('#rumbleGo').textContent = rumbleSaved ? 'Disconnect' : 'Connect';
  if (rumbleSaved && document.activeElement !== $('#rumbleInput')) $('#rumbleInput').value = '••••••••••••';
  const hasChat = (S.state.elements || []).some((e) => e.type === 'chat');
  $('#overlaySwitch').checked = hasChat;
  $('#overlaySwitch').disabled = !host;
  const n = 1 + (S.state.feeds?.twitch ? 1 : 0) + (rumbleSaved && host ? 1 : 0);
  $('#overlayHint').textContent = `${n} chat source${n === 1 ? '' : 's'}: studio${S.state.feeds?.twitch ? ', Twitch' : ''}${rumbleSaved && host ? ', Rumble' : ''}`;
  $('#featBar').hidden = !S.state.featured;
  if (S.state.featured) $('#featText').textContent = `${S.state.featured.name}: ${S.state.featured.text}`;
  $('#featHide').disabled = !host;
  $('#msgs').classList.toggle('is-host', host);
  $$('#msgs .feat').forEach((b) => { b.textContent = S.state.featured?.id === b.closest('li')?.dataset.fid ? 'On stage' : 'Show on stage'; });
  applyModerationAll();
  setTwitchStatus(twitch.status);
  syncRumble();
  if (rumble.status === 'off' && rumbleSaved) setRumbleStatus('saved');
  renderChatMood();
}
function renderLayoutsPanel() {
  renderTemplates(); renderSaved(); renderEditor();
  $$('[data-add]').forEach((b) => (b.disabled = !isHost()));
  $('#editToggle').disabled = !isHost();
  $('#saveLayout').disabled = !isHost();
  $('#layoutsHint').textContent = isHost() ? 'Drag and resize on the stage. Changes show for everyone and in recordings.' : 'Only the host can change layouts. You see them on your stage.';
  if (!isHost() && editor.on) setEditing(false);
}

// ---------------------------------------------------------------- AI: one assistant that answers and runs the studio → ./assistant.js
const assistant = createAssistant({
  $, $$, store, S, isHost, toast, wsSend, setStage, stageElements, withDefaults, AI_NAME, plainMd,
  elementsCopy, freeSpot, patchEl, autoGrow, appendLog, setTab, offerOpen, askProducer, noteActions: (id) => samChat?.noteActions(id) || []
});
// Sam in the chat: starters, the Sam button, and notes as the show goes -> ./sam-chat.js
const samChat = createSamChat({ $, $$, S, store, isHost, upsertAI: (...a) => assistant.upsertAI(...a), askProducer, setStage, autoGrow });
// Big moments (chat spikes, reaction bursts, super chats) clip themselves -> ./auto-moments.js
const autoMoments = createAutoMoments({
  store, isHost, inStudio: () => !!S.studio,
  mark: (label, kind) => window.__gatherAddMoment?.(label, kind),
  note: (...a) => samChat.note(...a),
  save: (m, aspect) => window.__gatherExportMoment?.(m, aspect),
});
window.__gatherAuto = autoMoments;
function upsertAI(...args) { return assistant.upsertAI(...args); }
function stageAnswer(...args) { return assistant.stageAnswer(...args); }
function actChip(...args) { return assistant.actChip(...args); }
function renderAILog(...args) { return assistant.renderAILog(...args); }
function renderAIPanel(...args) { return assistant.renderAIPanel(...args); }
function setAiSetup(...args) { return assistant.setAiSetup(...args); }

// ---------------------------------------------------------------- composers: auto-growing, Enter sends, Shift+Enter breaks
function autoGrow(t) { if (t.tagName !== 'TEXTAREA') return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }
for (const [input, form] of [['#chatInput', '#chatForm'], ['#aiInput', '#aiForm']]) {
  const t = $(input);
  t.addEventListener('input', () => autoGrow(t));
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $(form).requestSubmit(); } });
}

// ---------------------------------------------------------------- tip QR cards on stage (Audience → Get paid)
// "Your watch page" keeps the payment in gather (viewers scan, then pay by card in the chat); the rest open that app.
const TIP_FIELDS = [
  ['gather', 'Your watch page', ''], ['paypal', 'PayPal', 'paypal.me/yourname'], ['venmo', 'Venmo', '@yourname'], ['cashapp', 'Cash App', '$yourtag'],
  ['stripe', 'Stripe', 'buy.stripe.com/…'], ['kofi', 'Ko-fi', 'ko-fi.com/yourname'], ['patreon', 'Patreon', 'patreon.com/yourname'],
  ['bmc', 'Buy Me a Coffee', 'buymeacoffee.com/you'], ['link', 'Website', 'yoursite.com/support'],
];
function tipUrl(provider, raw) {
  if (provider === 'gather') return S.studio ? watchLinkUrl() + '?tip=1' : '';
  let v = String(raw || '').trim();
  if (!v) return '';
  if (provider === 'venmo' && !/\//.test(v)) return 'https://venmo.com/u/' + v.replace(/^@/, '');
  if (provider === 'cashapp' && !/\//.test(v)) return 'https://cash.app/$' + v.replace(/^\$/, '');
  if (provider === 'paypal' && !/[./]/.test(v)) return 'https://paypal.me/' + v;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return /^https:\/\/[^\s]+\.[^\s]+/.test(v.replace(/^http:/i, 'https:')) ? v.replace(/^http:/i, 'https:') : '';
}
// Support links: one row per provider. The button shows what the card is doing right now —
// "On stage" adds it (in a free spot), then "Hide" / "Show" toggle it without losing where it sits.
function renderTips() {
  const box = $('#tipList');
  if (!box) return;
  const saved = store.get('tips', {});
  if (!box.children.length) {
    replaceKids(box, ...TIP_FIELDS.map(([id, name, ph]) => {
      const row = document.createElement('div'); row.className = 'tip-row'; row.dataset.provider = id;
      const tag = document.createElement('span'); tag.className = 'tip-tag'; tag.textContent = name; tag.style.setProperty('--c', TIP_INFO[id].color);
      if (id === 'gather') { // nothing to type: it's this studio's own watch page
        const note = document.createElement('small'); note.className = 'tip-own'; note.textContent = 'Card tips in your chat. Needs Stripe connected.';
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn sm tip-toggle';
        btn.onclick = () => toggleTip(id, name, '');
        row.classList.add('own'); row.append(tag, note, btn);
        return row;
      }
      const inp = document.createElement('input'); inp.className = 'input sm'; inp.placeholder = ph; inp.value = saved[id] || ''; inp.spellcheck = false; inp.setAttribute('aria-label', name + ' link');
      inp.onchange = () => {
        const clean = inp.value.trim();
        const all = store.get('tips', {}); all[id] = clean; store.set('tips', all);
        const card = (S.state.elements || []).find((e) => e.type === 'tip' && e.provider === id), url = tipUrl(id, clean);
        if (card && url && card.url !== url && isHost()) patchEl(card.id, { url });
      };
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn sm tip-toggle';
      btn.onclick = () => toggleTip(id, name, inp.value);
      row.append(tag, inp, btn);
      return row;
    }));
  }
  for (const row of $$('.tip-row', box)) {
    const prov = row.dataset.provider;
    const card = (S.state.elements || []).find((e) => e.type === 'tip' && e.provider === prov);
    const btn = $('.tip-toggle', row);
    btn.textContent = !card ? 'On stage' : card.hidden ? 'Show' : 'Hide';
    btn.setAttribute('aria-pressed', String(!!card && !card.hidden));
    btn.disabled = !isHost();
  }
}
function toggleTip(id, name, raw) {
  const card = (S.state.elements || []).find((e) => e.type === 'tip' && e.provider === id);
  if (card) {
    patchEl(card.id, { hidden: !card.hidden }, card.hidden ? 'show' : 'hide');
    if (!card.hidden) toast(`${name} card hidden. It keeps its spot for next time.`);
    return;
  }
  const url = tipUrl(id, raw);
  if (!url) return toast(id === 'gather' ? 'Enter your studio first.' : `Add your ${name} link first.`, { err: true });
  if (id !== 'gather') { const all = store.get('tips', {}); all[id] = raw.trim(); store.set('tips', all); }
  const e = withDefaults({ type: 'tip', provider: id, url, label: id === 'gather' ? 'Tip the show' : 'Support the show' });
  const els = stageElements(), spot = freeSpot(e, els);
  if (spot) Object.assign(e, spot); else if (spot === false) e.stack = true;
  e.home = [e.x, e.y, e.w, e.h];
  setStage({ elements: [...els, e] });
  toast(spot === false ? `${name} card is on stage, stacked: there was no free spot. Move it in Layouts.` : `${name} card is on stage. Hide it here any time.`)
}

// ---------------------------------------------------------------- profile photo (shown when the camera is off)
$('#avatarBtn').onclick = () => $('#avatarFile').click();
$('#avatarHint').onclick = () => $('#avatarFile').click();
$('#avatarFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = await squareThumb(f);
    store.set('avatar', data);
    if (acct.user) acctApi('update', { avatar: data }).then((r) => setUser(r.user)).catch(() => {});
    renderPreview();
    if (S.studio) uploadAvatar(true);
  } catch (err) { toast(err.message, { err: true }); }
};
$('#avatarClear').onclick = () => { store.set('avatar', ''); S.local.avatarId = ''; renderPreview(); if (S.studio) sendMeta({ avatar: '' }); };
function squareThumb(file) {
  return new Promise((res, rej) => {
    if (!/^image\//.test(file.type)) return rej(new Error('Choose an image for your photo.'));
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 320;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 320, 320);
      URL.revokeObjectURL(img.src); res(c.toDataURL('image/webp', .85));
    };
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = URL.createObjectURL(file);
  });
}
async function uploadAvatar(force) {
  const data = store.get('avatar', '');
  if (!data || !S.studio || (S.local.avatarId && !force)) return;
  try { S.local.avatarId = await storeAsset(data); sendMeta({ avatar: S.local.avatarId }); renderCrew(); } catch {}
}

// ---------------------------------------------------------------- account (sign in, profile, synced settings) → ./account.js
const account = createAccount({
  $, $$, store, S, localState, toast, initials, squareThumb, uploadAvatar, renderStreamPanel, openWizard,
  renderAll, renderPresets, applyTheme, renderAudioFxUI, renderBgFx, renderPreview, mountShortcutsRoot,
  renderShortcutsList, renderWatchSec
});
const { acct, rawSet } = account;
function acctApi(...args) { return account.acctApi(...args); }
function pushSettings(...args) { return account.pushSettings(...args); }
function profileSoon(...args) { return account.profileSoon(...args); }
function setUser(...args) { return account.setUser(...args); }
function signedOut(...args) { return account.signedOut(...args); }
function syncThemeSegs(...args) { return account.syncThemeSegs(...args); }
function needAccountThen(...args) { return account.needAccountThen(...args); }
function openAccount(...args) { return account.openAccount(...args); }
function acctBoot(...args) { return account.acctBoot(...args); }

// ---------------------------------------------------------------- brand panel
function savedBrandImgs() { return store.get('brandImgs', {}); }
async function uploadBrandAssets(brand) {
  if (!brand || S.host !== S.id) return;
  const patch = {};
  for (const k of ['bgImage', 'overlay', 'logo']) {
    const id = brand[k];
    if (typeof id === 'string' && id.startsWith('local-')) { const data = S.assets.get(id)?.data || savedBrandImgs()[k]; if (data) patch[k] = await storeAsset(data).catch(() => ''); }
  }
  if (Object.keys(patch).length) setStage({ brand: patch });
}
const brandSyncSubs = [];
const stateSyncSubs = [];
function notifyBrandSync() {
  const b = S.state?.brand || {};
  for (const fn of brandSyncSubs) { try { fn(b); } catch {} }
}
function brandPref(patch) {
  // Keep the look for the next studio too (images live in this browser).
  const keep = ['color', 'bg', 'panel', 'panelColor', 'font', 'tag', 'bannerStyle', 'anim', 'motion', 'alertStyle', 'pack', 'frame', 'dim', 'logoPos', 'logoSize'];
  const prefs = store.get('brandPrefs', {});
  for (const k of keep) if (k in patch) prefs[k] = patch[k];
  store.set('brandPrefs', prefs);
  setStage({ brand: patch });
  if (typeof window.__gatherBrandSync === 'function') window.__gatherBrandSync();
  notifyBrandSync();
}
async function brandDataUrl(kind, data) {
  const imgs = savedBrandImgs(); imgs[kind] = data;
  try { rawSet('brandImgs', imgs); } catch {}
  const id = S.studio ? await storeAsset(data) : (setAssetData('local-brand-' + kind, data), 'local-brand-' + kind);
  setStage({ brand: { [kind]: id } });
}
async function brandImage(kind, file) {
  try {
    const data = await compressImage(file);
    await brandDataUrl(kind, data);
    toast({ bgImage: 'Background image set.', overlay: 'Overlay added.', logo: 'Logo added.' }[kind]);
  } catch (err) { toast(err.message, { err: true }); }
}
function clearBrandImage(kind) {
  const imgs = savedBrandImgs(); delete imgs[kind]; rawSet('brandImgs', imgs);
  setStage({ brand: { [kind]: '' } });
}
for (const [kind, pick, file, clear] of [['bgImage', '#bgImgPick', '#bgImgFile', '#bgImgClear'], ['overlay', '#overlayPick', '#overlayFile', '#overlayClear'], ['logo', '#logoPick', '#logoFile', '#logoClear']]) {
  $(pick).onclick = () => { if (!isHost()) return toast('Only the host can change the brand.', { err: true }); $(file).click(); };
  $(file).onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) brandImage(kind, f); };
  $(clear).onclick = () => clearBrandImage(kind);
}
function buildBgSvg(accent, promptText) {
  const col = normalizeHex(accent) || '#3b82f6';
  const [r, gr, b] = hexRgb(col);
  const darkAlt = `rgb(${Math.max(8, Math.round(r * 0.25))}, ${Math.max(12, Math.round(gr * 0.25))}, ${Math.max(24, Math.round(b * 0.35))})`;
  const seed = [...String(promptText || 'gather')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const cx1 = 180 + (seed % 420), cy1 = 140 + ((seed >> 4) % 240);
  const cx2 = 820 + ((seed >> 8) % 340), cy2 = 420 + ((seed >> 12) % 220);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><radialGradient id="g1" cx="0.5" cy="0.5" r="0.65"><stop offset="0" stop-color="${col}" stop-opacity="0.46"/><stop offset="1" stop-color="#070c1a" stop-opacity="0"/></radialGradient><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#060914"/><stop offset="0.55" stop-color="${darkAlt}"/><stop offset="1" stop-color="#090d1e"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/><circle cx="${cx1}" cy="${cy1}" r="420" fill="url(#g1)"/><circle cx="${cx2}" cy="${cy2}" r="360" fill="${col}" fill-opacity="0.16"/><path d="M0 540 Q 420 420 820 560 T 1280 490 L 1280 720 L 0 720 Z" fill="${col}" fill-opacity="0.08"/></svg>`;
}
function segWire(sel, attr, key) {
  $$(sel + ' button').forEach((b) => b.addEventListener('click', () => { if (!isHost()) return; brandPref({ [key]: b.dataset[attr] }); }));
}
segWire('#tagSeg', 'tag', 'tag'); segWire('#bannerStyleSeg', 'bs', 'bannerStyle'); segWire('#frameSeg', 'frame', 'frame');
$$('#logoPosSeg button').forEach((b) => b.addEventListener('click', () => { if (!isHost()) return; brandPref({ logoPos: b.dataset.lp }); placeLayer('logo', b.dataset.lp, S.state.brand.logoSize || .12); }));
$('#fontSel').onchange = (e) => brandPref({ font: e.target.value });
$('#animSel').onchange = (e) => { brandPref({ anim: e.target.value }); previewAnimation(); };
$('#bgDim').oninput = (e) => brandPref({ dim: Number(e.target.value) });
$('#logoSize').oninput = (e) => { brandPref({ logoSize: Number(e.target.value) }); placeLayer('logo', S.state.brand.logoPos || 'tr', Number(e.target.value)); };
/** Put the logo or sponsor layer in a corner (inside action-safe, on the grid). If the corner is taken it goes stacked and says so. */
function placeLayer(type, pos, size) {
  const els = elementsCopy(), e = els.find((x) => x.type === type);
  if (!e) return;
  const p = typeof pos === 'string' && pos ? pos : 'tr';
  const g8 = (v, n) => Math.round(v * n / GRID) * GRID / n;
  const bottomBand = p === 'bottom';
  const w = bottomBand ? .5 : type === 'logo' ? size : .2, h = bottomBand ? .13 : type === 'logo' ? (size * W / 3) / H : .2;
  const mx = SAFE.action + GRID / W, my = SAFE.action + GRID / H;
  const x = bottomBand ? (1 - w) / 2 : p.includes('l') ? mx : 1 - mx - w;
  const y = bottomBand ? 1 - my - h : p.startsWith('b') ? 1 - my - h : my;
  Object.assign(e, { x: g8(x, W), y: g8(y, H), w: g8(w, W), h: g8(h, H), hidden: false });
  const blocker = !e.stack && blockerFor(e, e, els);
  if (blocker) { e.stack = true; toast(`${elName(e)} overlaps ${elName(blocker)} there, so it’s stacked on top. Fine-tune it in Layouts.`, { ms: 4200 }); }
  setStage({ elements: els });
}
function previewAnimation() {
  S.banner.key = ''; featAnim.key = '';
  if (!S.state.banner && !S.state.featured) toast('Show a banner to see the animation on stage.');
}
$('#animPreview').onclick = previewAnimation;
function renderBrandPanel() {
  const b = S.state.brand, host = isHost(), imgs = savedBrandImgs();
  const segOn = (sel, attr, val) => $$(sel + ' button').forEach((x) => { x.classList.toggle('on', x.dataset[attr] === val); x.disabled = !host; });
  segOn('#tagSeg', 'tag', b.tag || 'solid'); segOn('#bannerStyleSeg', 'bs', b.bannerStyle || 'classic'); segOn('#frameSeg', 'frame', b.frame || 'none'); segOn('#logoPosSeg', 'lp', b.logoPos || 'tr');
  $('#fontSel').value = b.font || 'jakarta'; $('#fontSel').disabled = !host;
  $('#animSel').value = b.anim || 'slide'; $('#animSel').disabled = !host;
  $('#bgDim').value = b.dim ?? 0.25; $('#bgDim').disabled = !host;
  $('#logoSize').value = b.logoSize ?? 0.12; $('#logoSize').disabled = !host;
  $('#bgImgClear').hidden = !b.bgImage; $('#overlayClear').hidden = !b.overlay; $('#logoClear').hidden = !b.logo;
  $('#bgDimRow').hidden = !b.bgImage;
  $('#logoRow').hidden = !b.logo;
  const bgSrc = b.bgImage ? (assetImg(b.bgImage)?.src || imgs.bgImage || '') : '';
  if ($('#bgImgPreview')) {
    $('#bgImgPreview').hidden = !bgSrc;
    if (bgSrc) $('#bgImgPreview').src = bgSrc;
  }
  const logoSrc = b.logo ? (assetImg(b.logo)?.src || imgs.logo || '') : '';
  if ($('#logoPreviewLook')) {
    $('#logoPreviewLook').src = logoSrc || svgDataUrl(buildLogoSvg(b.color, S.state.title || S.name || 'G'));
  }
  const ovSrc = b.overlay ? (assetImg(b.overlay)?.src || imgs.overlay || '') : '';
  if ($('#overlayPreviewLook')) {
    $('#overlayPreviewLook').src = ovSrc || svgDataUrl(buildOverlaySvg(b.color, S.state.streamType || 'live', S.state.title || 'LIVE STUDIO'));
  }
  for (const id of ['#bgImgPick', '#overlayPick', '#logoPick', '#bgImgAiBtn', '#logoAiBtnLook', '#overlayAiBtnLook', '#emoteAiBtn']) {
    if ($(id)) $(id).disabled = !host;
  }
  notifyBrandSync();
}

// ---------------------------------------------------------------- stream tab: format, captions, upcoming → ./broadcast.js
const broadcast = createBroadcast({
  $, $$, store, get W() { return W; }, set W(v) { W = v; }, get H() { return H; }, set H(v) { H = v; }, S,
  isHost, normalizeHex, hexLuminance, toast, initials, copy, fmtSec, resetAutoMuteTimer, setStage, canvas,
  TPL, templatePatch, acct, acctApi, openAccount, savedBrandImgs, aiImageSource, drawThumb,
  get liveDests() { return liveDests; }, renderSocialMatrix, renderScenes, openEnter
});
const { autoGridOn, fmtLocal, wiz, tc, tg, wErr, wWhen, parseHashtags } = broadcast;
function setStreamPref(...args) { return broadcast.setStreamPref(...args); }
function syncAspect(...args) { return broadcast.syncAspect(...args); }
function renderStreamPanel(...args) { return broadcast.renderStreamPanel(...args); }
function renderUpcoming(...args) { return broadcast.renderUpcoming(...args); }
function downloadIcs(...args) { return broadcast.downloadIcs(...args); }
function syncWizAiBar(...args) { return broadcast.syncWizAiBar(...args); }
function renderKitVisualPreviews(...args) { return broadcast.renderKitVisualPreviews(...args); }
function svgDataUrl(...args) { return broadcast.svgDataUrl(...args); }
function rasterizeSvg(...args) { return broadcast.rasterizeSvg(...args); }
function buildLogoSvg(...args) { return broadcast.buildLogoSvg(...args); }
function buildOverlaySvg(...args) { return broadcast.buildOverlaySvg(...args); }
function openWizard(...args) { return broadcast.openWizard(...args); }
function renderWizard(...args) { return broadcast.renderWizard(...args); }

// ---------------------------------------------------------------- AI designer: one window for covers, backdrops, logos and overlays → ./designer.js
const designer = createDesigner({
  $, $$, store, autoTitle, S, myId, normalizeHex, hexLuminance, toast, newCode, copy, cssId, setStage,
  stageFont, hexA, setAssetData, compressImage, AI_NAME, acct, acctApi, rawSet, pushSettings, needAccountThen,
  savedBrandImgs, buildBgSvg, fmtLocal, renderUpcoming, downloadIcs, wiz, tc, tg, wErr, wWhen, parseHashtags,
  syncWizAiBar, renderKitVisualPreviews, rasterizeSvg, buildLogoSvg, buildOverlaySvg, openWizard,
  renderWizard, get liveDests() { return liveDests; }, openEnter
});
const { loadImg } = designer;
function aiImageSource(...args) { return designer.aiImageSource(...args); }
function openDesigner(...args) { return designer.openDesigner(...args); }
function aidAddFiles(...args) { return designer.aidAddFiles(...args); }
function cover(...args) { return designer.cover(...args); }
function drawThumb(...args) { return designer.drawThumb(...args); }

// ---------------------------------------------------------------- live captions (Web Speech API, each person's own mic)
const cap = { rec: null, want: false, lang: '', lines: new Map(), warned: false };
let capLast = 0, capTimer = null;
function sendCaption(text, final) {
  clearTimeout(capTimer);
  const go = () => { capLast = Date.now(); wsSend({ type: 'caption', text, final }); };
  if (final || Date.now() - capLast > 400) go(); else capTimer = setTimeout(go, 400);
}
function showCaption(id, name, text, final) {
  cap.lines.set(id, { name, text, final, t: Date.now() });
  // Watch-page viewers can turn CC on: the host passes each finished line along (one small write per line).
  if (final && isHost() && S.studio && text) wsSend({ type: 'wcap', name, text });
}
function drawCaptions(r) {
  const c = S.state.captions;
  if (!c?.on) return;
  const now = Date.now();
  const live = [...cap.lines.values()].filter((l) => now - l.t < (l.final ? 4000 : 6000)).sort((a, b) => a.t - b.t).slice(-2);
  if (!live.length) return;
  const fs = c.size || 26, F = stageFont(), maxW = Math.max(120, r.w - 48), cx = r.x + r.w / 2, lh = fs * 1.3, many = cap.lines.size > 1;
  const rows = [];
  for (const l of live) {
    g.font = `600 ${fs}px ${F}`;
    const words = wrapLines(l.text, maxW - (many ? 0 : 0));
    const tail = words.slice(-2); // newest words stay visible
    tail.forEach((t, i) => rows.push({ name: i === 0 && many ? l.name : '', text: t }));
  }
  const shown = rows.slice(-3);
  const blockH = shown.length * lh + 18;
  const y0 = r.y + r.h - blockH;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
  if (c.style === 'bar') { g.fillStyle = 'rgba(0,0,0,.72)'; rr(cx - maxW / 2 - 24, y0, maxW + 48, blockH, 10); g.fill(); }
  shown.forEach((r, i) => {
    const y = y0 + 9 + lh * (i + .5);
    const label = r.name ? r.name + ': ' : '';
    g.font = `600 ${fs}px ${F}`;
    const full = g.measureText(label + r.text).width;
    if (c.style === 'box') { g.fillStyle = 'rgba(0,0,0,.78)'; rr(cx - full / 2 - 12, y - lh / 2 + 2, full + 24, lh - 4, 6); g.fill(); }
    if (c.style === 'plain') { g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 8; }
    let x = cx - full / 2;
    g.textAlign = 'left';
    if (label) { g.fillStyle = S.state.brand.color; g.fillText(label, x, y); x += g.measureText(label).width; }
    g.fillStyle = '#ffffff'; g.fillText(r.text, x, y);
    g.shadowColor = 'transparent';
  });
  g.restore();
}

// ---------------------------------------------------------------- guest view: invitees see only their own controls
function renderGuestView() {
  const guest = !!S.studio && !isHost();
  document.body.classList.toggle('is-guest', guest);
  const active = $(`.rail-btn[data-tab="${S.tab}"]`);
  if (guest && active?.classList.contains('host-only')) setTab('chat');
}

// ---------------------------------------------------------------- help: search every setting, jump straight to it
const HELP = [
  ['Change my camera', 'camera webcam device switch', 'settings', '#camSelect', 'Settings → Camera'],
  ['Change my microphone', 'mic microphone audio input device', 'settings', '#micSelect', 'Settings → Microphone'],
  ['Others hear an echo', 'echo feedback hear myself loop', 'settings', '#echoChk', 'Settings → Microphone → Echo cancellation'],
  ['Remove background noise', 'noise background fan keyboard dog ai rnnoise', 'settings', '#aiNoiseChk', 'Settings → Microphone → AI noise removal'],
  ['Auto-duck music and media', 'duck ducking lower background music media voiceover', 'settings', '#duckChk', 'Settings → Microphone → Auto-duck background audio'],
  ['Play background music', 'music audio track mp3 wav loop soundtrack', 'music', '#musicPick', 'Music'],
  ['My mic is too quiet or too loud', 'volume gain loud quiet level', 'settings', '#micGain', 'Settings → Microphone → Input gain'],
  ['Blur my background', 'blur background bokeh', 'settings', '#bgFxSeg', 'Settings → Background'],
  ['Replace my background / green screen', 'virtual background green screen chroma replace image', 'settings', '#bgFxSeg', 'Settings → Background'],
  ['Video looks dark or washed out', 'brightness contrast light dark saturation colour', 'settings', '#fxBright', 'Settings → Camera → Light'],
  ['Video is choppy', 'choppy laggy fps frame rate quality bandwidth', 'settings', '#qualitySelect', 'Settings → Camera → Quality'],
  ['Mirror my camera', 'mirror flip reversed', 'settings', '#mirrorChk', 'Settings → Camera'],
  ['Go live or schedule a stream', 'go live schedule stream start upcoming', 'stream', '#wizOpen', 'Go live → Schedule'],
  ['Send reminders to guests', 'email reminder invite calendar', 'stream', '#wizOpen', 'Go live → Schedule'],
  ['Make a thumbnail', 'thumbnail cover image ai', 'stream', '#wizOpen', 'Go live → Schedule → Thumbnail'],
  ['Vertical video for TikTok, Reels, Shorts', 'vertical portrait 9:16 tiktok reels shorts mobile', 'stream', '#aspectSeg', 'Go live → Format'],
  ['Turn on live captions', 'captions subtitles transcript accessibility', 'show:stage', '#capSwitch', 'Audience → Stage → Stage options'],
  ['Show Twitch or Rumble chat on stage', 'chat overlay twitch rumble comments', 'show:stage', '#overlaySwitch', 'Audience → Stage → Stage options'],
  ['Switch scenes / layouts', 'scene layout switch arrange', 'layouts', '#editToggle', 'Stage → Layout'],
  ['Present slides, a screen or a video', 'present pdf slides screen share video', null, '#shareBtn', 'Present button in the dock'],
  ['Ask your AI', 'ai claude chatgpt gemini grok research', 'ai', '#aiInput', 'AI'],
  ['Add a banner or ticker', 'banner lower third ticker headline', 'overlays', '#bannerText', 'Stage → Overlays'],
  ['Upload custom chat emotes', 'emote emoji custom sticker chat', 'overlays', '#emoteName', 'Stage → Overlays → Custom emotes'],
  ['Change stage colours, fonts and animations', 'brand colour color font animation style', 'brand', '#fontCardGrid', 'Stage → Brand'],
  ['Add my logo or a transparent overlay', 'logo overlay watermark frame ai', 'overlays', '#overlayPick', 'Stage → Overlays → Stage overlay'],
  ['Show my PayPal, Venmo or Cash App', 'tip donate paypal venmo cash app stripe support qr', 'show:supers', '#tipList', 'Audience → Get paid → Tip QR cards'],
  ['Run a live auction', 'auction bid bidding whatnot sell highest bidder sudden death', 'shop', '#auTitle', 'Shop → Live auction'],
  ['Run a giveaway', 'giveaway raffle contest prize winner draw', 'shop', '#gwPrize', 'Shop → Giveaway'],
  ['Shout out or raid another creator', 'shoutout shout out raid host send viewers follow creator', 'show:gaming', '#soName', 'Audience → Play → Shoutout & raid'],
  ['Sell products in the live shop', 'shop merch store shopify etsy product sale', 'shop', '#shopDomain', 'Shop'],
  ['Start a live poll or prediction', 'poll prediction vote audience quiz', 'polls', '#pollQ', 'Polls'],
  ['Play with viewers (queue)', 'play gaming queue gamertag viewers', 'gaming', '#wpQueue', 'Play'],
  ['Change my name or photo', 'name nickname photo avatar profile', null, '#userBtn', 'Your account (top right)'],
  ['Change my password', 'password reset account security', null, '#userBtn', 'Your account → Change password'],
  ['Record the show', 'record recording save download', null, '#recBtn', 'Record button in the dock'],
  ['A guest can’t connect', 'connect firewall turn network corporate', 'settings', '#turnUrl', 'Settings → Your own relay server'],
  ['Switch to light mode', 'light dark theme appearance', 'settings', '#themeSeg', 'Settings → Appearance'],
  ['Auto-mute silent microphones', 'auto mute silence inactive quiet noise mic', 'settings', '#autoMuteChk', 'Settings → Microphone → Auto-mute when silent'],
  ['Keyboard shortcuts', 'shortcuts hotkeys keybindings keyboard accessibility', null, '#shortcutsRoot', 'Your account → Shortcuts'],
];
const POPULAR = [3, 2, 5, 10, 14, 17];
function helpGo(row) {
  const [, , tab, sel] = row;
  const hits = store.get('helpHits', {}); hits[row[0]] = (hits[row[0]] || 0) + 1; rawSet('helpHits', hits);
  if ($('#helpDlg').open) $('#helpDlg').close();
  if (tab) setTab(tab);
  if (sel === '#userBtn') return openAccount();
  if (sel === '#shortcutsRoot') return openShortcutsLightbox();
  if (sel === '#wizOpen') { setTab('stream'); return openWizard(); }
  const el = $(sel);
  if (!el) return;
  setTimeout(() => {
    el.scrollIntoView({ behavior: smooth(), block: 'center' });
    const box = el.closest('.fld, .toggle-row, .toggle-inline, .icon-btn, .btn, .seg') || el;
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
    if (el.focus) el.focus({ preventScroll: true });
  }, 120);
}
function helpRow(row) {
  const li = document.createElement('li');
  const b = document.createElement('button'); b.type = 'button'; b.className = 'menu-item help-item';
  const t = document.createElement('b'); t.textContent = row[0];
  const w = document.createElement('span'); w.textContent = row[4];
  b.append(t, w); b.onclick = () => helpGo(row);
  li.append(b); return li;
}
function renderHelp() {
  const q = $('#helpSearch').value.trim().toLowerCase();
  const hits = store.get('helpHits', {});
  const popular = [...POPULAR.map((i) => HELP[i]), ...HELP].filter((r, i, a) => a.indexOf(r) === i)
    .sort((a, b) => (hits[b[0]] || 0) - (hits[a[0]] || 0)).slice(0, 6);
  replaceKids($('#helpPopular'), ...popular.map(helpRow));
  $('#helpPopWrap').hidden = !!q;
  const words = q.split(/\s+/).filter(Boolean);
  const res = q ? HELP.filter((r) => words.every((w) => (r[0] + ' ' + r[1] + ' ' + r[4]).toLowerCase().includes(w))) : [];
  replaceKids($('#helpResults'), ...res.map(helpRow));
  $('#helpNone').hidden = !q || !!res.length;
}
$('#helpSearch').addEventListener('input', renderHelp);
$('#helpSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = $('#helpResults .help-item'); first?.click(); } });

// ---------------------------------------------------------------- recording → ./golive.js
const liveMod = createGoLive({
  $, $$, store, S, isHost, toast, fmtTime, copy, get recDest() { return recDest; }, audioCtx, api, creds,
  wsSend, setStage, canvas, renderGoogle, renderDock, setTab, get watchLinkUrl() { return watchLinkUrl; }, tallCanvas, useTall
});
const { liveDests, readyDests } = liveMod;
function renderSocialMatrix(...args) { return liveMod.renderSocialMatrix(...args); }
function renderLive(...args) { return liveMod.renderLive(...args); }
function syncAirPill(...args) { return liveMod.syncAirPill(...args); }
function stopLive(...args) { return liveMod.stopLive(...args); }
function wakeRelay(...args) { return liveMod.wakeRelay(...args); }
function toggleRecord(...args) { return liveMod.toggleRecord(...args); }
function renderDriveButton(...args) { return liveMod.renderDriveButton(...args); }

// ---------------------------------------------------------------- chat, options, file sharing & guest-only brief
const chatFileCache = new Map();
function fmtBytes(n) {
  const v = Number(n) || 0;
  return v >= 1048576 ? (v / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(v / 1024)) + ' KB';
}
async function getChatFile(fid) {
  if (!fid) return null;
  if (chatFileCache.has(fid)) return chatFileCache.get(fid);
  const res = await api('chatFileGet', { ...creds(), file: fid });
  if (res?.data) chatFileCache.set(fid, res);
  return res;
}
function attachFileCard(f) {
  const card = document.createElement('div');
  card.className = 'chat-file-card';
  if (f.mime?.startsWith('image/')) {
    const img = document.createElement('img');
    img.className = 'chat-file-img';
    img.alt = f.name || 'Image attachment';
    getChatFile(f.id).then((res) => { if (res?.data) img.src = res.data; }).catch(() => {});
    img.onclick = async () => {
      try {
        const res = await getChatFile(f.id);
        if (!res?.data) return;
        const a = document.createElement('a'); a.href = res.data; a.download = f.name || 'image'; a.click();
      } catch (e) { toast(e.message, { err: true }); }
    };
    card.append(img);
  }
  const row = document.createElement('div');
  row.className = 'chat-file-row';
  const meta = document.createElement('div');
  meta.className = 'chat-file-meta';
  const nm = document.createElement('b'); nm.textContent = f.name || 'Studio file';
  const sz = document.createElement('small'); sz.textContent = f.size ? fmtBytes(f.size) : (f.mime || 'File');
  meta.append(nm, sz);
  const dl = document.createElement('button');
  dl.type = 'button'; dl.className = 'btn sm chat-file-dl';
  dl.innerHTML = icon('download', { size: 'sm' }) + '<span>Download</span>';
  dl.onclick = async () => {
    busy(dl);
    try {
      const res = await getChatFile(f.id);
      if (!res?.data) throw new Error('File unavailable.');
      const a = document.createElement('a'); a.href = res.data; a.download = f.name || 'file'; a.click();
    } catch (e) { toast(e.message, { err: true }); }
    finally { busy(dl, false); }
  };
  row.append(meta, dl);
  card.append(row);
  return card;
}
function addMsg(msg) {
  const li = document.createElement('li');
  const mine = msg.from === S.id;
  li.className = 'msg' + (mine ? ' me' : '');
  const who = document.createElement('div'); who.className = 'who';
  const b = document.createElement('b'); b.textContent = mine ? 'You' : msg.name;
  who.append(b);
  const scope = msg.scope === 'every' ? 'every' : 'guests';
  const sc = document.createElement('span');
  sc.className = 'msg-scope' + (scope === 'every' ? ' every' : '');
  sc.textContent = scope === 'every' ? 'Every chat' : 'Guests only';
  who.append(sc);
  const body = [];
  if (msg.text) {
    const txt = document.createElement('div'); txt.className = 'txt';
    const parts = String(msg.text).split(/(https?:\/\/[^\s<]+)/g);
    for (const part of parts) {
      if (/^https?:\/\//.test(part)) { const a = document.createElement('a'); a.href = part; a.textContent = part; a.target = '_blank'; a.rel = 'noopener noreferrer'; txt.append(a); }
      else if (part) txt.append(document.createTextNode(part));
    }
    body.push(txt);
  }
  if (msg.file?.id) body.push(attachFileCard(msg.file));
  const fm = { id: msg.id, src: 'studio', name: msg.name, color: '', text: msg.text || (msg.file?.name ? `📎 ${msg.file.name}` : ''), ts: msg.ts, guestsOnly: scope !== 'every' };
  pushFeed(fm);
  setMsgData(li, fm);
  li.append(who, ...body, msgActions(fm));
  chatShell(li, { id: msg.id, name: msg.name, ts: msg.ts });
  appendLog(li);
  applyModeration(li);
  if (!mine && S.tab !== 'chat') { S.unread++; $('#chatBadge').hidden = false; }
}
function sysMsg(text) { const li = document.createElement('li'); li.className = 'msg sys'; li.textContent = text; appendLog(li); }
function handNotify(id, name) {
  const who = name || 'A guest';
  const li = document.createElement('li'); li.className = 'msg hand-note';
  li.innerHTML = `<svg class="i" aria-hidden="true"><use href="/icons.svg#i-hand"/></svg><span><b></b> raised their hand</span>`;
  $('b', li).textContent = who;
  const onStage = S.state.stage.includes(id);
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn sm';
  btn.textContent = onStage ? 'People' : 'Put on stage';
  btn.onclick = () => {
    if (!S.state.stage.includes(id) && S.peers.has(id)) toggleStage(id);
    setDeck('people');
  };
  li.append(btn);
  appendLog(li);
  if (S.tab !== 'chat') { S.unread++; $('#chatBadge').hidden = false; }
  chime();
  toast(`${who} raised their hand`, { action: ['People', () => setDeck('people')] });
}
function appendLog(li) {
  const log = $('#msgs'); const body = log.parentElement;
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  log.append(li);
  $('#chatEmpty').hidden = true;
  if (atBottom || li.classList.contains('me')) body.scrollTop = body.scrollHeight;
}
function renderChatOpts() {
  const opts = { guestFiles: true, defaultScope: 'guests', ...(S.state.chatOpts || {}) };
  const host = isHost(), inside = !!S.studio;
  const wc = watchCfg();
  if ($('#optGuestFiles')) { $('#optGuestFiles').checked = opts.guestFiles !== false; $('#optGuestFiles').disabled = !host; }
  if ($('#optWatchChat')) { $('#optWatchChat').checked = wc.chat !== false; $('#optWatchChat').disabled = !host; }
  $$('#optDefaultScope [data-scope]').forEach((b) => {
    const on = b.dataset.scope === opts.defaultScope;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.disabled = !host;
  });
  if ($('#optEditBriefBtn')) $('#optEditBriefBtn').disabled = !inside || !host;
  const scope = host ? (S.chatScope || opts.defaultScope) : 'guests';
  $$('#chatScopeSeg [data-scope]').forEach((b) => {
    const on = b.dataset.scope === scope;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const canAttach = inside && (host || opts.guestFiles !== false);
  if ($('#chatFileBtn')) $('#chatFileBtn').hidden = !canAttach;
  if ($('#chatFileChip')) {
    $('#chatFileChip').hidden = !S.pendingChatFile;
    if (S.pendingChatFile) {
      $('#chatFileChip').innerHTML = `${icon('paperclip', { size: 'sm' })}<span></span><button type="button" aria-label="Remove attachment">${icon('x', { size: 'sm' })}</button>`;
      $('#chatFileChip span').textContent = S.pendingChatFile.name;
      $('#chatFileChip button').onclick = () => { S.pendingChatFile = null; renderChatOpts(); };
    }
  }
  if ($('#chatComposerTop')) $('#chatComposerTop').hidden = !inside || (!host && !S.pendingChatFile);
  if ($('#chatHint')) {
    $('#chatHint').textContent = !inside
      ? 'Enter a studio to chat.'
      : host && scope === 'every'
      ? 'Sending to studio guests & Watch Party viewers · @Sam asks AI'
      : 'Shared with invited studio guests only · @Sam asks AI';
  }
}
$('#chatOptsBtn')?.addEventListener('click', (ev) => {
  togglePopover($('#chatOptsPop'), ev.currentTarget, 'bottom');
});
$('#optGuestFiles')?.addEventListener('change', (e) => {
  if (!isHost()) return;
  const chatOpts = { guestFiles: e.target.checked, defaultScope: S.state.chatOpts?.defaultScope === 'every' ? 'every' : 'guests' };
  setStage({ chatOpts });
  toast(e.target.checked ? 'Studio guests can share files in chat.' : 'Guest file uploads paused.');
});
$('#optWatchChat')?.addEventListener('change', (e) => {
  if (!isHost()) return;
  setWatch({ chat: e.target.checked });
  toast(e.target.checked ? 'Watch Party chat enabled.' : 'Watch Party chat paused.');
});
$$('#optDefaultScope [data-scope]').forEach((b) => b.addEventListener('click', () => {
  if (!isHost()) return;
  const scope = b.dataset.scope === 'every' ? 'every' : 'guests';
  S.chatScope = scope;
  setStage({ chatOpts: { guestFiles: S.state.chatOpts?.guestFiles !== false, defaultScope: scope } });
}));
$$('#chatScopeSeg [data-scope]').forEach((b) => b.addEventListener('click', () => {
  if (!isHost()) return;
  S.chatScope = b.dataset.scope === 'every' ? 'every' : 'guests';
  renderChatOpts();
}));
$('#chatFileBtn')?.addEventListener('click', () => {
  if (!S.studio) return toast('Enter a studio to upload files.');
  $('#chatFileInput').click();
});
$('#chatFileInput')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f || !S.studio) return;
  if (f.size > 2_000_000) return toast('Keep shared studio files under 2 MB.', { err: true });
  busy($('#chatFileBtn'));
  try {
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const uploaded = await api('chatFilePut', { ...creds(), name: f.name, mime: f.type, data });
    S.pendingChatFile = { id: uploaded.id, name: uploaded.name, mime: uploaded.mime, size: uploaded.size };
    renderChatOpts();
    toast(`${uploaded.name} ready to send.`);
  } catch (err) { toast(err.message, { err: true }); }
  finally { busy($('#chatFileBtn'), false); }
});

function renderGuestBrief() {
  const bar = $('#guestBriefBar');
  if (!bar) return;
  const b = S.brief;
  if (!S.studio || !b || (!b.note && !b.links?.length && !b.files?.length)) { bar.hidden = true; return; }
  bar.hidden = false;
  const count = (b.links?.length || 0) + (b.files?.length || 0);
  const head = document.createElement('button');
  head.type = 'button'; head.className = 'gb-head'; head.setAttribute('aria-expanded', String(S.briefExpanded));
  head.innerHTML = `<span class="gb-title">${icon('lock', { size: 'sm' })}<span>Guest-only brief</span></span><span class="gb-meta">${count ? `${count} item${count === 1 ? '' : 's'} · ` : ''}${S.briefExpanded ? 'Hide' : 'Show'}</span>`;
  head.onclick = () => { S.briefExpanded = !S.briefExpanded; renderGuestBrief(); };
  const body = document.createElement('div');
  body.className = 'gb-body'; body.hidden = !S.briefExpanded;
  if (b.note) { const p = document.createElement('p'); p.className = 'gb-note'; p.textContent = b.note; body.append(p); }
  if (b.links?.length) {
    const wrap = document.createElement('div'); wrap.className = 'gb-links';
    for (const l of b.links) {
      const a = document.createElement('a'); a.className = 'gb-link'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.innerHTML = `${icon('arrow-up-right', { size: 'sm' })}<span></span>`;
      $('span', a).textContent = l.label || l.url;
      wrap.append(a);
    }
    body.append(wrap);
  }
  if (b.files?.length) {
    const wrap = document.createElement('div'); wrap.className = 'gb-files';
    for (const f of b.files) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gb-file';
      btn.innerHTML = `${icon('paperclip', { size: 'sm' })}<span></span>`;
      $('span', btn).textContent = f.name || 'Download file';
      btn.onclick = async () => {
        try {
          const res = await getChatFile(f.id);
          if (!res?.data) return;
          const a = document.createElement('a'); a.href = res.data; a.download = f.name || 'file'; a.click();
        } catch (err) { toast(err.message, { err: true }); }
      };
      wrap.append(btn);
    }
    body.append(wrap);
  }
  if (isHost()) {
    const edBtn = document.createElement('button'); edBtn.type = 'button'; edBtn.className = 'btn sm ghost gb-edit-btn';
    edBtn.textContent = 'Edit guest brief';
    edBtn.onclick = openGuestBrief;
    body.append(edBtn);
  }
  replaceKids(bar, head, body);
}

let draftBriefFiles = [];
function addBriefLinkRow(label = '', url = '') {
  const list = $('#gbLinksEdit');
  if (!list) return;
  const row = document.createElement('div'); row.className = 'gb-link-row';
  const lbl = document.createElement('input'); lbl.className = 'input sm'; lbl.maxLength = 50; lbl.placeholder = 'Label (e.g. Sponsor deck)'; lbl.value = label;
  const u = document.createElement('input'); u.className = 'input sm'; u.maxLength = 400; u.placeholder = 'https://…'; u.spellcheck = false; u.value = url;
  const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn sm'; del.innerHTML = icon('x', { size: 'sm' }); del.setAttribute('aria-label', 'Remove link');
  del.onclick = () => row.remove();
  row.append(lbl, u, del);
  list.append(row);
}
function renderBriefDraftFiles() {
  const wrap = $('#gbFilesEdit');
  if (!wrap) return;
  replaceKids(wrap, ...draftBriefFiles.map((f, i) => {
    const row = document.createElement('div'); row.className = 'gb-file-row';
    const sp = document.createElement('span'); sp.textContent = `${f.name} (${fmtBytes(f.size)})`;
    const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn sm'; del.innerHTML = icon('x', { size: 'sm' }); del.setAttribute('aria-label', 'Remove file');
    del.onclick = () => { draftBriefFiles.splice(i, 1); renderBriefDraftFiles(); };
    row.append(sp, del);
    return row;
  }));
}
function openGuestBrief() {
  if (!isHost() || !S.studio) return toast('Enter a studio as host to share a guest brief.');
  try { $('#chatOptsPop')?.hidePopover?.(); } catch {}
  const b = S.brief || { note: '', links: [], files: [] };
  $('#gbNote').value = b.note || '';
  $('#gbLinksEdit').innerHTML = '';
  if (b.links?.length) b.links.forEach((l) => addBriefLinkRow(l.label, l.url));
  else addBriefLinkRow();
  draftBriefFiles = [...(b.files || [])];
  renderBriefDraftFiles();
  $('#guestBriefDlg').showModal();
}
$('#optEditBriefBtn')?.addEventListener('click', openGuestBrief);
// Pop-out chat (like StreamYard's): the watch page's live chat on its own, /w/<studio>?chat=1, in a window or on a phone.
const chatPopUrl = () => watchLinkUrl() + '?chat=1';
$('#optPopChat')?.addEventListener('click', () => {
  if (!S.studio) return toast('Enter your studio first.', { err: true });
  window.open(chatPopUrl(), 'gatherChat', 'popup,width=420,height=760');
});
$('#optPhoneChat')?.addEventListener('click', async () => {
  const box = $('#optChatQr'), btn = $('#optPhoneChat');
  if (!box.hidden) { box.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
  if (!S.studio) return toast('Enter your studio first.', { err: true });
  const q = await qrReadyFor(chatPopUrl());
  if (!q) return copy(chatPopUrl(), 'Couldn’t draw the QR code, so the chat link was copied instead.');
  $('img', box).src = q.createDataURL(4, 2);
  box.hidden = false; btn.setAttribute('aria-expanded', 'true');
});
$('#gbAddLink')?.addEventListener('click', () => addBriefLinkRow());
$('#gbPickFile')?.addEventListener('click', () => $('#gbFileInput').click());
$('#gbFileInput')?.addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; e.target.value = '';
  if (!f || !S.studio) return;
  if (f.size > 2_000_000) return toast('Keep studio files under 2 MB.', { err: true });
  busy($('#gbPickFile'));
  try {
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    const uploaded = await api('chatFilePut', { ...creds(), name: f.name, mime: f.type, data });
    draftBriefFiles.push({ id: uploaded.id, name: uploaded.name, mime: uploaded.mime, size: uploaded.size });
    renderBriefDraftFiles();
  } catch (err) { toast(err.message, { err: true }); }
  finally { busy($('#gbPickFile'), false); }
});
$('#gbClear')?.addEventListener('click', () => {
  wsSend({ type: 'guestBrief', brief: null });
  $('#guestBriefDlg').close();
  toast('Guest brief cleared.');
});
$('#guestBriefForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const note = $('#gbNote').value.trim();
  const links = $$('#gbLinksEdit .gb-link-row').map((r) => {
    const [lbl, u] = r.querySelectorAll('input');
    return { label: lbl.value.trim(), url: u.value.trim() };
  }).filter((l) => l.url);
  wsSend({ type: 'guestBrief', brief: { note, links, files: draftBriefFiles } });
  $('#guestBriefDlg').close();
  toast('Guest brief updated.');
});

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#chatInput').value.trim();
  if (!v && !S.pendingChatFile) return;
  if (!S.studio) return toast('Enter a studio to chat.');
  // "@Sam …" in the chat goes to your AI instead (host only).
  const at = isHost() && !S.pendingChatFile && new RegExp('^@' + (S.aiName || 'Sam').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[\\s,:]*', 'i').exec(v);
  if (at && v.length > at[0].length) {
    $('#chatInput').value = ''; autoGrow($('#chatInput'));
    $('#aiInput').value = v.slice(at[0].length); $('#aiForm').requestSubmit(); return;
  }
  const scope = isHost() ? (S.chatScope || S.state.chatOpts?.defaultScope || 'guests') : 'guests';
  wsSend({ type: 'chat', text: v, scope, ...(S.pendingChatFile ? { file: S.pendingChatFile } : {}) });
  $('#chatInput').value = ''; autoGrow($('#chatInput'));
  if (S.pendingChatFile) { S.pendingChatFile = null; renderChatOpts(); }
});

// ---------------------------------------------------------------- rendering
function setPhase(p) {
  S.phase = p;
  document.body.classList.toggle('syncing', p === 'connecting' || p === 'reconnecting'); // skeletons until the studio arrives
  const pill = $('#statusPill');
  pill.dataset.state = p === 'online' ? 'online' : p === 'offline' ? 'offline' : 'connecting';
  $('#statusText').textContent = { offline: 'Offline', connecting: 'Connecting…', online: '', reconnecting: 'Reconnecting…' }[p];
  pill.hidden = p === 'online';
  renderAll();
}
function renderAll() {
  renderScorePanel(); renderBountyPanel(); renderBrandKit(); renderHeader(); renderStageUI(); renderCrew(); renderDock(); renderPanels(); renderFeedUI(); renderChatOpts(); renderGuestBrief(); renderLayoutsPanel(); renderAIPanel(); renderTips(); renderBrandPanel(); renderStreamPanel(); renderGuestView(); syncTwitch(); syncCaptions(); renderDeck(); renderAds(); renderProducerUI(); renderGreenRoom(); renderLive(); renderWatchSec();
  for (const fn of stateSyncSubs) { try { fn(S.state); } catch {} }
}
function renderHeader() {
  // The studio name belongs to the studio you're in; outside one the header is just the wordmark.
  const inside = !!S.studio || S.phase === 'reconnecting';
  $('#topTitle').hidden = !inside;
  if (document.activeElement !== $('#studioTitle')) $('#studioTitle').textContent = S.state.title || DEFAULT_TITLE;
  $('#studioTitle').classList.toggle('editable', isHost());
  $('#studioTitle').title = isHost() ? 'Click to rename the show' : '';
  $('#enterTop').hidden = !S.studio;
  if ($('#watchTop')) $('#watchTop').hidden = !S.studio || !isHost();
  $('#liveTop').hidden = !S.studio || !isHost();
  // landing: just the stage hero. A host checking their camera before going in already sees their studio behind it.
  document.body.classList.toggle('pre', !S.studio && S.phase !== 'reconnecting' && !S.hostEntering);
  // Scheduled shows: on the landing page they sit under the hero (that's where you start one); inside a studio, in Go live.
  const upHome = document.body.classList.contains('pre') ? $('#landing .land-copy') : $('#liveDlg .live-body');
  if ($('#upBlock').parentElement !== upHome) upHome.append($('#upBlock'));
}
function renderStageUI() {
  renderScenes();
  $('#hostNote').hidden = isHost();
  evaluateSceneSuggestion();
}
const ICON = { stage: icon('monitor', { size: 'sm' }), mute: icon('mic-off', { size: 'sm' }), kick: icon('log-out', { size: 'sm' }) };
function renderCrew() {
  const list = $('#crewList'), add = $('.crew-add');
  const people = S.studio ? participants() : [];
  $('#crewCount').textContent = `${people.length} / ${MAX}`;
  $('#peopleTabCount').textContent = people.length || '';
  if ($('#inviteDlg')?.open && S.studio) renderInviteDialog();
  const keep = new Set(people.map((p) => 'card-' + cssId(p.id)));
  for (const li of $$('.crew-card', list)) if (!keep.has(li.id)) li.remove();
  const host = isHost();
  for (const p of people) {
    let li = $('#card-' + cssId(p.id));
    if (!li) {
      li = document.createElement('li'); li.className = 'crew-card'; li.id = 'card-' + cssId(p.id); li.dataset.id = p.id;
      li.innerHTML = `<div class="crew-thumb"><video playsinline></video><div class="ini" hidden><span></span></div>`
        + `<div class="crew-viz" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><div class="crew-vu" aria-hidden="true"><i></i></div>`
        + `<div class="crew-tools"><button type="button" class="icon-btn sm on-media ct-stage" aria-pressed="false">${ICON.stage}</button><button type="button" class="icon-btn sm on-media ct-mute" aria-label="Ask to mute">${ICON.mute}</button><button type="button" class="icon-btn sm on-media danger ct-kick" aria-label="Remove from studio">${ICON.kick}</button></div></div>`
        + `<div class="crew-info"><div class="crew-name"><span class="nm"></span></div><div class="tagrow"></div><div class="crew-sub"></div></div>`; // status lives beside the picture, not on it
      const v = $('video', li);
      // Started from code, not the autoplay attribute: browsers pause a muted *autoplay* video once it's out of view (a
      // folded strip on a phone), and the stage draws every camera from these videos.
      if (p.me) { v.muted = true; const ov = outVideo(); if (ov) v.srcObject = new MediaStream([ov]); v.classList.toggle('mirror', !!S.videoFx.mirror); playEl(v); }
      else if (p.peer.stream.getTracks().length) { v.srcObject = p.peer.stream; playEl(v); }
      $('.ct-stage', li).addEventListener('click', () => toggleStage(p.id));
      // the host clicks someone's picture to bring them on stage or send them backstage
      $('.crew-thumb', li).addEventListener('click', (ev) => { if (isHost() && !ev.target.closest('.crew-tools')) toggleStage(p.id); });
      $('.ct-mute', li).addEventListener('click', () => { wsSend({ type: 'mute', id: p.id }); toast(`Muted ${p.name}.`); });
      $('.ct-kick', li).addEventListener('click', () => {
        const btn = $('.ct-kick', li);
        if (!btn.classList.contains('confirm')) { btn.classList.add('confirm'); btn.setAttribute('aria-label', 'Click again to remove'); setTimeout(() => { btn.classList.remove('confirm'); btn.setAttribute('aria-label', 'Remove from studio'); }, 3000); return; }
        wsSend({ type: 'kick', id: p.id }); toast(`${p.name} was removed. Lock the studio to keep them out.`);
      });
      list.insertBefore(li, add);
    }
    list.insertBefore(li, add); // keep join order
    $('.nm', li).textContent = p.name; li.classList.toggle('me', !!p.me);
    const nameRow = $('.crew-name', li);
    nameRow.querySelector('.muted-ic')?.remove(); nameRow.querySelector('.host-tag')?.remove();
    if (p.id === S.host) nameRow.insertAdjacentHTML('beforeend', '<span class="host-tag">Host</span>');
    else if (p.me) nameRow.insertAdjacentHTML('beforeend', '<span class="host-tag you">You</span>');
    $('.crew-thumb .mic-off', li)?.remove();
    if (!p.mic) $('.crew-thumb', li).insertAdjacentHTML('beforeend', `<span class="mic-off" role="img" aria-label="Muted">${icon('mic-off', { size: 'sm' })}</span>`);
    const viz = $('.crew-viz', li), vu = $('.crew-vu', li);
    if (viz) viz.hidden = !p.mic;
    if (vu) vu.hidden = !p.mic;
    const ini = $('.ini', li); ini.hidden = !!p.cam;
    const bg = assetImg(p.offbg);
    ini.style.backgroundImage = bg ? `url("${bg.src}")` : '';
    const avImg = assetImg(p.avatar), span = $('span', ini);
    if (avImg) { span.textContent = ''; span.style.backgroundImage = `url("${avImg.src}")`; span.classList.add('has-av'); }
    else { span.textContent = initials(p.name); span.style.backgroundImage = ''; span.classList.remove('has-av'); }
    const tags = $('.tagrow', li); replaceKids(tags);
    const on = S.state.stage.includes(p.id);
    tags.insertAdjacentHTML('beforeend', on ? '<span class="cstate on"><i></i>On stage</span>' : '<span class="cstate"><i></i>Backstage</span>'); // "Live" only ever means broadcasting
    $('.crew-thumb', li).classList.toggle('pickable', host);
    $('.crew-thumb', li).title = host ? (on ? `Click to send ${p.me ? 'yourself' : p.name} backstage` : `Click to put ${p.me ? 'yourself' : p.name} on stage`) : '';
    if (p.sharing) tags.insertAdjacentHTML('beforeend', '<span class="cstate pres">Presenting</span>');
    $('.crew-thumb .hand-badge', li)?.remove();
    if (p.hand) $('.crew-thumb', li).insertAdjacentHTML('beforeend', `<span class="hand-badge" role="status" aria-label="Hand raised"><svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-hand"/></svg><span>Hand</span></span>`);
    li.classList.toggle('hand-up', !!p.hand);
    li.classList.toggle('on-stage', on);
    $('.crew-tools', li).hidden = !host;
    const st = $('.ct-stage', li); st.setAttribute('aria-label', on ? 'Take off stage' : 'Put on stage'); st.setAttribute('aria-pressed', String(on));
    $('.ct-mute', li).hidden = !!p.me || !p.mic;
    $('.ct-kick', li).hidden = !!p.me;
  }
  renderCrewSubs();
  add.hidden = people.length >= MAX;
}
function renderCrewSubs() {
  for (const p of participants()) {
    const id = cssId(p?.id);
    if (!id) continue;
    const card = document.getElementById('card-' + id);
    const sub = card && $('.crew-sub', card);
    if (!sub) continue;
    if (p.me) {
      const autoMuted = !!S.local.autoMuted && !S.local.micOn;
      card.classList.toggle('auto-muted', autoMuted);
      // Same test as the muted badge on the picture (participants(): a mic counts only with a live audio track),
      // so the card never says "mic on" next to a muted badge.
      const micTxt = p.mic ? 'mic on' : !S.local.micOn ? (autoMuted ? 'auto-muted' : 'muted') : 'no mic';
      const presLbl = S.local.pres ? ({ screen: 'a screen', video: 'a video', pdf: 'slides' }[S.local.pres.kind] || 'content') : '';
      sub.textContent = S.local.pres ? `Presenting ${presLbl}` : `${p.cam ? 'Camera on' : 'Camera off'} · ${micTxt}`;
    }
    else {
      card.classList.remove('auto-muted');
      const c = p.peer?.conn;
      sub.textContent = c === 'connected' ? `Connected${p.peer.rtt != null ? ` · ${p.peer.rtt} ms` : ''}` : c === 'failed' ? 'Connection failed · retrying' : c === 'disconnected' ? 'Reconnecting…' : 'Connecting…';
    }
  }
}
function renderDock() {
  const mic = $('#micBtn'), cam = $('#camBtn'), share = $('#shareBtn'), rec = $('#recBtn');
  const micOff = !S.local.micOn || !S.local.audio;
  mic.setAttribute('aria-pressed', micOff && S.phase !== 'offline' ? 'true' : String(micOff && !!S.local.audio));
  $('#micLabel').textContent = S.studio ? (micOff ? 'Unmute' : 'Mute') : 'Microphone';
  const camOff = !S.local.camOn;
  cam.setAttribute('aria-pressed', String(camOff && !!S.studio));
  $('#camLabel').textContent = S.studio ? (camOff ? 'Start camera' : 'Stop camera') : 'Camera';
  share.classList.toggle('active', !!S.local.pres);
  $('#shareLabel').textContent = S.local.pres ? 'Stop presenting' : 'Present';
  share.disabled = !S.studio;
  rec.classList.toggle('recording', !!S.rec);
  rec.setAttribute('aria-pressed', String(!!S.rec));
  $('#skipDock').hidden = !S.studio;
  rec.setAttribute('aria-label', S.rec ? `Stop recording (${fmtTime(Date.now() - S.rec.t0)})` : 'Record');
  $('#recLabel').textContent = S.rec ? fmtTime(Date.now() - S.rec.t0) : 'Record';
  rec.disabled = !S.studio;
  // Everyone in the studio sees when the show is recorded or live, not just the host (consent).
  const shared = S.studio ? S.state : null, onAir = !!(S.live?.phase === 'live' || shared?.live?.on), recSince = S.rec?.t0 || (shared?.rec?.on && shared.rec.since);
  $('#recPill').hidden = !recSince && !(onAir && !isHost());
  $('#recPill').classList.toggle('compact', !!recSince && onAir);
  $('#recPillText').textContent = recSince ? 'Rec ' + fmtTime(Date.now() - recSince) : 'Live';
  $('#recPill').title = recSince ? 'This show is being recorded' : 'This show is live';
  $('#leaveBtn').disabled = !S.studio;
  const hand = $('#handBtn');
  if (hand) {
    const raised = !!S.local.hand && !!S.studio && !isHost();
    hand.disabled = !S.studio || isHost();
    hand.classList.toggle('active', raised);
    hand.setAttribute('aria-pressed', String(raised));
    $('#handLabel').textContent = raised ? 'Lower hand' : 'Raise hand';
  }
  renderDockNote();
  syncAirPill();
}
// ---------------------------------------------------------------- first-run guide: one next step at a time, in the dock
// Four steps for a new host (the show is named automatically). Each ticks itself off from what actually happened (camera and mic on,
// a guest invited, a scene picked, recording or live), so it never asks you to confirm anything. Shown once.
const GUIDE = [
  { id: 'av', label: 'Turn on camera and mic', done: () => !!(S.local.camOn && S.local.micOn && S.local.audio), go: () => openDlg('settingsDlg') },
  { id: 'invite', label: 'Invite a guest', done: () => S.guide.invited || S.peers.size > 0, go: () => openInvite() },
  { id: 'scene', label: 'Pick a scene', done: () => S.guide.scened, go: () => { $('#deck')?.scrollIntoView({ behavior: smooth(), block: 'center' }); $('#sceneStrip .scene:not(.on)')?.focus(); } },
  { id: 'show', label: 'Record or go live', done: () => !!(S.rec || S.live?.phase === 'live'), go: () => openDlg('liveDlg') },
];
S.guide = { ...{ dismissed: false, finished: false, invited: false, scened: false }, ...store.get('guide', {}) };
function saveGuide() { store.set('guide', { dismissed: S.guide.dismissed, finished: S.guide.finished, invited: S.guide.invited, scened: S.guide.scened }); }
function renderGuide() {
  const el = $('#guide');
  const active = isHost() && !!S.studio && !S.guide.dismissed && !S.guide.finished;
  if (!active) { el.hidden = true; return false; }
  const states = GUIDE.map((g) => !!g.done());
  const next = GUIDE.findIndex((g, i) => !states[i]);
  if (next < 0) { S.guide.finished = true; saveGuide(); el.hidden = true; toast('Your studio is ready. Have a great show.'); return false; }
  el.hidden = false;
  $('#guideProg').textContent = `Getting started · ${states.filter(Boolean).length} of ${GUIDE.length} done`;
  $('#guideStep').textContent = GUIDE[next].label;
  $('#guideGo').dataset.step = GUIDE[next].id;
  replaceKids($('#guideDots'), ...GUIDE.map((g, i) => { const d = document.createElement('i'); d.className = states[i] ? 'done' : i === next ? 'now' : ''; return d; }));
  return true;
}
$('#guideGo').onclick = () => GUIDE.find((g) => g.id === $('#guideGo').dataset.step)?.go();
$('#guideSkip').onclick = () => { S.guide.dismissed = true; saveGuide(); renderDock(); toast('Guide hidden. Help has everything it covered.'); };
function guideMark(k) { if (S.guide[k] || S.guide.finished) return; S.guide[k] = true; saveGuide(); renderDock(); }

function renderDockNote() {
  const el = $('#dockNoteText');
  $('#dockNote').hidden = (!S.studio && S.phase !== 'reconnecting') || renderGuide();
  $('#noteInvite').hidden = !S.studio;
  if (!S.studio) { el.textContent = S.phase === 'reconnecting' ? 'Reconnecting to your studio…' : ''; return; }
  const peers = [...S.peers.values()];
  $('#noteInvite').hidden = false; $('#noteCodeText').textContent = S.studio;
  if (!peers.length) { el.textContent = 'Waiting for guests'; return; }
  const up = peers.filter((p) => p.conn === 'connected');
  const rtts = up.map((p) => p.rtt).filter((x) => x != null);
  const avg = rtts.length ? ` · ${Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length)} ms avg` : '';
  el.textContent = `${up.length} peer connection${up.length === 1 ? '' : 's'}${up.length < peers.length ? ` (${peers.length - up.length} connecting)` : ''}${avg}`;
}
function renderPanels() {
  const host = isHost();
  for (const id of ['bannerShow', 'bannerHide', 'tickerShow', 'tickerHide', 'colorPick', 'namesChk']) $('#' + id).disabled = !host;
  $$('#swatches button, #bgs button, #bannerPresets .use').forEach((b) => (b.disabled = !host));
  $('#bannerHint').textContent = host ? 'Banners appear on every participant’s stage and in recordings.' : 'Only the host can show banners. You’ll see them on your stage.';
  $('#brandHint').textContent = host ? 'Brand changes apply to everyone in the studio.' : 'Only the host can change the brand.';
  const b = S.state.brand;
  applyAdaptiveAccent(b.color);
  $$('#swatches button').forEach((x) => x.classList.toggle('on', String(x.dataset.color || '').toLowerCase() === String(b?.color || '').toLowerCase()));
  $$('#bgs button').forEach((x) => x.classList.toggle('on', x.dataset.bg === b.bg));
  $('#colorPick').value = normalizeHex(b.color) || '#3b82f6';
  $('#namesChk').checked = b.names;
  if (document.activeElement !== $('#titleInput')) $('#titleInput').value = S.state.title || '';
  renderPresets();
  $('#chatInput').disabled = !S.studio;
  $('#chatInput').placeholder = S.studio ? 'Message the studio…' : 'Enter a studio to chat';
  $('#chatEmptyText').innerHTML = S.studio ? 'No messages yet.<br>Everyone in the studio sees what you send.' : 'No messages yet.<br>Enter a studio to chat.';
  $('#chatEmpty').hidden = !!$('#msgs').children.length;
}
function renderBannerState() {
  const live = S.state.banner, text = $('#bannerText').value.trim(), sub = $('#bannerSub').value.trim();
  const edited = !!live && (text !== live.text || sub !== (live.sub || ''));
  $('#bannerEdited').hidden = !edited;
  $('#bannerShow').textContent = edited ? 'Update banner' : 'Show on stage';
}
$('#bannerText').addEventListener('input', renderBannerState);
$('#bannerSub').addEventListener('input', renderBannerState);
function renderPresets() {
  renderBannerState();
  const presets = store.get('presets', DEFAULT_PRESETS);
  const ul = $('#bannerPresets');
  const live = S.state.banner?.text;
  replaceKids(ul, ...presets.map((text, i) => {
    const li = document.createElement('li'); li.className = 'preset' + (live === text ? ' live' : '');
    const p = document.createElement('p'); p.textContent = text;
    const row = document.createElement('div'); row.className = 'row';
    const use = document.createElement('button'); use.className = 'btn sm use'; use.textContent = live === text ? 'On stage' : 'Use banner'; use.disabled = !isHost();
    use.onclick = () => { $('#bannerText').value = text; $('#bannerSub').value = ''; showBanner(); };
    const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn sm del'; del.innerHTML = icon('trash-2', { size: 'sm' }); del.setAttribute('aria-label', 'Delete preset');
    del.onclick = () => { const list = store.get('presets', DEFAULT_PRESETS); list.splice(i, 1); store.set('presets', list); renderPresets(); };
    row.append(use, del); li.append(p, row); return li;
  }));
}

// ---------------------------------------------------------------- panels & controls
// 5-tab rail: Chat, Stage (look: layouts/brand/overlays/music), Audience (show: watch/viewers/supers/stage/polls/gaming), Shop, AI.
const TAB_ALIAS = { banners: 'look:overlays', emotes: 'look:overlays', overlays: 'look:overlays', layouts: 'look:layouts', brand: 'look:brand', music: 'look:music', audio: 'look:music', look: 'look:', stage: 'look:', audience: 'show:', play: 'show:gaming', queue: 'show:gaming', gaming: 'show:gaming', poll: 'show:polls', polls: 'show:polls', stream: 'dlg:liveDlg', settings: 'dlg:settingsDlg', help: 'dlg:helpDlg' };
function openDlg(id) {
  for (const other of ['liveDlg', 'settingsDlg', 'helpDlg']) if (other !== id && $('#' + other).open) $('#' + other).close();
  const d = $('#' + id);
  if (!d.open) d.showModal();
  if (id === 'settingsDlg') listDevices();
  if (id === 'liveDlg') { renderLive(); wakeRelay(); }
  if (id === 'helpDlg') { $('#helpSearch').value = ''; renderHelp(''); $('#helpSearch').focus(); }
}
function applyAudienceSub(sub) {
  S.audSub = sub || S.audSub || 'watch';
  $$('.aud-seg [data-aud]').forEach((b) => {
    const on = b.dataset.aud === S.audSub;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (S.audSub === 'polls' || S.audSub === 'gaming') {
    $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== S.audSub));
    return;
  }
  $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== 'show'));
  // Each top-level section names its sub-tab in data-aud-group (studio-tools.js sets it on the sections it adds).
  const group = ['watch', 'viewers', 'supers', 'stage'].includes(S.audSub) ? S.audSub : 'watch';
  const body = $('#watchSec');
  if (body) {
    for (const sec of $$('details.psec', body)) {
      if (sec.parentElement.closest('details.psec')) continue;
      const g = sec.dataset.audGroup || '';
      sec.hidden = g ? g !== group : false;
    }
  }
}
// panels.js: a jump chip for a section on another sub-tab switches to it; clearing "Find a setting" re-applies the sub-tab.
document.addEventListener('gather:aud-jump', (e) => { if (e.detail?.group) setTab('show:' + e.detail.group); });
document.addEventListener('gather:aud-sync', () => { if (S.tab === 'show') applyAudienceSub(S.audSub); });
function setTab(tab) {
  const raw = TAB_ALIAS[tab] || tab;
  const a = typeof raw === 'string' ? raw : '';
  if (!a) return;
  if (a.startsWith('dlg:')) return openDlg(a.slice(4));
  let panel = a, rail = a;
  if (a.startsWith('look:')) { S.lookSub = a.slice(5) || S.lookSub || 'layouts'; panel = S.lookSub; rail = 'look'; }
  if (a.startsWith('show:')) { S.audSub = a.slice(5) || S.audSub || 'watch'; panel = (S.audSub === 'polls' || S.audSub === 'gaming') ? S.audSub : 'show'; rail = 'show'; }
  S.tab = rail;
  document.body.classList.remove('panel-closed'); $('#panelToggle').setAttribute('aria-expanded', 'true');
  $$('.rail-btn').forEach((b) => { const on = b.dataset.tab === rail; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== panel));
  $$('.look-seg [data-look]').forEach((b) => { const on = b.dataset.look === panel; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  if (rail === 'show') applyAudienceSub(S.audSub || 'watch');
  if (rail === 'chat') { S.unread = 0; $('#chatBadge').hidden = true; }
  if (panel !== 'layouts' && editor.on) setEditing(false);
}
// Phones (720px and narrower) get one column: the video, the controls right under it, the scenes strip, then the
// panel tabs and the open panel (chat by default) filling the rest. Nothing slides over the video. The controls move
// under the video here and back to the bottom of the window on wider screens.
const phoneLayout = matchMedia('(max-width: 720px)');
const dockEl = $('#dock'), dockHome = { parent: dockEl?.parentNode, next: dockEl?.nextSibling };
function placeDock() {
  if (!dockEl) return;
  if (phoneLayout.matches) { const card = $('.stage-card'); if (card && card.nextElementSibling !== dockEl) card.after(dockEl); }
  else if (dockEl.parentNode !== dockHome.parent) dockHome.parent.insertBefore(dockEl, dockHome.next);
}
placeDock();
phoneLayout.addEventListener('change', () => { placeDock(); setDeckClosed(store.get(deckKey(), phoneLayout.matches)); });
$$('.rail-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('.aud-seg [data-aud]').forEach((b) => b.addEventListener('click', () => { S.audSub = b.dataset.aud; setTab('show:' + b.dataset.aud); }));
// Hide the panel to give the stage the room; any tab brings it back.
$('#panelToggle').onclick = () => {
  const closed = document.body.classList.toggle('panel-closed');
  $('#panelToggle').setAttribute('aria-expanded', !closed);
  $('#panelToggle').dataset.tip = closed ? 'Show the panel' : 'Hide the panel';
  if (closed) $$('.rail-btn').forEach((x) => { x.classList.remove('on'); x.removeAttribute('aria-current'); }); else setTab(S.tab);
};
$$('.look-seg [data-look]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.look)));
$('#helpTop').onclick = () => openDlg('helpDlg');
$('#settingsTop').onclick = () => openDlg('settingsDlg');
// Settings: one scrolling column of section cards; the sidebar jumps to a section and follows the scroll.
{
  const body = $('#settingsBody'), btns = $$('.set-nav-btn');
  const mark = (k) => btns.forEach((b) => { const on = b.dataset.set === k; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  btns.forEach((b) => b.addEventListener('click', () => { const sec = $('#set-' + b.dataset.set); body.scrollTo({ top: sec.offsetTop - body.offsetTop - 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); mark(b.dataset.set); }));
  body.addEventListener('scroll', () => {
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) return mark(btns[btns.length - 1].dataset.set);
    let cur = btns[0].dataset.set;
    for (const sec of body.querySelectorAll('.set-sec')) if (sec.offsetTop - body.offsetTop - 40 <= body.scrollTop) cur = sec.dataset.set;
    mark(cur);
  }, { passive: true });
  mark('general');
}
$('#liveTop').onclick = () => openDlg('liveDlg');

function sceneList() {
  return [...BUILTINS.map((b) => ({ ...b, kind: 'builtin' })), ...(isVertical() ? V_TEMPLATES : TEMPLATES).map((t) => ({ ...t, kind: 'template' })), ...savedLayouts().map((l) => ({ id: 'saved:' + l.name, name: l.name, kind: 'saved', saved: l }))];
}
function activeSceneId() {
  if (S.state.layout !== 'custom') return 'b-' + S.state.layout;
  return S.state.scene || '';
}
function applyScene(sc) {
  if (isHost()) guideMark('scened');
  if (sc.kind === 'builtin') return setStage({ layout: sc.layout, scene: sc.id, elements: sceneElements(sc.id, []) });
  if (sc.kind === 'template') return applyTemplate(sc);
  return loadLayout(sc.saved);
}
function scenePreview(sc) {
  const pv = document.createElement('span'); pv.className = 'sc-pv';
  let els = sc.els || sc.saved?.elements;
  if (sc.kind === 'builtin') {
    const area = { x: 32, y: 44, w: W - 64, h: H - 76 }; // same geometry the stage uses, then scaled to 0..1 (current orientation)
    const n = sc.layout === 'solo' ? 1 : sc.layout === 'grid' ? 4 : 3;
    els = layoutRects(n, sc.layout, area).map((r) => ({ type: 'slot', x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H }));
  }
  for (const e of drawOrder(els || [])) {
    if (e.hidden || ['captions', 'featured', 'ads'].includes(e.type)) continue;
    const i = document.createElement('i'); i.className = 'pv-' + e.type;
    if (e.type === 'shape') i.style.background = e.color;
    Object.assign(i.style, { left: e.x * 100 + '%', top: e.y * 100 + '%', width: e.w * 100 + '%', height: e.h * 100 + '%' });
    pv.append(i);
  }
  return pv;
}
function renderScenes() {
  const strip = $('#sceneStrip');
  if (!strip) return;
  const active = activeSceneId(), host = isHost();
  const chips = sceneList().map((sc, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'tile scene' + (sc.id === active ? ' on' : '') + (sc.kind === 'saved' ? ' saved' : '');
    b.disabled = !host; b.title = `${sc.name}${i < 9 ? ` (${i + 1})` : ''}`;
    b.setAttribute('aria-pressed', String(sc.id === active));
    b.tabIndex = -1; // one tab stop for the whole strip; arrow keys move within it (see sceneKeys)
    const nm = document.createElement('span'); nm.className = 'sc-name'; nm.textContent = sc.name;
    if (i < 9) { const k = document.createElement('kbd'); k.textContent = i + 1; nm.append(k); }
    b.append(scenePreview(sc), nm);
    b.onclick = () => applyScene(sc);
    return b;
  });
  const save = document.createElement('button'); save.type = 'button'; save.className = 'tile scene add'; save.disabled = !host;
  save.innerHTML = `<span class="sc-pv add-pv">${icon('plus')}</span><span class="sc-name">Save scene</span>`;
  save.onclick = () => { setTab('layouts'); $('#layoutName').focus(); };
  save.tabIndex = -1;
  const keep = strip.contains(document.activeElement) ? [...strip.children].indexOf(document.activeElement) : -1;
  replaceKids(strip, ...chips, save);
  const all = [...strip.children];
  const stop = all[keep] || all.find((b) => b.classList.contains('on')) || all[0];
  if (stop) stop.tabIndex = 0;
  // A re-render (any state update) must not throw a keyboard user out of the strip: put focus back where it was.
  if (keep >= 0 && all[keep]) all[keep].focus({ preventScroll: true });
  if (keep >= 0) stop?.focus();
}
/** Roving tabindex: Tab enters and leaves the scene strip in one step; arrows, Home and End move inside it. */
function sceneKeys(e) {
  const all = [...$('#sceneStrip').children];
  const i = all.indexOf(document.activeElement);
  if (i < 0) return;
  const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
  if (to == null) return;
  e.preventDefault();
  const next = all[Math.max(0, Math.min(all.length - 1, to))];
  all.forEach((b) => { b.tabIndex = b === next ? 0 : -1; });
  next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
$('#sceneStrip').addEventListener('keydown', sceneKeys);

// ---------------------------------------------------------------- participant-based scene layout suggestions & auto-grid
const sceneSuggestState = { suppressedKey: '', autoAppliedKey: '', lastCount: 1 };
function stageParticipantCount() {
  const ids = new Set(participants().map((p) => p.id));
  return (S.state.stage || []).filter((id) => ids.has(id)).length;
}
function sceneSlotCapacity() {
  const l = S.state.layout || 'split';
  if (l === 'solo') return 1;
  if (l !== 'custom') return MAX;
  return (S.state.elements || []).filter((e) => e.type === 'slot' && !e.hidden).length;
}
function recommendedSceneForStage() {
  if (!isHost() || !S.studio || editor.on || S.local.pres || hasMediaScene() || participants().some((p) => p.sharing)) return null;
  const n = stageParticipantCount();
  const l = S.state.layout || 'split';
  const cap = sceneSlotCapacity();
  if (n >= 3) {
    if (l === 'grid') return null;
    if (l === 'solo' || l === 'split' || (l === 'custom' && cap < n)) {
      return {
        key: `${n}|b-grid|${l}|${cap}`,
        n,
        scId: 'b-grid',
        autoEligible: true,
        text: l === 'custom' && cap < n ? `${n} on stage, ${cap} shown. Use Grid?` : `${n} on stage. Use Grid?`,
      };
    }
  } else if (n === 2) {
    if (l === 'solo' || (l === 'custom' && cap < 2)) {
      return { key: `2|b-split|${l}|${cap}`, n, scId: 'b-split', autoEligible: false, text: '2 on stage. Use Side by side?' };
    }
  } else if (n === 1) {
    if (l === 'grid' || l === 'split' || l === 'spotlight') {
      return { key: `1|b-solo|${l}|${cap}`, n, scId: 'b-solo', autoEligible: false, text: 'Just 1 on stage. Use Solo?' };
    }
  }
  return null;
}
function hideSceneSuggestion() {
  const box = $('#sceneSuggest');
  if (box) box.hidden = true;
}
function evaluateSceneSuggestion() {
  const n = stageParticipantCount();
  if (n !== sceneSuggestState.lastCount) {
    sceneSuggestState.lastCount = n;
    sceneSuggestState.suppressedKey = '';
    sceneSuggestState.autoAppliedKey = '';
  }
  const rec = recommendedSceneForStage();
  const box = $('#sceneSuggest');
  if (!rec) { hideSceneSuggestion(); return; }
  if (rec.autoEligible && autoGridOn() && sceneSuggestState.suppressedKey !== rec.key && sceneSuggestState.autoAppliedKey !== rec.key) {
    const target = sceneList().find((s) => s.id === rec.scId);
    if (target) {
      const prev = { layout: S.state.layout, scene: S.state.scene || '', elements: elementsCopy() };
      sceneSuggestState.autoAppliedKey = rec.key;
      hideSceneSuggestion();
      applyScene(target);
      toast(`Switched to Grid (${rec.n} people on stage)`, {
        action: ['Undo', () => { sceneSuggestState.suppressedKey = rec.key; setStage(prev); }],
        ms: 6000,
      });
      return;
    }
  }
  if (!box || sceneSuggestState.suppressedKey === rec.key) { hideSceneSuggestion(); return; }
  box.dataset.scId = rec.scId;
  box.dataset.key = rec.key;
  $('#sceneSuggestText').textContent = rec.text;
  $('#sceneSuggestAuto').hidden = !(rec.n >= 3 && !autoGridOn());
  box.hidden = false;
}
$('#sceneSuggestApply').onclick = () => {
  const box = $('#sceneSuggest'), sc = sceneList().find((s) => s.id === box?.dataset.scId);
  if (!sc) return;
  sceneSuggestState.suppressedKey = box.dataset.key || '';
  hideSceneSuggestion();
  applyScene(sc);
};
$('#sceneSuggestAuto').onclick = () => {
  if (!isHost()) return;
  setStreamPref({ autoGrid: true }); setStage({ autoGrid: true });
  toast('Auto-grid enabled for 3+ speakers.');
};
$('#sceneSuggestDismiss').onclick = () => {
  const box = $('#sceneSuggest');
  sceneSuggestState.suppressedKey = box?.dataset.key || '';
  hideSceneSuggestion();
};

function showBanner() {
  const text = $('#bannerText').value.trim();
  if (!text) return toast('Write some banner text first.');
  setStage({ banner: { id: Math.random().toString(36).slice(2, 8), text, sub: $('#bannerSub').value.trim() } });
}
$('#bannerShow').onclick = showBanner;
$('#bannerHide').onclick = () => setStage({ banner: null });
$('#bannerSave').onclick = () => {
  const text = $('#bannerText').value.trim(); if (!text) return;
  const list = store.get('presets', DEFAULT_PRESETS);
  if (!list.includes(text)) { list.unshift(text); store.set('presets', list.slice(0, 12)); }
  renderPresets(); toast('Preset saved.');
};
$('#tickerShow').onclick = () => { const v = $('#tickerText').value.trim(); if (!v) return toast('Write some ticker text first.'); setStage({ ticker: v }); };
$('#tickerHide').onclick = () => setStage({ ticker: '' });

$$('#swatches button').forEach((b) => b.addEventListener('click', () => setStage({ brand: { color: b.dataset.color } })));
let colorT; $('#colorPick').addEventListener('input', (e) => { clearTimeout(colorT); colorT = setTimeout(() => setStage({ brand: { color: e.target.value } }), 120); });
$$('#bgs button').forEach((b) => b.addEventListener('click', () => setStage({ brand: { bg: b.dataset.bg } })));
$('#namesChk').onchange = (e) => setStage({ brand: { names: e.target.checked } });
$('#titleInput').addEventListener('change', (e) => setStage({ title: e.target.value.trim().slice(0, 60) }));
// The show title in the header is editable in place by the host: click, type, Enter.
function editTitle() {
  if (!isHost() || !S.studio) return;
  const t = $('#studioTitle');
  t.contentEditable = 'plaintext-only'; t.focus();
  getSelection()?.selectAllChildren(t);
}
$('#studioTitle').addEventListener('click', editTitle);
$('#studioTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } if (e.key === 'Escape') { e.target.textContent = S.state.title || DEFAULT_TITLE; e.target.blur(); } });
$('#studioTitle').addEventListener('blur', (e) => {
  e.target.contentEditable = 'false';
  const v = e.target.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (isHost() && S.studio && v && v !== (S.state.title || DEFAULT_TITLE)) setStage({ title: v });
  else e.target.textContent = S.state.title || DEFAULT_TITLE;
});
// the phone layout keeps the composer above the fixed dock, whatever the dock's height (the guide adds a row)
new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', $('.dock').offsetHeight + 'px')).observe($('.dock'));

// Appearance: dark by default; light or follow the OS on request.
function applyTheme(t) {
  store.set('theme', t);
  if (t !== 'light') t = 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark';
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0d1117' : '#ffffff');
  $$('#themeSeg button').forEach((b) => { const on = b.dataset.themeOpt === t; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  if (typeof syncThemeSegs === 'function') syncThemeSegs(t);
  applyAdaptiveAccent(S.state?.brand?.color);
}
$$('#themeSeg button').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeOpt)));
applyTheme(store.get('theme', 'dark'));

// Settings
$('#nameInput').value = S.name;
let nameT;
$('#nameInput').addEventListener('input', (e) => {
  S.name = e.target.value.trim(); store.set('name', S.name); $('#enterName').value = S.name;
  profileSoon({ name: S.name });
  clearTimeout(nameT); nameT = setTimeout(() => { sendMeta({ name: S.name || 'Guest' }); renderCrew(); }, 400);
});
$('#startMic').checked = S.prefs.startMic; $('#startCam').checked = S.prefs.startCam;
$('#startMic').onchange = (e) => store.set('startMic', (S.prefs.startMic = e.target.checked));
$('#startCam').onchange = (e) => store.set('startCam', (S.prefs.startCam = e.target.checked));
$('#camSelect').onchange = async (e) => {
  store.set('camId', (S.prefs.camId = e.target.value));
  if (S.local.cam) { stopCam(); await startCam(); syncMedia(); }
};
$('#micSelect').onchange = async (e) => {
  store.set('micId', (S.prefs.micId = e.target.value));
  if (S.local.audio) { stopMic(); await startMic(); syncMedia(); }
};
$('#qualitySelect').value = S.prefs.quality;
$('#qualitySelect').onchange = async (e) => {
  store.set('quality', (S.prefs.quality = e.target.value));
  if (S.local.cam) await S.local.cam.applyConstraints(camConstraints()).catch(async () => { stopCam(); await startCam(); syncMedia(); });
};
// Microphone
function saveAudioFx() { store.set('audioFx', S.audioFx); }
function renderAudioFxUI() {
  for (const [id, key] of [['echoChk', 'echo'], ['nsChk', 'ns'], ['agcChk', 'agc']]) $('#' + id).checked = !!S.audioFx[key];
  $('#aiNoiseChk').checked = !!S.audioFx.ai;
  $('#micGain').value = S.audioFx.gain;
  $('#micGainVal').textContent = Math.round(S.audioFx.gain * 100) + '%';
  $('#duckChk').checked = S.audioFx.duck !== false;
  const lvl = Math.max(0.05, Math.min(0.75, Number(S.audioFx.duckLevel) || 0.2));
  $('#duckLevel').value = String(lvl);
  $('#duckLevelVal').textContent = Math.round(lvl * 100) + '%';
  const rel = S.audioFx.duckRelease || 'normal';
  $$('#duckReleaseSeg button').forEach((b) => { const on = b.dataset.duckRel === rel; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  updateDucking(true);
  $('#autoMuteChk').checked = S.audioFx.autoMute !== false;
  const amSec = Math.max(10, Math.min(300, Number(S.audioFx.autoMuteSec) || 30));
  $('#autoMuteSec').value = String(amSec);
  $('#autoMuteSecVal').textContent = fmtSec(amSec);
  renderAutoMuteIndicators();
}
for (const [id, key] of [['echoChk', 'echo'], ['nsChk', 'ns'], ['agcChk', 'agc']]) {
  $('#' + id).onchange = async (e) => { S.audioFx[key] = e.target.checked; saveAudioFx(); if (S.local.audio) { stopMic(); await startMic(); syncMedia(); } };
}
$('#aiNoiseChk').onchange = async (e) => {
  S.audioFx.ai = e.target.checked; saveAudioFx();
  if (S.local.audio) { await applyAudioFx(); syncMedia(); }
  toast(e.target.checked ? 'AI noise removal on. Keyboards, fans and traffic fade out.' : 'AI noise removal off.');
};
$('#micGain').oninput = async (e) => {
  S.audioFx.gain = Number(e.target.value); $('#micGainVal').textContent = Math.round(S.audioFx.gain * 100) + '%'; saveAudioFx();
  if (afx) afx.setGain(S.audioFx.gain);
  else if (S.local.audio && Math.abs(S.audioFx.gain - 1) > 0.01) { await applyAudioFx(); syncMedia(); }
};
$('#duckChk').onchange = (e) => {
  S.audioFx.duck = e.target.checked; saveAudioFx(); updateDucking(true);
  toast(e.target.checked ? 'Auto-ducking on. Music and media dip when anyone speaks.' : 'Auto-ducking off.');
};
$('#duckLevel').oninput = (e) => {
  S.audioFx.duckLevel = Number(e.target.value);
  $('#duckLevelVal').textContent = Math.round(S.audioFx.duckLevel * 100) + '%';
  saveAudioFx(); updateDucking(true);
};
$$('#duckReleaseSeg button').forEach((b) => b.addEventListener('click', () => {
  S.audioFx.duckRelease = b.dataset.duckRel; saveAudioFx(); renderAudioFxUI();
}));
$('#autoMuteChk').onchange = (e) => {
  S.audioFx.autoMute = e.target.checked; saveAudioFx(); resetAutoMuteTimer(); renderAutoMuteIndicators();
  toast(e.target.checked ? `Auto-mute on (${fmtSec(S.audioFx.autoMuteSec || 30)} of silence).` : 'Personal auto-mute off.');
};
$('#autoMuteSec').oninput = (e) => {
  S.audioFx.autoMuteSec = Number(e.target.value);
  $('#autoMuteSecVal').textContent = fmtSec(S.audioFx.autoMuteSec);
  saveAudioFx(); resetAutoMuteTimer(); renderAutoMuteIndicators();
};
renderAudioFxUI();
// Camera
function saveVideoFx() { store.set('videoFx', S.videoFx); }
$('#fpsSelect').value = String(S.videoFx.fps);
$('#fpsSelect').onchange = async (e) => { S.videoFx.fps = Number(e.target.value); saveVideoFx(); if (S.local.camRaw) await S.local.camRaw.applyConstraints(camConstraints()).catch(() => {}); };
$('#mirrorChk').checked = !!S.videoFx.mirror;
$('#mirrorChk').onchange = (e) => { S.videoFx.mirror = e.target.checked; saveVideoFx(); syncMedia(); renderPreview(); };
for (const [id, key] of [['fxBright', 'bright'], ['fxContrast', 'contrast'], ['fxSat', 'sat']]) {
  $('#' + id).value = S.videoFx[key];
  $('#' + id).oninput = async (e) => { S.videoFx[key] = Number(e.target.value); saveVideoFx(); await applyVideoFx(); syncMedia(); };
}
$('#fxReset').onclick = async () => {
  Object.assign(S.videoFx, { bright: 0, contrast: 1, sat: 1 }); saveVideoFx();
  $('#fxBright').value = 0; $('#fxContrast').value = 1; $('#fxSat').value = 1;
  await applyVideoFx(); syncMedia();
};
// Background
function renderBgFx() {
  $$('#bgFxSeg button').forEach((b) => { const on = b.dataset.fx === S.videoFx.effect; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  const hasImg = !!store.get('fxBg', '');
  $('#bgFxImgRow').hidden = !['image', 'green'].includes(S.videoFx.effect);
  $('#bgFxKeyRow').hidden = S.videoFx.effect !== 'green';
  $('#bgFxEdgeRow').hidden = !['blur', 'image'].includes(S.videoFx.effect);
  $('#bgFxBlurRow').hidden = !(S.videoFx.effect === 'blur' || (S.videoFx.effect === 'green' && !hasImg));
  $('#bgFxClear').hidden = !hasImg;
  $('#bgFxThumb').hidden = !hasImg; if (hasImg) $('#bgFxThumb').src = store.get('fxBg', '');
  $('#bgFxNote').textContent = {
    none: 'Your real background.',
    blur: 'Softens everything behind you. Runs on this device; the first use downloads a small model.',
    image: hasImg ? 'Replaces your background with the picture, no green screen needed.' : 'Choose a picture to put behind you.',
    green: 'For a physical green or blue screen. Pick the screen colour and adjust until the edges look clean.',
  }[S.videoFx.effect];
}
// Green screen with no screen behind the person does nothing; notice and say so instead of looking broken.
let screenTimer = 0;
function watchScreen() {
  clearInterval(screenTimer); $('#bgFxNoScreen').hidden = true;
  if (S.videoFx.effect !== 'green') return;
  let tries = 0, autoTried = false;
  screenTimer = setInterval(async () => {
    if (S.videoFx.effect !== 'green' || !vfx?.coverage) { if (++tries > 20) clearInterval(screenTimer); return; }
    let cov = vfx.coverage(S.videoFx.key);
    if (cov < 0) return;
    if (cov < 0.3 && !autoTried) { // maybe the colour is just off: try the one at the edges of the picture
      autoTried = true;
      const hex = vfx.autoKey();
      if (hex && vfx.coverage(hex) >= 0.3) { S.videoFx.key = hex; $('#keyColor').value = hex; saveVideoFx(); await applyVideoFx(); cov = vfx.coverage(hex); }
    }
    $('#bgFxNoScreen').hidden = cov >= 0.3;
    if (++tries > 3) clearInterval(screenTimer);
  }, 700);
}
$$('#bgFxNoScreen [data-fx-switch]').forEach((b) => b.addEventListener('click', () => $(`#bgFxSeg button[data-fx="${b.dataset.fxSwitch}"]`).click()));
$$('#bgFxSeg button').forEach((b) => b.addEventListener('click', async () => {
  S.videoFx.effect = b.dataset.fx; saveVideoFx(); renderBgFx();
  if (S.local.camRaw) { await applyVideoFx(); syncMedia(); }
  else if (b.dataset.fx !== 'none') toast('Turn your camera on to see the effect.');
  watchScreen();
}));
$('#bgFxPick').onclick = () => $('#bgFxFile').click();
$('#bgFxFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { store.set('fxBg', await compressImage(f)); renderBgFx(); await applyVideoFx(); syncMedia(); }
  catch (err) { toast(err.message, { err: true }); }
};
$('#bgFxClear').onclick = async () => { store.set('fxBg', ''); renderBgFx(); await applyVideoFx(); syncMedia(); };
$('#keyColor').value = S.videoFx.key;
$('#keyColor').oninput = async (e) => { S.videoFx.key = e.target.value; saveVideoFx(); await applyVideoFx(); };
$('#keyTol').value = S.videoFx.tol;
$('#keyTol').oninput = async (e) => { S.videoFx.tol = Number(e.target.value); saveVideoFx(); await applyVideoFx(); };
for (const [id, k] of [['#keySpill', 'spill'], ['#fxEdge', 'edge'], ['#fxBlur', 'blur']]) {
  $(id).value = S.videoFx[k];
  $(id).oninput = async (e) => { S.videoFx[k] = Number(e.target.value); saveVideoFx(); await applyVideoFx(); };
}
$('#keyAuto').onclick = async () => {
  if (!vfx?.autoKey) return toast('Turn your camera on with Green screen selected first.', { err: true });
  const hex = vfx.autoKey();
  if (!hex) return toast('Couldn’t find a screen colour at the edges of the picture. Pick it by hand.', { err: true });
  S.videoFx.key = hex; $('#keyColor').value = hex; saveVideoFx(); await applyVideoFx();
  toast(`Screen colour set to ${hex}.`);
};
renderBgFx();
for (const k of ['turnUrl', 'turnUser', 'turnPass']) {
  $('#' + k).value = sess.get(k, '');
  $('#' + k).addEventListener('change', (e) => { sess.set(k, e.target.value.trim()); if (S.studio) toast('TURN settings apply the next time you enter a studio.'); });
}

// Dock
$('#micBtn').onclick = () => setMic(!(S.local.micOn && S.local.audio));
$('#camBtn').onclick = () => setCam(!S.local.camOn);
$('#handBtn').onclick = () => {
  if (!S.studio || isHost()) return;
  S.local.hand = !S.local.hand;
  sendMeta({ hand: S.local.hand });
  renderDock(); renderCrew();
  toast(S.local.hand ? 'Hand raised. The host has been notified.' : 'Hand lowered.');
};
$('#recBtn').onclick = toggleRecord;
$('#leaveBtn').onclick = () => {
  const lose = [S.live && 'end the live stream', S.rec && 'stop the recording (you can still save it)', isHost() && S.peers.size && `hand the studio to ${S.peers.size === 1 ? 'your guest' : 'a guest'}`].filter(Boolean);
  if (!lose.length) return leave('left');
  $('#leaveWhat').textContent = 'Leaving will ' + lose.join(', ') + '.';
  $('#leaveDlg').showModal();
};
$('#leaveGo').onclick = () => { $('#leaveDlg').close(); leave('left'); };

function leave(why) {
  if (!S.studio) return;
  if (S.rec) S.rec.recorder.stop();
  if (S.live) stopLive();
  beaconLeave(why);
  closeAllViewers(); S.supers.clear();
  outbox = [];
  teardownPeers();
  stopPresentation(); stopBgMusic(); stopCam(); stopMic();
  sceneFade.active = false;
  S.studio = null; S.id = null; S.tok = null; S.host = null; S.short = ""; S.shortInvite = "";
  S.state = localState();
  S.local.camOn = S.prefs.startCam; S.local.micOn = S.prefs.startMic; S.local.hand = false; S.local.autoMuted = false;
  autoMuteState.peerLastSpeech.clear(); autoMuteState.peerSpeechMs.clear(); autoMuteState.peerMutedAt.clear(); resetAutoMuteTimer();
  $$('#msgs > *').forEach((n) => n.remove());
  $$('.crew-card').forEach((n) => n.remove());
  S.feed = []; seenFeed.clear(); editor.sel = null; if (editor.on) setEditing(false);
  sceneSuggestState.suppressedKey = ''; sceneSuggestState.autoAppliedKey = ''; sceneSuggestState.lastCount = 1; hideSceneSuggestion();
  rumble.url = ''; clearTimeout(rumble.timer); stopYouTube();
  S.local.avatarId = ''; S.local.offbgId = ''; S.prePres = null; cap.lines.clear(); S.lobby = []; speechHub.ptt = false;
  history.replaceState(null, '', '/');
  setPhase('offline');
  renderChatMood();
  toast('You left the studio.');
}
addEventListener('beforeunload', (e) => { if (S.studio && (S.rec || S.live || S.peers.size)) { e.preventDefault(); e.returnValue = ''; } });

// Fullscreen stage

// ---------------------------------------------------------------- present any file: drop it on the stage or click the empty space
async function presentImage(file) {
  const img = await loadImg(URL.createObjectURL(file));
  const c = presCanvas(), cg = c.getContext('2d');
  const track = c.captureStream(10).getVideoTracks()[0];
  track.contentHint = 'detail';
  startPresentation({ kind: 'image', name: file.name, track, source: c, draw() { fitDraw(cg, img, img.naturalWidth, img.naturalHeight, '#05070d'); }, stop() { track.stop(); URL.revokeObjectURL(img.src); } });
}
function presentFile(file) {
  if (!file) return;
  if (!S.studio) return toast('Enter a studio first, then drop your file on the stage.');
  const t = typeof file.type === 'string' ? file.type : '', n = typeof file.name === 'string' ? file.name.toLowerCase() : '';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return presentPDF(file);
  if (t.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/.test(n)) return presentVideo(file);
  if (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(n)) return playBgMusicFile(file);
  if (t.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(n)) return presentImage(file).catch((e) => toast('Image: ' + e.message, { err: true }));
  toast('Drop a PDF, a video (MP4, WebM, MOV), an audio track or an image.', { err: true });
}
$('#imageFile').onchange = (e) => { presentFile(e.target.files[0]); e.target.value = ''; };
$('#anyFile').onchange = (e) => { presentFile(e.target.files[0]); e.target.value = ''; };
(() => {
  const st = $('#stage');
  let depth = 0;
  st.addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); depth++; st.classList.add('dropping'); });
  st.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  st.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; st.classList.remove('dropping'); } });
  st.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; st.classList.remove('dropping');
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (e.shiftKey && isHost()) return libAddFiles(e.dataTransfer.files);
    presentFile(f);
  });
  // Click the empty presentation space to choose a file.
  const mediaAt = (ev) => {
    if (editor.on || !S.studio) return null;
    const r = st.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    if (S.state.layout !== 'custom') return null;
    return (S.state.elements || []).find((e) => e.type === 'media' && x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h) || null;
  };
  st.addEventListener('mousemove', (ev) => { st.classList.toggle('can-drop', !!mediaAt(ev) && !presenterOf()); });
  st.addEventListener('click', (ev) => { if (ev.target.closest('.pres-bar, .cmd-bar, .cmd-toggle')) return; if (mediaAt(ev) && !presenterOf()) $('#anyFile').click(); });
})();

// ---------------------------------------------------------------- glass / solid panels drawn on the stage
function drawPanel(x, y, w, h, r = 16) {
  const b = S.state.brand;
  g.save(); rr(x, y, w, h, r); g.clip();
  if (b.panel === 'solid') { g.fillStyle = b.panelColor || '#0f172a'; g.fillRect(x, y, w, h); }
  else {
    if ('filter' in g) { g.filter = 'blur(18px) saturate(140%)'; g.drawImage(canvas, x, y, w, h, x, y, w, h); g.filter = 'none'; }
    g.fillStyle = 'rgba(12,20,44,.5)'; g.fillRect(x, y, w, h);
    const hl = g.createLinearGradient(x, y, x, y + Math.min(h, 140)); hl.addColorStop(0, 'rgba(255,255,255,.12)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.fillRect(x, y, w, h);
  }
  g.restore();
  g.save(); g.strokeStyle = b.panel === 'solid' ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.2)'; g.lineWidth = 1; rr(x + .5, y + .5, w - 1, h - 1, r); g.stroke(); g.restore();
}

// ---------------------------------------------------------------- audio-only tile: custom background, smooth voice rings
const lvlSmooth = new Map();
const blurCache = new WeakMap();
function blurredOf(img) {
  let c = blurCache.get(img);
  if (c) return c;
  c = document.createElement('canvas'); c.width = 320; c.height = 180;
  const cg = c.getContext('2d'); cg.filter = 'blur(12px)';
  const k = Math.max(340 / img.naturalWidth, 200 / img.naturalHeight);
  cg.drawImage(img, (320 - img.naturalWidth * k) / 2, (180 - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
  blurCache.set(img, c);
  return c;
}
function drawAudioTile(p, x, y, w, h, t) {
  const brand = S.state.brand;
  const prev = lvlSmooth.get(p.id) || 0, target = p.mic ? Math.min(1, p.level * 7) : 0;
  const lv = prev + (target - prev) * (target > prev ? .3 : .06);
  lvlSmooth.set(p.id, lv);
  const bgImg = assetImg(p.offbg), av = assetImg(p.avatar);
  if (bgImg) cover(g, bgImg, x, y, w, h);
  else if (av) g.drawImage(blurredOf(av), x, y, w, h);
  else {
    const gr = g.createRadialGradient(x + w * .3, y + h * .2, 10, x + w / 2, y + h / 2, Math.max(w, h) * .8);
    gr.addColorStop(0, hexA(brand.color, .55)); gr.addColorStop(.55, mixHex(brand.color, '#070a14', 0.78)); gr.addColorStop(1, mixHex(brand.color, '#04060c', 0.9));
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  }
  g.fillStyle = brand.panel === 'solid' ? hexA(brand.panelColor || '#0f172a', .55) : 'rgba(8,14,30,.32)'; g.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2, rad = Math.min(w, h) * .17;
  // soft glow that breathes with the voice
  const glowR = rad * (1.7 + lv * 1.1);
  const glow = g.createRadialGradient(cx, cy, rad * .7, cx, cy, glowR);
  glow.addColorStop(0, hexA(brand.color, .22 + lv * .4)); glow.addColorStop(1, hexA(brand.color, 0));
  g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, glowR, 0, Math.PI * 2); g.fill();
  // three rings that travel outward; louder voice = wider, brighter rings
  for (let i = 0; i < 3; i++) {
    const ph = ((t / 2200) + i / 3) % 1;
    const rr2 = rad * (1.08 + ph * (0.45 + lv * 1.25));
    g.strokeStyle = hexA('#ffffff', (1 - ph) * (0.06 + lv * .35)); g.lineWidth = 1.5 + lv * 3;
    g.beginPath(); g.arc(cx, cy, rr2, 0, Math.PI * 2); g.stroke();
  }
  const r2 = rad * (1 + lv * .07);
  g.save(); g.beginPath(); g.arc(cx, cy, r2, 0, Math.PI * 2); g.clip();
  if (av) cover(g, av, cx - r2, cy - r2, r2 * 2, r2 * 2);
  else {
    const dg = g.createLinearGradient(cx - r2, cy - r2, cx + r2, cy + r2); dg.addColorStop(0, brand.color); dg.addColorStop(1, hexA(brand.color, .65));
    g.fillStyle = dg; g.fillRect(cx - r2, cy - r2, r2 * 2, r2 * 2);
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(r2 * .78)}px ${stageFont()}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(initials(p.name), cx, cy + 2);
  }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r2, 0, Math.PI * 2); g.stroke();
  // a small live voice meter under the photo
  const bars = 5, bw = Math.max(3, rad * .07), gap = bw * .9, total = bars * bw + (bars - 1) * gap;
  for (let i = 0; i < bars; i++) {
    const wob = .35 + .65 * Math.abs(Math.sin(t / 180 + i * 1.3));
    const bh = Math.max(bw, rad * .55 * (p.mic ? (.15 + lv * wob) : .1));
    g.fillStyle = p.mic ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.3)';
    rr(cx - total / 2 + i * (bw + gap), cy + r2 + rad * .55 - bh / 2, bw, bh, bw / 2); g.fill();
  }
}

// ---------------------------------------------------------------- sponsor ads and the call-in card
function drawAds(r) {
  const a = S.state.ads;
  if (!a?.on || !a.items?.length) return;
  const per = (a.every || 12) * 1000, now = Date.now();
  const idx = Math.floor(now / per) % a.items.length, into = now % per;
  const img = assetImg(a.items[idx]);
  if (!img) return;
  const alpha = Math.min(1, into / 450, (per - into) / 450);
  const k = Math.min(r.w / img.naturalWidth, r.h / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
  const cx = r.x + r.w / 2, x = cx > W * .6 ? r.x + r.w - w : cx < W * .4 ? r.x : cx - w / 2, y = r.y + r.h - h;
  g.save(); g.globalAlpha = alpha;
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 20; g.shadowOffsetY = 6;
  rr(x, y, w, h, 10); g.clip(); g.shadowColor = 'transparent';
  g.drawImage(img, x, y, w, h);
  g.restore();
}
function drawQr(url, x, y, size) {
  const q = url ? qrFor(url) : null;
  if (!q) { g.fillStyle = '#e8edf6'; rr(x, y, size, size, 8); g.fill(); return; }
  const n = q.getModuleCount(), cell = Math.max(1, Math.floor(size / n)), real = cell * n, ox = x + Math.floor((size - real) / 2), oy = y + Math.floor((size - real) / 2);
  g.fillStyle = '#0b1020';
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (q.isDark(i, j)) g.fillRect(ox + j * cell, oy + i * cell, cell, cell);
}
function drawCallinEl(e) {
  const r = px(e), pad = 16;
  drawPanel(r.x, r.y, r.w, r.h, 16);
  const qs = r.h - pad * 2;
  g.fillStyle = '#ffffff'; rr(r.x + pad, r.y + pad, qs, qs, 10); g.fill();
  drawQr(e.url, r.x + pad + 8, r.y + pad + 8, qs - 16);
  const tx = r.x + pad * 2 + qs, tw = r.w - (tx - r.x) - pad;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#f43f5e'; g.beginPath(); g.arc(tx + 6, r.y + pad + 10, 5, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.8)'; g.font = '700 13px Inter, sans-serif'; g.fillText('LIVE CALL-IN', tx + 18, r.y + pad + 15);
  g.fillStyle = '#ffffff'; g.font = `800 24px ${stageFont()}`;
  wrapLines(e.label || 'Call in live', tw, 2).forEach((l, i) => g.fillText(l, tx, r.y + pad + 50 + i * 28));
  g.fillStyle = 'rgba(230,238,255,.85)'; g.font = '600 15px Inter, sans-serif';
  if (e.phone) g.fillText(wrapLines(e.phone, tw, 1)[0], tx, r.y + r.h - pad - 26);
  g.fillText(wrapLines((e.url || '').replace(/^https?:\/\//, ''), tw, 1)[0] || '', tx, r.y + r.h - pad - 4);
}

// ---------------------------------------------------------------- deck: scenes and people swap under a fixed stage
S.deck = 'scenes';
function deckLayers() { return isHost() ? ['scenes', 'people', ...(S.lobby?.length ? ['lobby'] : [])] : ['people']; }
function setDeck(name) {
  const layers = deckLayers();
  if (!layers.includes(name)) name = layers[0];
  const i = layers.indexOf(name);
  S.deck = name;
  $$('.deck-layer').forEach((el) => {
    const j = layers.indexOf(el.dataset.layer);
    el.classList.toggle('on', j === i);
    el.classList.toggle('above', j >= 0 && j < i);
    el.classList.toggle('below', j < 0 || j > i);
    el.setAttribute('aria-hidden', String(j !== i));
    el.inert = j !== i;
  });
  $$('.deck-tabs button').forEach((b) => { const on = b.dataset.deck === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
}
$$('.deck-tabs button').forEach((b) => b.addEventListener('click', () => { setDeck(b.dataset.deck); openDeck(); }));
function setDeckClosed(closed) {
  document.body.classList.toggle('deck-closed', closed);
  $('#deckToggle').setAttribute('aria-expanded', String(!closed));
  $('#deckToggle').setAttribute('aria-label', closed ? 'Show scenes and people' : 'Hide scenes and people');
  $('#deckToggle').dataset.tip = closed ? 'Show' : 'Hide';
  store.set(deckKey(), closed);
}
function deckKey() { return matchMedia('(max-width: 720px)').matches ? 'deckClosedPhone' : 'deckClosed'; }
function openDeck() { if (document.body.classList.contains('deck-closed')) setDeckClosed(false); }
$('#deckToggle').onclick = () => setDeckClosed(!document.body.classList.contains('deck-closed'));
setDeckClosed(store.get(deckKey(), matchMedia('(max-width: 720px)').matches));
(() => {
  let lock = 0;
  const onWheel = (e) => {
    if (innerWidth <= 900) return;
    if (e.target.closest('.side, .rail, dialog, .pres-bar, .cmd-bar')) return;
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX) || Math.abs(e.deltaY) < 8) return;
    e.preventDefault();
    if (Date.now() < lock) return;
    const layers = deckLayers(), i = layers.indexOf(S.deck);
    const next = layers[Math.max(0, Math.min(layers.length - 1, i + (e.deltaY > 0 ? 1 : -1)))];
    if (next !== S.deck) { setDeck(next); lock = Date.now() + 520; }
  };
  $('.studio').addEventListener('wheel', onWheel, { passive: false });
  let ty = null;
  $('#deck').addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; }, { passive: true });
  $('#deck').addEventListener('touchend', (e) => {
    if (ty == null) return;
    const dy = e.changedTouches[0].clientY - ty; ty = null;
    if (Math.abs(dy) < 40) return;
    const layers = deckLayers(), i = layers.indexOf(S.deck);
    setDeck(layers[Math.max(0, Math.min(layers.length - 1, i + (dy < 0 ? 1 : -1)))]);
  }, { passive: true });
})();
$('#lockSwitch').onchange = (e) => { if (!isHost()) return; setStage({ locked: e.target.checked }); toast(e.target.checked ? 'Studio locked. New guests knock and wait for you.' : 'Studio unlocked.'); };
function renderDeck() {
  const host = isHost();
  $('#lockSwitch').checked = !!S.state.locked; $('#lockSwitch').disabled = !host || !S.studio;
  $('#lockWrap').hidden = !host || !S.studio;
  const n = S.lobby?.length || 0;
  $('#lobbyTab').hidden = !host || !n;
  $('#lobbyCount').textContent = n;
  if (!deckLayers().includes(S.deck)) setDeck(deckLayers()[0]); else setDeck(S.deck);
}

// ---------------------------------------------------------------- waiting room + call-in line
S.lobby = [];
function renderLobby() {
  const ul = $('#lobbyList');
  replaceKids(ul, ...(S.lobby || []).map((w) => {
    const li = document.createElement('li'); li.className = 'lobby-card';
    const av = document.createElement('span'); av.className = 'lobby-av'; av.textContent = initials(w.name);
    const info = document.createElement('div'); info.className = 'lobby-info';
    const b = document.createElement('b'); b.textContent = w.name;
    const s2 = document.createElement('span'); s2.textContent = (w.callin ? 'Calling in' : 'Wants to join') + (w.note ? ` · ${w.note}` : '');
    info.append(b, s2);
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn primary sm'; ok.textContent = 'Let in';
    ok.onclick = () => {
      wsSend({ type: 'admit', id: w.id, accept: true });
      // A raised hand from the watch page goes on the show, not backstage (peer-joined matches the lobby id).
      if (/^Raised hand/.test(w.note || '')) (S.autoStage ||= new Set()).add(w.id);
    };
    if (/^Raised hand/.test(w.note || '')) ok.textContent = 'Bring on';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost sm'; no.textContent = 'Decline';
    no.onclick = () => wsSend({ type: 'admit', id: w.id, accept: false });
    li.append(av, info, ok, no);
    return li;
  }));
  renderDeck();
}
async function refreshLobby() { if (!S.studio || !isHost()) return; try { S.lobby = (await api('lobbyList', creds())).lobby; renderLobby(); } catch {} }
setInterval(() => { if (S.studio && isHost() && S.lobby?.length) refreshLobby(); }, 10000);
// The public call-in line is gone: viewers raise a hand on the watch page and record a voice question instead.
// The /c/ link stays only as the private way in for a "Play with me" player the host calls up.
// Callers: knock and wait
async function startKnock(code, callin) {
  S.knockCode = code;
  $('#enterFields').hidden = true; $('#knockWait').hidden = false;
  $('#knockWaitH').textContent = 'Waiting for the host';
  $('#knockMsg').textContent = callin ? 'You’re in the call-in queue. The host will bring you in shortly.' : 'This studio is locked. The host has been told you’re here.';
  try {
    const r = await api('knock', { studio: code, dev: deviceId(), name: S.name || 'Caller', callin: !!callin });
    S.knock = { code, ...r };
    for (;;) {
      await new Promise((res) => setTimeout(res, 2000));
      if (!S.knock || S.knock.code !== code) return;
      const st = await api('knockPoll', { studio: code, id: r.id, tok: r.tok });
      if (st.status === 'admitted') { S.knock = null; $('#knockMsg').textContent = 'You’re in. Connecting…'; await join(code, { pass: st.pass, callin: !!callin }); return; }
      if (st.status === 'declined') { S.knock = null; $('#knockWaitH').textContent = 'Not this time'; $('#knockMsg').textContent = 'The host couldn’t take you right now.'; return; }
    }
  } catch (e) { $('#knockMsg').textContent = e.message; S.knock = null; }
}
// A guest who arrives before the host: wait in the green room and come in as soon as the studio opens.
async function waitForHost(code, msg) {
  const gen = (S.waitHost = (S.waitHost || 0) + 1);
  $('#enterFields').hidden = true; $('#knockWait').hidden = false;
  $('#knockWaitH').textContent = 'Waiting for the host';
  $('#knockMsg').textContent = msg || 'The host hasn’t opened this studio yet. We’ll bring you in as soon as they do.';
  for (;;) {
    await new Promise((res) => setTimeout(res, 4000));
    if (S.waitHost !== gen || !$('#enterDlg').open || S.studio) return;
    try { await join(code, { noWait: true }); if (S.studio) return; }
    catch (e) { if (e.status !== 404) { $('#knockMsg').textContent = e.message; return; } }
  }
}
$('#knockCancel').onclick = () => {
  if (S.knock) api('knockCancel', { studio: S.knock.code, id: S.knock.id, tok: S.knock.tok }).catch(() => {});
  S.knock = null; S.waitHost = (S.waitHost || 0) + 1; $('#knockWait').hidden = true; $('#enterFields').hidden = false;
};
function kickedOut(msg) { leave(); toast(msg || 'The host removed you from this studio.', { err: true, ms: 6000 }); }

// ---------------------------------------------------------------- camera-off background (per person)
function renderOffBg() {
  const d = store.get('offBg', '');
  $('#offBgThumb').hidden = !d; if (d) $('#offBgThumb').src = d;
  $('#offBgClear').hidden = !d;
}
$('#offBgPick').onclick = () => $('#offBgFile').click();
$('#offBgFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { store.set('offBg', await compressImage(f)); renderOffBg(); if (S.studio) uploadOffBg(true); toast('Shown behind your photo when your camera is off.'); }
  catch (err) { toast(err.message, { err: true }); }
};
$('#offBgClear').onclick = () => { store.set('offBg', ''); S.local.offbgId = ''; renderOffBg(); if (S.studio) sendMeta({ offbg: '' }); };
async function uploadOffBg(force) {
  const d = store.get('offBg', '');
  if (!d || !S.studio || (S.local.offbgId && !force)) return;
  try { S.local.offbgId = await storeAsset(d); sendMeta({ offbg: S.local.offbgId }); } catch {}
}

// ---------------------------------------------------------------- brand: panels, logo, sponsor ads
$$('#panelSeg button').forEach((b) => b.addEventListener('click', () => { if (isHost()) brandPref({ panel: b.dataset.panel }); }));
$('#panelColor').oninput = (e) => { if (isHost()) brandPref({ panelColor: e.target.value }); };
$('#adsSwitch').onchange = (e) => { if (!isHost()) return; setStage({ ads: { ...S.state.ads, on: e.target.checked } }); };
$('#adEvery').onchange = (e) => setStage({ ads: { ...S.state.ads, every: Number(e.target.value) } });
$$('#adPosSeg button').forEach((b) => b.addEventListener('click', () => { setStage({ ads: { ...S.state.ads, pos: b.dataset.ap } }); placeLayer('ads', b.dataset.ap); }));
$('#adPick').onclick = () => { if (!isHost()) return; $('#adFile').click(); };
$('#adFile').onchange = async (e) => {
  const files = [...e.target.files].slice(0, 8); e.target.value = '';
  const items = [...(S.state.ads?.items || [])];
  for (const f of files) {
    if (items.length >= 8) break;
    try { const data = await compressImage(f); items.push(await storeAsset(data)); } catch (err) { toast(err.message, { err: true }); }
  }
  setStage({ ads: { ...S.state.ads, on: true, items } });
  toast(`${files.length} sponsor image${files.length === 1 ? '' : 's'} added.`);
};
function renderAds() {
  const a = S.state.ads || { items: [] }, host = isHost();
  $('#adsSwitch').checked = !!a.on; $('#adsSwitch').disabled = !host;
  $('#adEvery').value = String(a.every || 12);
  $$('#adPosSeg button').forEach((b) => { b.classList.toggle('on', b.dataset.ap === (a.pos || 'br')); b.disabled = !host; });
  replaceKids($('#adList'), ...(a.items || []).map((id, i) => {
    const d = document.createElement('div'); d.className = 'ad-thumb';
    const im = assetImg(id); if (im) { const x = document.createElement('img'); x.src = im.src; x.alt = ''; d.append(x); }
    const del = document.createElement('button'); del.type = 'button'; del.className = 'icon-btn sm on-media'; del.innerHTML = icon('x', { size: 'sm' }); del.setAttribute('aria-label', 'Remove sponsor image'); del.disabled = !host;
    del.onclick = () => { const items = [...a.items]; items.splice(i, 1); setStage({ ads: { ...a, items } }); };
    d.append(del); return d;
  }));
  $('#adOpts').hidden = !(a.items || []).length;
  $$('#panelSeg button').forEach((b) => { b.classList.toggle('on', b.dataset.panel === (S.state.brand.panel || 'glass')); b.disabled = !host; });
  $('#panelColor').value = S.state.brand.panelColor || '#0f172a'; $('#panelColorRow').hidden = S.state.brand.panel !== 'solid';
}

// ---------------------------------------------------------------- green room quick controls
$$('#grFx button').forEach((b) => b.addEventListener('click', () => { $(`#bgFxSeg [data-fx="${b.dataset.fx}"]`)?.click(); renderGreenRoom(); }));
$('#grCam').onchange = (e) => { $('#camSelect').value = e.target.value; $('#camSelect').dispatchEvent(new Event('change')); };
$('#grMic').onchange = (e) => { $('#micSelect').value = e.target.value; $('#micSelect').dispatchEvent(new Event('change')); };
function renderGreenRoom() {
  $$('#grFx button').forEach((b) => b.classList.toggle('on', b.dataset.fx === S.videoFx.effect));
  for (const [from, to] of [['#camSelect', '#grCam'], ['#micSelect', '#grMic']]) {
    const src = $(from), dst = $(to);
    if (dst.options.length !== src.options.length) replaceKids(dst, ...[...src.options].map((o) => new Option(o.text, o.value)));
    dst.value = src.value;
  }
}

// ---------------------------------------------------------------- media library (this browser) + scenes with media
S.library = [];
function libDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('gather-library', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function libTx(mode, fn) { const db = await libDb(); return new Promise((res, rej) => { const tx = db.transaction('items', mode); const out = fn(tx.objectStore('items')); tx.oncomplete = () => res(out?.result ?? out); tx.onerror = () => rej(tx.error); }); }
async function libLoad() { try { S.library = (await libTx('readonly', (s) => s.getAll())) || []; } catch { S.library = []; } renderLibrary(); }
const libKind = (f) => {
  const t = typeof f?.type === 'string' ? f.type : '', n = typeof f?.name === 'string' ? f.name : '';
  return t === 'application/pdf' || /\.pdf$/i.test(n) ? 'pdf' : t.startsWith('video/') ? 'video' : (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(n)) ? 'audio' : t.startsWith('image/') ? 'image' : '';
};
async function libAddFiles(files) {
  for (const f of [...files]) {
    const kind = libKind(f);
    if (!kind) { toast(`${f.name}: use a PDF, video, audio or image.`, { err: true }); continue; }
    if (f.size > 500 * 1048576) { toast(`${f.name} is over 500 MB.`, { err: true }); continue; }
    await libTx('readwrite', (s) => s.put({ id: uid() + uid(), name: f.name.replace(/\.[^.]+$/, ''), kind, blob: f, type: f.type, size: f.size, added: Date.now() }));
  }
  await libLoad(); toast('Added to your media library.');
}
$('#libPick').onclick = () => $('#libFile').click();
$('#libFile').onchange = (e) => { libAddFiles(e.target.files); e.target.value = ''; };
$('#libUrlAdd').onclick = async () => {
  let u = $('#libUrl').value.trim();
  if (!u) return;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { new URL(u); } catch { return toast('That doesn’t look like a web address.', { err: true }); }
  const name = $('#libUrlName').value.trim() || new URL(u).hostname.replace(/^www\./, '');
  await libTx('readwrite', (s) => s.put({ id: uid() + uid(), name, kind: /youtu\.?be/.test(u) ? 'youtube' : 'link', url: u, added: Date.now() }));
  $('#libUrl').value = ''; $('#libUrlName').value = ''; libLoad();
};
async function presentLibrary(it) {
  if (!it) return;
  if (it.kind === 'link' || it.kind === 'youtube') return offerOpen(it.url, it.name);
  if (it.kind === 'audio') return playBgMusicFile(new File([it.blob], it.name, { type: it.type || 'audio/mpeg' }));
  presentFile(new File([it.blob], it.name + ({ pdf: '.pdf', video: '', image: '' }[it.kind] || ''), { type: it.type }));
}
const KIND_LABEL = { pdf: 'PDF', video: 'Video', audio: 'Audio', image: 'Image', link: 'Web', youtube: 'YouTube' };
function renderLibrary() {
  const ul = $('#libList');
  replaceKids(ul, ...S.library.map((it) => {
    const li = document.createElement('li'); li.className = 'el-row lib-row';
    const k = document.createElement('span'); k.className = 'pill caps lib-kind k-' + it.kind; k.textContent = KIND_LABEL[it.kind];
    const nm = document.createElement('span'); nm.className = 'menu-item compact el-pick'; nm.textContent = it.name;
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn sm'; go.textContent = 'Present'; go.onclick = () => presentLibrary(it);
    const del = mkBtn('trash-2', 'Remove from library', async () => { await libTx('readwrite', (s) => s.delete(it.id)); libLoad(); });
    li.append(k, nm, go, del); return li;
  }));
  $('#libEmpty').hidden = !!S.library.length;
  const sel = $('#sceneMedia'); const cur = sel.value;
  replaceKids(sel, new Option('No media', ''), ...S.library.map((it) => new Option(`${KIND_LABEL[it.kind]} · ${it.name}`, it.id)));
  sel.value = cur;
}

// ---------------------------------------------------------------- AI producer: name it, talk to it, it runs the show → ./producer.js
const producer = createProducer({
  $, $$, store, S, isHost, toast, audioCtx, syncMedia, mixInMedia, stopPresentation, presentScreen, creds,
  setStage, participants, g, mixHex, accentOf, hexA, uid, withDefaults, AI_NAME, plainMd, elementsCopy,
  upsertAI, actChip, renderAILog, renderAIPanel, setAiSetup, autoGrow, cap, sendCaption, showCaption, setTab,
  sceneList, activeSceneId, applyScene, renderOffBg, libLoad, presentLibrary
});
const { speechHub } = producer;
function renderProducerUI(...args) { return producer.renderProducerUI(...args); }
function renderVoiceNames(...args) { return producer.renderVoiceNames(...args); }
function setCmd(...args) { return producer.setCmd(...args); }
function offerOpen(...args) { return producer.offerOpen(...args); }
function askProducer(...args) { return producer.askProducer(...args); }
function drawOrb(...args) { return producer.drawOrb(...args); }
function syncCaptions(...args) { return producer.syncCaptions(...args); }

// ---------------------------------------------------------------- enter studio (green room)
let enterMode = 'create', previewing = false;
const previewActive = () => previewing && !S.studio;
function stopPreviewLoop() { previewing = false; }
async function openEnter(mode, code) {
  if (S.studio) return openInvite();
  setEnterMode(mode || 'create');
  if (code) $('#enterCode').value = code;
  $('#enterName').value = S.name;
  $('#enterErr').hidden = true;
  $('#enterGo').disabled = false;
  $('#enterDlg').showModal();
  S.hostEntering = enterMode !== 'join'; renderHeader(); // the studio shows behind the host's device check
  checkServer();
  if (acct.token) acctApi('me').then((r) => setUser(r.user)).catch(() => {});
  (S.name ? (mode === 'join' && !code ? $('#enterCode') : $('#enterGo')) : $('#enterName')).focus();
  previewing = true;
  audioCtx();
  S.local.micOn = S.prefs.startMic; S.local.camOn = S.prefs.startCam;
  if (S.local.camOn) await startCam(); else stopCam();
  if (S.local.camOn && !S.local.cam) S.local.camOn = false;
  if (S.local.micOn) await startMic();
  renderPreview(); renderStageUI();
}
function renderPreview() {
  const v = $('#previewVideo');
  const track = S.local.camOn ? S.local.cam : null;
  if ((v.srcObject?.getVideoTracks()[0] || null) !== track) v.srcObject = track ? new MediaStream([track]) : null;
  $('#previewOff').hidden = !!track;
  const av = store.get('avatar', '');
  $('#previewInitials').textContent = av ? '' : initials($('#enterName').value || S.name);
  $('#previewInitials').style.backgroundImage = av ? `url("${av}")` : '';
  $('#previewInitials').classList.toggle('has-av', !!av);
  $('#avatarImg').hidden = !av; if (av) $('#avatarImg').src = av;
  $('#avatarHint').textContent = av ? 'Change photo' : 'Add a photo';
  $('#previewMsg').textContent = S.local.camError && !track ? S.local.camError : 'Camera is off';
  $('#pMic').setAttribute('aria-pressed', String(!(S.local.micOn && S.local.audio)));
  $('#pCam').setAttribute('aria-pressed', String(!track));
}
$('#pMic').onclick = () => setMic(!(S.local.micOn && S.local.audio));
$('#pCam').onclick = () => setCam(!S.local.camOn);
$('#enterName').addEventListener('input', renderPreview);
function showEnterErr(msg) { const e = $('#enterErr'); e.textContent = msg; e.hidden = false; }
// Check the server and its storage as soon as the green room opens, so setup problems show up before you click.
async function checkServer() {
  try {
    const c = await api('config');
    if (!c.ok) showEnterErr(c.problem || 'The studio server is not ready.');
  } catch (e) { showEnterErr(e.message); }
}
function setEnterMode(m) {
  enterMode = m;
  $$('#enterForm .seg button[data-mode]').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  $('#codeFld').hidden = m !== 'join';
  $('#enterGo').textContent = m === 'join' ? 'Join studio' : 'Enter the studio';
  $('#enterErr').hidden = true;
  // The host (creating) gets the device check over their own studio; a guest joining keeps the join form.
  $('#enterDlg').classList.toggle('host', m !== 'join');
  $('#enterH').textContent = m === 'join' ? 'Join the show' : 'Step into the studio';
  $('#enterSub').textContent = m === 'join' ? 'Check your camera and mic, then join the host backstage.' : 'Check how you look and sound. Your studio is ready behind this.';
  S.hostEntering = m !== 'join' && $('#enterDlg').open;
  renderHeader();
}
$$('#enterForm .seg button[data-mode]').forEach((b) => b.addEventListener('click', () => setEnterMode(b.dataset.mode)));
$('#enterForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'go') return; // close button
  e.preventDefault();
  const name = $('#enterName').value.trim();
  if (!name) { $('#enterErr').textContent = 'Add your name so people know who you are.'; $('#enterErr').hidden = false; return $('#enterName').focus(); }
  if (enterMode !== 'join' && !S.pendingStream && S.requireAccount && !acct.user) {
    if (acct.token) {
      try { await account.acctBootP; } catch {}
      if (!acct.user && acct.token) try { setUser((await acctApi('me')).user); } catch {}
    }
    if (!acct.user) { $('#enterDlg').close(); return needAccountThen(() => openEnter('create')); }
  }
  let code = enterMode === 'join' ? parseCode($('#enterCode').value) : (S.pendingStream?.code || newCode());
  if (!code) { $('#enterErr').textContent = 'Paste the studio code your host sent you.'; $('#enterErr').hidden = false; return $('#enterCode').focus(); }
  S.name = name; store.set('name', name); $('#nameInput').value = name;
  busy($('#enterGo'));
  try { await join(code, { callin: S.callin && enterMode === 'join', create: enterMode !== 'join' }); }
  catch (err) {
    if (err.handled) { toast(err.message, { err: true }); return; }
    setEnterMode(enterMode); showEnterErr(err.message); setPhase('offline');
  }
  finally { busy($('#enterGo'), false); }
});
$('#enterDlg').addEventListener('close', () => {
  S.hostEntering = false; renderHeader(); // closed without going in: back to the homepage
  if (!S.studio) { previewing = false; stopCam(); stopMic(); renderStageUI(); renderDock(); }
});
// ./invite.js
const invite = createInvite({
  $, $$, store, MAX, S, isHost, normalizeHex, hexLuminance, toast, linkKind, parseCode, copy, inviteLink,
  shortInviteUrl, preferredInviteUrl, api, creds, participants, mixHex, qrReadyFor, needAccountThen,
  openWizard, renderSocialMatrix, guideMark, openEnter, get watchSlug() { return watchSlug; },
  get watchLinkUrl() { return watchLinkUrl; }, get watchLinkText() { return watchLinkText; }
});
function flashBtn(...args) { return invite.flashBtn(...args); }
function renderInviteDialog(...args) { return invite.renderInviteDialog(...args); }
function openInvite(...args) { return invite.openInvite(...args); }

// ---------------------------------------------------------------- keyboard + user lightbox shortcuts
const SHORTCUT_GROUPS = [
  {
    id: 'controls',
    title: 'Audio & video',
    items: [
      { keys: ['M'], action: 'Mute or unmute microphone', single: true },
      { keys: ['V'], action: 'Toggle camera on or off', single: true },
      { keys: ['S'], action: 'Share or stop screen presentation', single: true },
      { keys: ['R'], action: 'Start or stop recording', note: 'Host', single: true },
      { keys: ['M'], action: 'Mark highlight moment', note: 'Clip & Post', single: true },
      { keys: ['I'], action: 'Instant replay of the last 30 seconds', note: 'Host', single: true },
    ],
  },
  {
    id: 'scenes',
    title: 'Scenes & slides',
    items: [
      { keys: ['1', '–', '9'], sep: true, action: 'Switch to scene 1–9', note: 'Host', single: true },
      { keys: ['←', '→'], action: 'Previous or next PDF slide', single: true },
      { keys: ['PgUp', 'PgDn'], action: 'Jump slides while presenting', single: true },
      { keys: ['←', '→'], action: 'Step through scenes strip or tour', single: false },
    ],
  },
  {
    id: 'editor',
    title: 'Stage editor',
    items: [
      { keys: ['↑', '↓', '←', '→'], action: 'Nudge selected stage layer', note: 'Host · 8 px', single: false },
      { keys: ['Shift', '+', 'Arrows'], sep: true, action: 'Large nudge selected layer', note: 'Host · 40 px', single: false },
      { keys: ['Alt', '+', 'Drag'], sep: true, action: 'Stack overlapping layers freely', note: 'Host', single: false },
      { keys: ['Del', 'Backspace'], action: 'Remove selected stage layer', note: 'Host', single: true },
      { keys: ['Right-click'], action: 'Open stage layer actions menu', note: 'Host', single: false },
      { keys: ['Esc'], action: 'Deselect layer or exit stage editor', note: 'Host', single: false },
    ],
  },
  {
    id: 'chat',
    title: 'Chat, AI & navigation',
    items: [
      { keys: ['/'], action: 'Open Sam AI bar or focus chat', note: 'Host opens AI', single: true },
      { keys: ['Enter'], action: 'Send chat message', note: 'Shift + Enter for new line', single: false },
      { keys: ['⌘/Ctrl', '+', 'Enter'], sep: true, action: 'Run AI Designer prompt', note: 'Host', single: false },
      { keys: ['Tab', 'Arrows'], action: 'Move across tabs and segmented controls', single: false },
      { keys: ['?'], action: 'Open Keyboard Shortcuts in user menu', single: false },
      { keys: ['Esc'], action: 'Close menus, dialogs, or stage editor', single: false },
    ],
  },
];

let shortcutsCat = 'all';
let shortcutsQuery = '';

function mountShortcutsRoot(signedIn) {
  const root = $('#shortcutsRoot');
  const host = signedIn ? $('#acShortcutsHost') : $('#acShortcutsOutHost');
  if (root && host && root.parentElement !== host) host.append(root);
}

function syncSingleKeyPref(enabled) {
  const on = !!enabled;
  store.set('keys', on);
  const chk = $('#shortcutsKeysChk'), note = $('#shortcutsSingleNote');
  if (chk) chk.checked = on;
  if (note) note.textContent = on
    ? 'Active outside text inputs · turn off for voice control or screen readers'
    : 'Paused for voice control or screen readers';
  renderShortcutsList();
}

function renderShortcutsList() {
  const body = $('#shortcutsBody'), empty = $('#shortcutsEmpty');
  if (!body) return;
  const q = shortcutsQuery.trim().toLowerCase();
  const singleOn = store.get('keys', true);
  const nodes = [];

  for (const grp of SHORTCUT_GROUPS) {
    if (shortcutsCat !== 'all' && grp.id !== shortcutsCat) continue;
    const filtered = grp.items.filter((it) => {
      if (!q) return true;
      const hay = `${grp.title} ${it.action} ${it.note || ''} ${it.keys.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
    if (!filtered.length) continue;

    const sec = document.createElement('section');
    sec.className = 'sf-group';
    const h = document.createElement('h4');
    h.className = 'sf-group-h';
    h.textContent = grp.title;
    const ul = document.createElement('ul');
    ul.className = 'sf-list';

    for (const it of filtered) {
      const li = document.createElement('li');
      li.className = 'sf-row' + (it.single && !singleOn ? ' is-paused' : '');

      const act = document.createElement('span');
      act.className = 'sf-action';
      const label = document.createElement('span');
      label.textContent = it.action;
      act.append(label);
      if (it.note) {
        const sep = document.createElement('span');
        sep.className = 'sf-note';
        sep.textContent = `· ${it.note}`;
        act.append(sep);
      }

      const keys = document.createElement('span');
      keys.className = 'sf-keys';
      for (const token of it.keys) {
        if (it.sep && (token === '+' || token === '–')) {
          const s = document.createElement('span');
          s.className = 'sf-sep';
          s.setAttribute('aria-hidden', 'true');
          s.textContent = token;
          keys.append(s);
        } else {
          const kbd = document.createElement('kbd');
          kbd.textContent = token;
          keys.append(kbd);
        }
      }

      li.append(act, keys);
      ul.append(li);
    }

    sec.append(h, ul);
    nodes.push(sec);
  }

  replaceKids(body, ...nodes);
  if (empty) empty.hidden = nodes.length > 0;
}

function isShortcutsLightboxOpen() {
  const dlg = $('#acctDlg');
  if (!dlg?.open) return false;
  return acct.user ? account.acPane === 'shortcuts' : account.acView === 'shortcuts';
}

function openShortcutsLightbox() {
  const dlg = $('#acctDlg');
  if (isShortcutsLightboxOpen()) {
    dlg.close();
    return;
  }
  if (acct.user) openAccount('in', 'shortcuts');
  else openAccount('shortcuts');
  setTimeout(() => $('#shortcutsSearch')?.focus(), 40);
}

(function initShortcutsPane() {
  if (!$('#shortcutsRoot')) return;
  $('#shortcutsKeysChk')?.addEventListener('change', (e) => syncSingleKeyPref(e.target.checked));
  $('#shortcutsSearch')?.addEventListener('input', (e) => {
    shortcutsQuery = e.target.value || '';
    renderShortcutsList();
  });
  $('#shortcutsSearch')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shortcutsQuery) {
      e.preventDefault();
      e.stopPropagation();
      shortcutsQuery = '';
      e.target.value = '';
      renderShortcutsList();
    }
  });

  $$('#shortcutsCats > button').forEach((btn) => {
    btn.addEventListener('click', () => {
      shortcutsCat = btn.dataset.cat || 'all';
      $$('#shortcutsCats > button').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      });
      renderShortcutsList();
    });
  });

  syncSingleKeyPref(store.get('keys', true));
})();

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const ae = document.activeElement, tag = ae?.tagName;
  // Typing is never a shortcut: inputs, and any contenteditable (the show title is "plaintext-only").
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || ae?.isContentEditable) return;
  const openDlg = document.querySelector('dialog[open]');
  if (e.key === '?') {
    if (openDlg && !isShortcutsLightboxOpen()) return;
    e.preventDefault();
    openShortcutsLightbox();
    return;
  }
  if (openDlg) return;
  const k = (e.key || '').toLowerCase();
  if (!k) return;
  if (k === 'escape') { if (editor.on) { e.preventDefault(); setEditing(false); } return; } // never swallow Esc for menus
  if (!store.get('keys', true) || ae?.closest?.('button, a, [role="tab"], [role="radio"], [contenteditable]:not([contenteditable="false"]), .popover')) return;
  const act = {
    m: () => setMic(!(S.local.micOn && S.local.audio)),
    v: () => setCam(!S.local.camOn),
    s: () => S.studio && (S.local.pres ? stopPresentation() : presentScreen()),
    r: () => S.studio && toggleRecord(),
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, () => isHost() && sceneList()[n - 1] && applyScene(sceneList()[n - 1])])),
    arrowright: () => S.local.pres?.kind === 'pdf' && S.local.pres.go(S.local.pres.page + 1),
    arrowleft: () => S.local.pres?.kind === 'pdf' && S.local.pres.go(S.local.pres.page - 1),
    pagedown: () => S.local.pres?.kind === 'pdf' && S.local.pres.go(S.local.pres.page + 1),
    pageup: () => S.local.pres?.kind === 'pdf' && S.local.pres.go(S.local.pres.page - 1),
    delete: () => { if (editor.on && editor.sel) deleteEl(editor.sel); },
    backspace: () => { if (editor.on && editor.sel) deleteEl(editor.sel); },
    '/': () => { if (isHost() && S.studio) setCmd(true); else { setTab('chat'); $('#chatInput').focus(); } },
  }[k];
  if (act) { e.preventDefault(); act(); }
});

// ---------------------------------------------------------------- sound
function chime() {
  try {
    const ctx = audioCtx(), o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(660, ctx.currentTime); o.frequency.setValueAtTime(880, ctx.currentTime + .09);
    gn.gain.setValueAtTime(.0001, ctx.currentTime); gn.gain.exponentialRampToValueAtTime(.06, ctx.currentTime + .02); gn.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .35);
    o.connect(gn).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .4);
  } catch {}
}

// ---------------------------------------------------------------- host walk-through
// A short tour for hosts: each step lights up one part of the studio and says what it's for. It runs once,
// the first time you host, and any time from Help → "Take the studio tour". Steps whose part isn't on screen
// (say, a panel that's folded away) are skipped.
// One sweep around the screen, never doubling back: the stage and what's under it, the bottom bar left to right,
// the panel rail top to bottom, then the header left to right, ending on Go live.
const TOUR = [
  ['#stage', 'Your show', 'What you see here is exactly what viewers see and what gets recorded.'],
  ['#sceneStrip', 'Scenes', 'Switch layouts in one click, or press 1–9. Save your own from Look → Layout.'],
  ['.deck-tabs [data-deck="people"]', 'Guests and backstage', 'New guests wait backstage. Click someone’s picture to put them on stage, or back off it.'],
  ['#shareBtn', 'Present', 'Share your screen, slides, a video, an image or a game.'],
  ['#recBtn', 'Record', 'Record the show in this browser, then download it or save it to Google Drive.'],
  ['#aiDock', 'Your AI producer', 'Ask it anything on air, or tell it to switch scenes, show a banner or find a video. Press / any time.'],
  ['.rail-btn[data-tab="show"]', 'Show', 'Your watch page, super chats, voice questions, viewer features and stage options.'],
  ['.rail-btn[data-tab="look"]', 'Look', 'Arrange layouts, set your brand colours and fonts, and run banners, tickers and custom emotes.'],
  ['.rail-btn[data-tab="shop"]', 'Shop', 'Pin products from Shopify or any link onto the stage and run flash sales.'],
  ['.rail-btn[data-tab="polls"]', 'Polls', 'Launch live polls and predictions with real-time results on stage.'],
  ['.rail-btn[data-tab="gaming"]', 'Play with me', 'Let viewers queue up with their gamertag and call the next player on stage.'],
  ['.rail-btn[data-tab="music"]', 'Music', 'Play background tracks that automatically duck whenever anyone speaks.'],
  ['#enterTop', 'Invite', 'Send guests the link. They don’t need an account.'],
  ['#watchTop', 'Watch page', 'Your own page for viewers: the show, live chat and super chats. Share this link anywhere.'],
  ['#liveTop', 'Go live', 'Stream to YouTube, Twitch and more at once. Your watch page works without it.'],
];
const tour = { i: 0, steps: [] };
const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
function startTour() {
  if ($('#helpDlg').open) $('#helpDlg').close();
  tour.steps = TOUR.filter(([sel]) => visible($(sel)));
  if (!tour.steps.length) return;
  tour.i = 0; $('#tour').hidden = false; showTourStep();
  $('#tourNext').focus();
}
function endTour() { $('#tour').hidden = true; store.set('tourDone', true); }
function showTourStep() {
  const [sel, title, text] = tour.steps[tour.i], el = $(sel);
  if (!visible(el)) return tour.i < tour.steps.length - 1 ? (tour.i++, showTourStep()) : endTour();
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('#tourStep').textContent = `${tour.i + 1} of ${tour.steps.length}`;
  $('#tourH').textContent = title; $('#tourText').textContent = text;
  $('#tourBack').disabled = tour.i === 0;
  $('#tourNext').textContent = tour.i === tour.steps.length - 1 ? 'Done' : 'Next';
  placeTour();
}
function placeTour() {
  if ($('#tour').hidden) return;
  const el = $(tour.steps[tour.i][0]), r = el.getBoundingClientRect(), pad = 6;
  Object.assign($('#tourSpot').style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
  const card = $('#tourCard'), cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, vw = innerWidth, vh = innerHeight;
  let top = r.bottom + gap;
  if (top + ch > vh - 8) top = r.top - gap - ch;          // no room below: above
  if (top < 8) top = Math.min(vh - ch - 8, Math.max(8, r.top + r.height / 2 - ch / 2)); // tall targets: beside
  let left = r.left + r.width / 2 - cw / 2;
  if (r.height > vh * 0.5 && r.right + gap + cw < vw) left = r.right + gap; // a big area (the stage): put the card next to it
  if (r.left > vw - 140 && r.height < vh * 0.5) { left = r.left - gap - cw; top = Math.max(8, Math.min(vh - ch - 8, r.top + r.height / 2 - ch / 2)); } // the panel rail: beside it, not over it
  left = Math.max(8, Math.min(vw - cw - 8, left));
  Object.assign(card.style, { left: left + 'px', top: top + 'px' });
}
$('#tourNext').onclick = () => { if (tour.i >= tour.steps.length - 1) return endTour(); tour.i++; showTourStep(); };
$('#tourBack').onclick = () => { if (tour.i > 0) { tour.i--; showTourStep(); } };
$('#tourSkip').onclick = endTour;
$('#tourStart').onclick = () => startTour();
$('#tour').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); endTour(); } else if (e.key === 'ArrowRight') $('#tourNext').click(); else if (e.key === 'ArrowLeft') $('#tourBack').click(); });
addEventListener('resize', placeTour);
// First time you host: once the invite dialog closes. Not under browser automation, where it would sit over the
// controls a script is driving (the tour itself is tested by opening it from Help).
$('#inviteDlg').addEventListener('close', () => { if (isHost() && S.studio && !store.get('tourDone', false) && !navigator.webdriver) setTimeout(startTour, 300); });

// ---------------------------------------------------------------- selection state for assistive tech, in one place
// Segmented controls, look tabs and the rail mark the chosen option with .on. Mirror that into aria-checked /
// aria-selected, and let arrow keys move along radio groups and tab lists.
function syncAria(b) {
  const r = b.getAttribute('role'), on = b.classList.contains('on');
  if (r === 'radio') b.setAttribute('aria-checked', on); else if (r === 'tab') b.setAttribute('aria-selected', on);
}
for (const g of $$('.seg')) {
  if (!g.getAttribute('role')) g.setAttribute('role', 'radiogroup');
  for (const b of g.querySelectorAll(':scope > button')) { if (!b.getAttribute('role')) b.setAttribute('role', g.getAttribute('role') === 'tablist' ? 'tab' : 'radio'); syncAria(b); }
}
new MutationObserver((ms) => { for (const m of ms) if (m.target.matches?.('.seg > button')) syncAria(m.target); })
  .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
document.addEventListener('keydown', (e) => {
  const g = e.target.closest?.('[role="radiogroup"], [role="tablist"]');
  if (!g || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  const items = [...g.querySelectorAll(':scope > button:not([disabled])')], i = items.indexOf(e.target);
  if (i < 0) return;
  e.preventDefault(); e.stopPropagation();
  const next = items[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length];
  next.focus(); next.click();
});

// ---------------------------------------------------------------- the public watch page (/w/<studio>) → ./audience.js
const audience = createAudience({
  $, smooth, $$, store, get W() { return W; }, get H() { return H; }, S, isHost, watchCfg, normalizeHex,
  hexLuminance, notifier, toast, fmtTime, copy, get recDest() { return recDest; }, audioCtx, mixInMedia, api,
  creds, wsSend, setStage, canvas, g, speaking, rr, stageElements, get camRects() { return camRects; },
  chatShell, uid, withDefaults, assetImg, setAssetData, storeAsset, compressImage, wrapLines, px, superAlert,
  playScVoice, elementsCopy, freeSpot, acct, acctApi, setUser, openAccount, parseHashtags,
  rasterizeSvg, appendLog, setTab, flashBtn, renderInviteDialog, chime
});
const { watchSlug, watchLinkUrl, watchLinkText, money, shopCfg } = audience;
function viewerWant(...args) { return audience.viewerWant(...args); }
function viewerSignal(...args) { return audience.viewerSignal(...args); }
function closeViewer(...args) { return audience.closeViewer(...args); }
function closeAllViewers(...args) { return audience.closeAllViewers(...args); }
function gotSuperchat(...args) { return audience.gotSuperchat(...args); }
function renderBountyPanel(...args) { return audience.renderBountyPanel(...args); }
function drawBountyEl(...args) { return audience.drawBountyEl(...args); }
function refreshSupers(...args) { return audience.refreshSupers(...args); }
function reactFloat(...args) { autoMoments?.onReact(); return audience.reactFloat(...args); }
function setWatch(...args) { return audience.setWatch(...args); }
function renderWatchSec(...args) { return audience.renderWatchSec(...args); }
function setShop(...args) { return audience.setShop(...args); }
function drawProduct(...args) { return audience.drawProduct(...args); }
function drawPoll(...args) { return audience.drawPoll(...args); }
function gotQueue(...args) { return audience.gotQueue(...args); }
function renderQueue(...args) { return audience.renderQueue(...args); }
function gotVoice(...args) { return audience.gotVoice(...args); }
function dropVoice(...args) { return audience.dropVoice(...args); }
function refreshVoice(...args) { return audience.refreshVoice(...args); }
function drawWatchBadge(...args) { return audience.drawWatchBadge(...args); }

// ---------------------------------------------------------------- live viewers on every platform → ./viewers.js
const viewerCount = createViewerCount({ S, isHost });

// ---------------------------------------------------------------- boot
document.fonts?.ready.then(() => S.banner.key = '');
setTab('chat');
setPhase('offline');
renderHelp();
account.acctBootP = acctBoot();
applyAdaptiveAccent(S.state?.brand?.color);
// Bring back the last scene (and how it was arranged) before anyone joins.
(function restoreLastScene() {
  const id = store.get('lastScene', '');
  const sc = id && sceneList().find((x) => x.id === id);
  if (!sc || sc.kind === 'saved') { S.state.elements = ensureSystem(S.state.elements || [], isVertical(), uid); return; }
  S.state = { ...S.state, layout: sc.kind === 'builtin' ? sc.layout : 'custom', scene: sc.id, elements: sceneElements(sc.id, sc.els || []) };
})();
const linkCode = /^\/[sc]\//.test(location.pathname) ? parseCode(location.pathname.replace(/^\/c\//, '/s/')) : '';
S.callin = typeof location?.pathname === 'string' && location.pathname.startsWith('/c/');
// From the watch page's "Join now" (a raised hand the host let in): ?pass=… goes straight in, ?as=voice joins
// with the camera off. The pass is taken out of the address so a reload or a shared link doesn't carry it.
{
  const q = new URLSearchParams(location.search), pass = q.get('pass');
  if (linkCode && pass && /^[\w.-]{4,40}$/.test(pass)) {
    (S.joinPass ||= {})[linkCode] = pass;
    if (q.get('as') === 'voice') { S.local.camOn = false; S.voiceOnly = true; }
    history.replaceState(null, '', location.pathname);
  }
}
if (linkCode) openEnter('join', linkCode);
window.__gather = S; // handy for debugging in the console
window.__acct = acct;
window.__cap = cap;
$('#liveOffRec').onclick = () => { $('#liveDlg').close(); if (!S.rec) toggleRecord(); };
$('#audioUnblock').onclick = () => tryPlayAll(); // the pointerdown handler above does the unmuting
setInterval(() => { if (S.studio && !S.rec && S.state?.rec?.on) renderDock(); }, 1000); // guests' REC timer

// ---------------------------------------------------------------- on the stream: reaction waves
// Each viewer reaction rises from the lower right of the picture and fades: a wave when the room gets loud.
function drawWaves() {
  const list = S.waves; if (!list?.length) return;
  const now = performance.now(), life = 2600;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = list.length - 1; i >= 0; i--) {
    const w = list[i], t = (now - w.t0) / life;
    if (t >= 1) { list.splice(i, 1); continue; }
    const ease = 1 - Math.pow(1 - t, 3);
    g.globalAlpha = t < 0.12 ? t / 0.12 : 1 - Math.max(0, (t - 0.6) / 0.4);
    g.font = `${Math.round(44 * w.s * (0.7 + 0.3 * Math.min(1, t * 4)))}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.fillText(w.e, (w.x + w.dx * Math.sin(t * 6)) * W, H * (0.9 - ease * 0.55));
  }
  g.restore();
}

// ---------------------------------------------------------------- Play panel: scoreboard quick controls
$('#scoreAdd')?.addEventListener('click', () => { if (!isHost()) return toast('Only the host can change the stage.', { err: true }); addElement('score', { edit: false }); setTimeout(renderScorePanel, 50); toast('Scoreboard added to the stage. Drag it anywhere in Look → Layout.'); });
$('#scoreQuick')?.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sq]'); if (!b) return;
  const e = (S.state.elements || []).find((x) => x.type === 'score'); if (!e) return;
  scoreAction(e.id, b.dataset.sq); setTimeout(renderScorePanel, 30);
});
for (const [id, k] of [['scoreName-a', 'a'], ['scoreName-b', 'b'], ['scoreRound', 'round'], ['scoreMap', 'map']]) {
  $('#' + id)?.addEventListener('change', (ev) => { const e = (S.state.elements || []).find((x) => x.type === 'score'); if (e) patchEl(e.id, { [k]: ev.target.value.trim() }); });
}

// ---------------------------------------------------------------- Look tab: AI designer, brand kit
const LOOK_KIND = { backdrop: 'bgImage', logo: 'logo', overlay: 'overlay' };
const lookDesigner = (target) => {
  if (!isHost()) return toast('Only the host can change the brand.', { err: true });
  openDesigner({ target, targets: ['backdrop', 'logo', 'overlay'], onUse: (t, data) => brandDataUrl(LOOK_KIND[t], data) });
};
$('#bgImgAiBtn')?.addEventListener('click', () => lookDesigner('backdrop'));
$('#logoAiBtnLook')?.addEventListener('click', () => lookDesigner('logo'));
$('#overlayAiBtnLook')?.addEventListener('click', () => lookDesigner('overlay'));
$('#brandKitAi')?.addEventListener('click', () => lookDesigner('backdrop'));
function renderBrandKit() {
  const box = $('#brandKit'); if (!box) return;
  const b = S.state.brand || {}, img = (id) => (id ? S.assets.get(id)?.data || '' : '');
  const set = (k, src) => { const el = box.querySelector(`[data-kit="${k}"] .bk-thumb`); if (!el) return; el.style.backgroundImage = src ? `url("${src}")` : ''; el.classList.toggle('empty', !src); };
  box.querySelector('[data-kit="colour"] .bk-thumb').style.background = b.color || 'var(--accent)';
  set('backdrop', img(b.bgImage)); set('logo', img(b.logo)); set('overlay', img(b.overlay));
}
$('#brandKit')?.addEventListener('click', (e) => {
  const k = e.target.closest('[data-kit]')?.dataset.kit; if (!k) return;
  if (k === 'overlay') { $('.look-seg:not([hidden]) [data-look="overlays"]')?.click() || $$('[data-look="overlays"]').find((x) => x.offsetParent)?.click(); setTimeout(() => $('[data-sec="stage-overlay"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); return; }
  $({ colour: '[data-sec="colour"]', backdrop: '[data-sec="bg"]', logo: '[data-sec="logo"]' }[k])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------- side panels: shared headers, finder, smooth sections, new tools
initPanels({
  isHost: () => isHost(), toast, setStage, brandImage, playMusicFile: (f) => playBgMusicFile(f),
  designer: (t) => {
    if (!isHost()) return toast('Only the host can use the AI designer.', { err: true });
    const target = t === 'thumb' ? 'cover' : t;
    openDesigner({ target, targets: ['cover', 'backdrop', 'logo', 'overlay'], onUse: (k, data) => {
      if (k === 'cover') { const a = document.createElement('a'); a.href = data; a.download = (S.state.title || 'thumbnail').replace(/[^a-z0-9]+/gi, '-') + '.png'; a.click(); return toast('Thumbnail saved to your downloads.'); }
      return brandDataUrl(LOOK_KIND[k], data);
    } });
  },
  ask: (prompt) => {
    setTab('ai');
    const i = $('#aiInput') || $('#chatInput');
    if (i) { i.value = prompt; i.dispatchEvent(new Event('input')); i.focus(); }
    toast('Ready to send to ' + (store.get('aiName', '') || 'Sam') + ' — press Enter.');
  },
});

// ---------------------------------------------------------------- upgraded audio workstation & studio tools
const sharedToolsApi = {
  isHost: () => isHost(),
  toast,
  setStage,
  setWatch,
  setShop,
  shopCfg,
  watchCfg,
  brandPref,
  applyBrand: brandPref,
  brandDataUrl,
  getBrand: () => S.state?.brand || {},
  onBrandSync: (fn) => {
    if (typeof fn !== 'function') return;
    brandSyncSubs.push(fn);
    try { fn(S.state?.brand || {}); } catch {}
  },
  onStateSync: (fn) => {
    if (typeof fn !== 'function') return;
    stateSyncSubs.push(fn);
    try { fn(S.state); } catch {}
  },
  getPeers: () => participants().map((p) => ({ ...p, isHost: p.id === S.host })),
  getState: () => S.state,
  getCanvas: () => canvas,
  getStream: () => { try { return canvas.captureStream ? canvas.captureStream(30) : null; } catch { return null; } },
  getMixStream: () => { audioCtx(); return recDest?.stream || null; }, // the program's audio mix (clips.js)
  inStudio: () => !!S.studio,
  addElement,
  patchEl,
  getElements: () => S.state.elements || [],
  hitStageElement: (x, y) => {
    let nx = x, ny = y;
    if (x > 1 || y > 1) {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      nx = (x - r.left) / r.width;
      ny = (y - r.top) / r.height;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    }
    const els = drawOrder(stageElements()).filter((e) => !e.hidden).reverse();
    return els.find((e) => nx >= e.x && nx <= e.x + e.w && ny >= e.y && ny <= e.y + e.h) || null;
  },
  stageElementAction: (id, act) => {
    const els = elementsCopy(), idx = els.findIndex((x) => x.id === id);
    if (idx < 0) return;
    if (act === 'edit') { editor.sel = id; setEditing(true); }
    else if (act === 'center') {
      els[idx].x = Math.max(0, (1 - (els[idx].w || 0.2)) / 2);
      els[idx].y = Math.max(0, (1 - (els[idx].h || 0.2)) / 2);
      setStage({ elements: els });
    }
    else if (act === 'delete' || act === 'del') { els.splice(idx, 1); setStage({ elements: els }); }
    else if (act === 'hide') { els[idx].hidden = !els[idx].hidden; setStage({ elements: els }); }
    else if (act === 'front') { const [it] = els.splice(idx, 1); els.push(it); setStage({ elements: els }); }
    else if (act === 'back') { const [it] = els.splice(idx, 1); els.unshift(it); setStage({ elements: els }); }
    else if (act === 'dup') { const copy = { ...els[idx], id: uid().slice(0, 8), x: Math.min(0.85, els[idx].x + 0.03), y: Math.min(0.85, els[idx].y + 0.03) }; els.push(copy); setStage({ elements: els }); }
  },
  nudgeSelectedElement: (dx, dy) => {
    if (!editor.sel) return false;
    const e = selEl(); if (!e) return false;
    patchEl(e.id, { x: Math.max(0, Math.min(1 - e.w, e.x + dx)), y: Math.max(0, Math.min(1 - e.h, e.y + dy)) });
    return true;
  },
  getLiveDiagnostics: () => {
    const dests = readyDests();
    const hasCam = !!(S.local.cam && S.local.camOn);
    const hasMic = !!(S.local.audio && S.local.micOn);
    return {
      camOk: hasCam,
      micOk: hasMic,
      relayOk: !!S.relayOn,
      destCount: dests.length,
      inStudio: !!S.studio,
      hasCam,
      camLabel: S.local.camRaw?.label || S.local.cam?.label || '',
      hasMic,
      micLabel: S.local.audio?.label || '',
      hasKey: dests.length > 0,
      relayConfigured: !!S.relayOn,
    };
  },
  playMusicFile: (f) => playBgMusicFile(f),
  setMusicRate: (rate) => {
    if (bgMusic.el) bgMusic.el.playbackRate = Math.max(0.5, Math.min(2, Number(rate) || 1));
  },
  playStreamBuffer: async (audioBuffer, { duck = false } = {}) => {
    try {
      const ctx = audioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      const gOut = ctx.createGain();
      gOut.gain.value = 0.85;
      src.connect(gOut);
      const mix = mixInMedia(gOut, { duck, monitor: true });
      src.onended = () => mix.dispose();
      src.start();
      return () => { try { src.stop(); } catch {} mix.dispose(); };
    } catch { return () => {}; }
  },
  duckMusicTemporarily: (ms = 4000) => {
    try {
      if (!duckBus || !actx) return;
      duckBus.gain.setTargetAtTime(0.18, actx.currentTime, 0.08);
      setTimeout(() => { try { duckBus.gain.setTargetAtTime(1, actx.currentTime, 0.25); } catch {} }, ms);
    } catch {}
  },
  aidAddFiles,
  setTab,
  applyAdaptiveAccent,
};
try { initAudioStudio(sharedToolsApi); } catch (e) { console.warn('audio-studio init:', e); }
try { initStudioTools(sharedToolsApi); } catch (e) { console.warn('studio-tools init:', e); }
try { liveEvents.initLiveEvents({ ...sharedToolsApi, send: wsSend, inStudio: () => !!S.studio, requestStageRender }); } catch (e) { console.warn('live-events init:', e); }
try { refreshSections(); } catch {}
setInterval(syncAirPill, 1000);
syncAirPill();
