// The public watch page (/w/<studio>): Obsidian Broadcast Theater over WebRTC,
// with platform embed fallback, Stream Stats HUD, Host Drawer, One-Tap Reaction Dock,
// Live Chat Mood Meter synced with reactions, Consolidated Stage Tab, and 30s Clip Studio.
import { configureGoogle, googleConfigured, googleSignInToken } from './google.js';
import { cssEsc, replaceKids } from './ui.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return ''; } };
const code = safeDecode(location.pathname.split('/')[2] || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

const NAMES = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick', facebook: 'Facebook', x: 'X', rumble: 'Rumble', custom: 'Watch' };
const HOSTS = { 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'twitch.tv': 'Twitch', 'kick.com': 'Kick', 'facebook.com': 'Facebook', 'x.com': 'X', 'twitter.com': 'X', 'rumble.com': 'Rumble' };
const PAY = {
  card: { label: 'Card · Apple Pay · Google Pay', onsite: true },
  paypal: { label: 'PayPal', link: (h, a) => `https://paypal.me/${encodeURIComponent(h)}/${a}USD` },
  venmo: { label: 'Venmo', link: (h, a, note) => `https://venmo.com/?txn=pay&audience=private&recipients=${encodeURIComponent(h)}&amount=${a}&note=${encodeURIComponent(note)}` },
  cashapp: { label: 'Cash App', link: (h, a) => `https://cash.app/$${encodeURIComponent(h)}/${a}` },
  stripe: { label: 'Card · Apple Pay · Google Pay', link: (h) => h },
};
const REACTS = ['❤️', '🔥', '😂', '👏', '🎉', '😮'];

function nameOf(l) {
  try {
    const h = new URL(l.url).hostname.replace(/^www\.|^m\./, '');
    return HOSTS[h] || NAMES[l.kind] || h;
  } catch {
    return NAMES[l.kind] || 'Watch';
  }
}

/** An embeddable player address for a public watch link, or '' when the platform has no embed we can build. */
export function embedFor(kind, raw, host = location.hostname) {
  let u; try { u = new URL(raw); } catch { return ''; }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (h === 'twitch.tv') { const ch = u.pathname.split('/')[1]; return /^[a-z0-9_]{2,25}$/i.test(ch || '') ? `https://player.twitch.tv/?channel=${ch}&parent=${host}&muted=true` : ''; }
  if (h === 'kick.com') { const ch = u.pathname.split('/')[1]; return /^[a-z0-9_-]{2,30}$/i.test(ch || '') ? `https://player.kick.com/${ch}?muted=true` : ''; }
  if (h === 'youtu.be') { const id = u.pathname.slice(1); return /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1` : ''; }
  if (h === 'youtube.com') {
    const v = u.searchParams.get('v') || (u.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{11})/) || [])[1];
    if (v && /^[\w-]{11}$/.test(v)) return `https://www.youtube.com/embed/${v}?autoplay=1&mute=1`;
    const ch = (u.pathname.match(/^\/channel\/(UC[\w-]{22})/) || [])[1];
    if (ch) return `https://www.youtube.com/embed/live_stream?channel=${ch}&autoplay=1&mute=1`;
  }
  return '';
}

// ---------------------------------------------------------------- state
const ACCT = { user: null, av: '', then: null, up: false };
const W = {
  info: null,
  shown: new Set(),
  source: 'direct',
  iframe: '',
  direct: { state: 'idle', pc: null, gen: 0, connectedAt: 0 },
  lastReacts: null,
  reactPulse: 0,
  reactMomentum: 0,
  tab: 'chat',
  scTab: 'notices',
  assetCache: new Map(),
  hostAvatar: '',
  dismissedAlertKey: '',
  statsPrev: null,
  recentChat: [],
};

// ---------------------------------------------------------------- adaptive brand-synced accent
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
function applyWatchAccent(hex) {
  const norm = normalizeHex(hex);
  const bad = new Set(['#5b7cff', '#4464e8', '#f3efe6', '#ffffff', '#7c6cf2']);
  const chosen = (!norm || bad.has(norm.toLowerCase())) ? '#3b82f6' : norm;
  const [r, gr, b] = hexRgb(chosen);
  const lum = hexLuminance(chosen);
  const ink = lum > 0.42 ? '#070c1a' : '#ffffff';
  const root = document.documentElement.style;
  root.setProperty('--accent', chosen);
  root.setProperty('--accent-ink', ink);
  root.setProperty('--accent-hover', lum > 0.55 ? `rgb(${Math.max(0, r - 18)}, ${Math.max(0, gr - 18)}, ${Math.max(0, b - 18)})` : `rgb(${Math.min(255, r + 24)}, ${Math.min(255, gr + 24)}, ${Math.min(255, b + 24)})`);
  root.setProperty('--accent-soft', `rgba(${r}, ${gr}, ${b}, 0.16)`);
  root.setProperty('--accent-line', `rgba(${r}, ${gr}, ${b}, 0.42)`);
  const textColor = lum < 0.22 ? `rgb(${Math.round(r + (255 - r) * 0.48)}, ${Math.round(gr + (255 - gr) * 0.48)}, ${Math.round(b + (255 - b) * 0.48)})` : chosen;
  root.setProperty('--accent-text', textColor);
}
applyWatchAccent('');

const store = {
  get(k, d) { try { const v = localStorage.getItem('gather:w:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gather:w:' + k, JSON.stringify(v)); } catch {} },
};
let sess = store.get('sess:' + code, null);

async function api(action, body) {
  const r = await fetch(`/api/studio?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studio: code, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
  return j;
}
const creds = () => ({ vid: sess?.vid, vtok: sess?.vtok });
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; t.setAttribute('role', err ? 'alert' : 'status');
  $('#toasts').append(t); setTimeout(() => t.remove(), 3500);
}
const skey = () => 'sess:' + (W.code || code);
async function ensureSession() {
  if (sess) return sess;
  const r = await api('whello', { name: 'Viewer ' + Math.floor(1000 + Math.random() * 9000) });
  sess = { ...r, named: false }; store.set(skey(), sess);
  return sess;
}
async function renew() { sess = null; store.set(skey(), null); return ensureSession(); }

function clockText(since) {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n, i) => (i ? String(n).padStart(2, '0') : n)).join(':').replace(/^0:/, '');
}

// ---------------------------------------------------------------- Live Chat Mood Meter synced with viewer reactions
const MOOD_POS = new Set([
  'love', 'loved', 'loving', 'great', 'awesome', 'amazing', 'fire', 'nice', 'good', 'cool', 'best',
  'congrats', 'congratulations', 'happy', 'thanks', 'thank', 'helpful', 'brilliant', 'insane', 'w',
  'gg', 'pog', 'poggers', 'hype', 'hyped', 'lfg', 'letsgo', 'yes', 'yay', 'wow', 'beautiful',
  'clean', 'genius', 'super', 'excited', 'fun', 'enjoying', 'enjoyed', 'fav', 'favorite', 'respect',
  'clap', 'gem', 'goat', 'agreed', 'agree', 'true', 'facts', 'solid', 'epic', 'clutch', 'perfect',
  'incredible', 'unreal', 'sweet', 'dope', 'sick', 'lit', 'valid', 'smart', 'sharp', 'bright',
  'kind', 'welcome', 'cheers', 'bravo', 'win', 'winning', 'hilarious', 'funny', 'lmao', 'lol',
]);
const MOOD_NEG = new Set([
  'bad', 'hate', 'hated', 'worst', 'boring', 'awful', 'terrible', 'broken', 'lag', 'laggy', 'lagging',
  'muted', 'echo', 'glitch', 'glitching', 'bug', 'trash', 'cringe', 'sad', 'angry', 'mad', 'annoying',
  'dislike', 'confusing', 'confused', 'lost', 'ugly', 'slow', 'fail', 'failed', 'scam', 'fake', 'l',
  'stop', 'ugh', 'yikes', 'mid', 'awkward', 'unwatchable', 'toxic', 'spam', 'wrong', 'weak', 'sucks',
  'horrible', 'disappointed', 'rip', 'dead', 'freeze', 'frozen', 'stutter', 'noisy', 'loud',
]);
const MOOD_NEGATORS = new Set(['not', 'no', 'never', 'dont', "don't", 'cant', "can't", 'isnt', "isn't", 'wasnt', "wasn't", 'didnt', "didn't", 'hardly', 'barely']);
const MOOD_BOOST = new Set(['so', 'very', 'super', 'really', 'extremely', 'totally', 'mega', 'ultra', 'hella', 'incredibly', 'absolutely']);
const MOOD_EMOJI_POS = /[\u{2764}\u{1F9E1}\u{1F49B}\u{1F49A}\u{1F499}\u{1F49C}\u{1FA77}\u{1F90D}\u{1F525}\u{1F44F}\u{1F389}\u{1F64C}\u{1F973}\u{1F60D}\u{1F929}\u{1F604}\u{1F601}\u{1F60A}\u{1F602}\u{1F923}\u{1F4AF}\u{2728}\u{1F680}\u{1F44D}\u{1F64F}\u{1FAF6}\u{1F496}\u{1F3B6}\u{1F451}\u{1F3C6}]/gu;
const MOOD_EMOJI_NEG = /[\u{1F621}\u{1F92C}\u{1F44E}\u{1F494}\u{1F62D}\u{1F622}\u{1F61E}\u{1F614}\u{1F612}\u{1F644}\u{1F624}\u{1F922}\u{1F92E}\u{1F480}\u{1F629}\u{1F62B}\u{1F616}]/gu;

function scoreMessageSentiment(text, meta = {}) {
  const s = String(text || '');
  let raw = meta.paid ? 0.55 : 0;
  const posE = (s.match(MOOD_EMOJI_POS) || []).length;
  const negE = (s.match(MOOD_EMOJI_NEG) || []).length;
  raw += posE * 0.7 - negE * 0.8;
  const words = s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let hit = MOOD_POS.has(w) ? 1 : MOOD_NEG.has(w) ? -1 : 0;
    if (!hit) continue;
    const prev = i > 0 ? words[i - 1] : '';
    const prev2 = i > 1 ? words[i - 2] : '';
    if (MOOD_BOOST.has(prev)) hit *= 1.35;
    if (MOOD_NEGATORS.has(prev) || MOOD_NEGATORS.has(prev2)) hit *= -0.8;
    raw += hit;
  }
  const exclaims = Math.min(3, (s.match(/!/g) || []).length);
  if (raw > 0) raw += exclaims * 0.12;
  else if (raw < 0) raw -= exclaims * 0.1;
  return Math.tanh(raw * 0.65);
}

function syncMoodUI(state, label, pct, metaText) {
  const shortLbl = state === 'idle' ? 'Calm' : label;
  const rm = $('#wRoomMeter');
  if (rm) rm.dataset.mood = state;
  if ($('#wRoomLvl')) $('#wRoomLvl').textContent = shortLbl;
  if ($('#wRoomPct')) $('#wRoomPct').textContent = `${pct}%`;
  if ($('#wRoomBar')) $('#wRoomBar').style.width = `${pct}%`;
  if ($('#wRoomTrack')) $('#wRoomTrack').setAttribute('aria-valuenow', String(pct));
  if ($('#wRoomMeta') && metaText) $('#wRoomMeta').textContent = metaText;
}

function renderMoodMeter(info) {
  const rm = $('#wRoomMeter');
  if (!rm) return;
  const items = (info?.chat || W.recentChat || []).filter((m) => m && !W.muted.has(String(m.name).toLowerCase())).slice(-30);
  const reacts = info?.reacts || {};
  const reactTotal = Object.values(reacts).reduce((a, b) => a + b, 0);
  const hypeFactor = Math.min(1, (reactTotal + W.reactMomentum) / 25);

  if (!items.length && reactTotal === 0 && W.reactMomentum === 0) {
    syncMoodUI('idle', 'Calm', 50, 'Live energy synced with chat velocity & reactions');
    return;
  }

  let weighted = 0, wSum = 0, pos = 0;
  for (let i = 0; i < items.length; i++) {
    const sc = scoreMessageSentiment(items[i].text, items[i]);
    if (sc >= 0.2) pos++;
    const w = Math.pow(0.92, items.length - 1 - i);
    weighted += sc * w;
    wSum += w;
  }
  const chatAvg = wSum ? weighted / wSum : 0;
  const chatPct = Math.round(((chatAvg + 1) / 2) * 100);
  const reactWeight = items.length ? Math.min(0.45, 0.15 + hypeFactor * 0.3) : 1;
  const reactPct = Math.round(58 + hypeFactor * 40);
  const pct = Math.max(0, Math.min(100, Math.round(chatPct * (1 - reactWeight) + reactPct * reactWeight)));

  const state = pct >= 76 ? 'hype' : pct >= 60 ? 'warm' : pct >= 44 ? 'steady' : pct >= 28 ? 'mixed' : 'tense';
  const label = { hype: 'Hyped 🔥', warm: 'Upbeat', steady: 'Steady', mixed: 'Mixed', tense: 'Tense' }[state];
  const parts = [];
  if (items.length) parts.push(`${items.length} msg${items.length === 1 ? '' : 's'} (${pos} positive)`);
  if (reactTotal + W.reactMomentum > 0) parts.push(`${reactTotal + Math.round(W.reactMomentum)} reactions`);
  syncMoodUI(state, label, pct, parts.join(' · ') || 'Live energy synced with chat velocity & reactions');
}

// ---------------------------------------------------------------- feed (adaptive fast polling for crisp live chat)
let lastActivityAt = Date.now();
for (const ev of ['pointerdown', 'keydown', 'scroll']) addEventListener(ev, () => { lastActivityAt = Date.now(); }, { passive: true });
async function poll() {
  try {
    const r = await fetch(`/api/studio?action=wfeed&studio=${encodeURIComponent(code)}`);
    render(r.ok ? await r.json() : { found: false });
  } catch {
    $('#wv').classList.remove('sk-wait');
    window.gatherBoot?.done();
    $('#wEmptyH').textContent = 'Can’t reach gather right now. Retrying…';
  }
  const active = !document.hidden && (Date.now() - lastActivityAt < 45000);
  setTimeout(poll, document.hidden ? 8000 : active ? 750 : 2000);
}

function render(info) {
  if (info.found) {
    if (W.ended) setTimeout(startDirect, 0);
    W.last = { title: info.title, host: info.host, watch: info.watch, links: info.live?.links?.length ? info.live.links : W.last?.links || [] };
    W.ended = false;
  } else if (W.last && !info.unclaimed && !info.offline) {
    if (!W.ended) { W.ended = true; stopDirect(); W.direct.state = 'idle'; }
    info = { ...info, ended: true, title: W.last.title, host: W.last.host };
  }
  W.info = info;
  $('#wv').classList.toggle('ended', !!info.ended);
  $('#wv').classList.toggle('nofeed', !info.found && !info.ended);
  if ($('#wv').classList.contains('sk-wait')) {
    $('#wv').classList.remove('sk-wait');
    $$('#wMsgs .sk-row').forEach((r) => r.remove());
    window.gatherBoot?.done();
  }
  if (info.code && info.code !== W.code) { W.code = info.code; sess = store.get(skey(), null); }

  const title = info.found ? info.title || 'Live show' : info.ended ? `${info.title || 'The show'} · ended` : info.offline ? `${info.name} · offline` : info.unclaimed ? 'Nobody here yet' : 'Show not found';
  $('#wTitle').textContent = title;
  document.title = `${title} · Watch live`;
  applyWatchAccent(info.color || '');

  const live = !!(info.found && info.live?.on);
  const onAir = live || W.direct.state === 'live';
  $('#wLive').hidden = !onAir;
  $('#wv').classList.toggle('on-air', onAir);
  if (info.short && /^\/w\/gather-/.test(location.pathname)) history.replaceState(null, '', '/w/' + info.short + location.search);

  renderStreamType(info);
  renderHost(info);
  renderCreatorCard(info);
  renderShowcase(info);
  $('#wLiveText').textContent = live ? 'Live · ' + clockText(info.live.since) : 'On air';
  $('#wViewers').hidden = !info.found;
  $('#wViewers').textContent = info.viewers ? `${info.viewers} watching` : '';

  const w = info.watch || {};
  $('#wSuperBtn').hidden = !w.supers || w.chat === false;
  $('#wTipBtn').hidden = !w.supers || w.chat === false;
  if ($('#wTipBtn').hidden && !$('#wTipDock').hidden) closeTipDock();
  $('#wMic').hidden = w.voice === false || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
  $('#wChatState').textContent = !info.found ? '' : w.chat === false ? 'Chat off' : w.slow ? `Slow · ${w.slow}s` : '';
  $('#wCompose').hidden = !info.found || w.chat === false;

  W.recentChat = info.chat || [];
  renderChat(W.recentChat, info.gone || []);
  renderScTick(W.recentChat);
  renderRoom(info);
  renderGoal(info);
  $('#wChat').classList.toggle('quiet', !$('#wMsgs li.row, #wMsgs li.paid'));
  renderTops(W.recentChat);
  renderAbout(info);
  renderShopUI(info);
  renderLiveActs(info);
  renderMode(info);
  renderInteractive(info);
  renderParty(info);
  updateStageStatus(info);
  renderHype(info);
  renderMoodMeter(info);
  renderVertical(info);
  renderCaps(info);
  renderSources(info);
  floatReacts(info.reacts);
  syncHotSeatBtn(info);
  syncHudShell();
}

function renderChat(items, gone = []) {
  const log = $('#wMsgs'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  for (const id of gone) log.querySelector(`[data-id="${cssEsc(id)}"]`)?.remove(); // deleted, hidden or reported away
  for (const m of items) {
    if (W.muted.has(String(m.name).toLowerCase())) continue;
    const old = log.querySelector(`[data-id="${cssEsc(m.id)}"] .wv-like span`);
    if (old) old.textContent = m.likes ? String(m.likes) : '';
    const key = m.id + ':' + (m.status || '');
    if (W.shown.has(key)) continue;
    if (W.booted && sess?.named && m.name !== sess.name && new RegExp('@' + sess.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(m.text)) toast(`${m.name} mentioned you.`);
    W.shown.add(key);
    if (m.paid && m.sc && m.status === 'confirmed' && W.booted && Date.now() - (m.ts || 0) < 120_000) scCelebrate(m);
    else if (m.paid && m.sc) SCPOP.seen.add(m.sc); // already on screen before this page opened: no replay
    if (W.booted && $('#wv').classList.contains('no-chat')) {
      const u = $('#wUnread'); u.textContent = Math.min(99, (+u.textContent || 0) + 1); u.hidden = false;
    }
    log.querySelector(`[data-id="${cssEsc(m.id)}"]`)?.remove();
    log.querySelector(`[data-sc="${cssEsc(m.sc || '')}"]`)?.remove();
    log.append(msgEl(m));
  }
  while (log.children.length > 200) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight; else if (items.length) $('#wNewer').hidden = false;
  W.booted = true;
}
$('#wMsgs').addEventListener('scroll', () => { const l = $('#wMsgs'); if (l.scrollHeight - l.scrollTop - l.clientHeight < 40) $('#wNewer').hidden = true; });
$('#wNewer').onclick = () => { const l = $('#wMsgs'); l.scrollTop = l.scrollHeight; $('#wNewer').hidden = true; };

const NAME_COLORS = ['#7fa8ff', '#38bdf8', '#fbbf24', '#34d399', '#60a5fa', '#22d3ee', '#fb923c', '#f87171'];
const nameColor = (n) => NAME_COLORS[[...String(n)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLORS.length];

function msgEl(m) {
  const li = document.createElement('li');
  li.dataset.id = m.id; li.dataset.name = m.name; if (m.sc) li.dataset.sc = m.sc;
  if (m.sys) { li.className = 'sys'; li.textContent = m.text; return li; } // auction results, giveaway winners
  if (m.paid) li.className = 'paid' + (m.status === 'answered' ? ' answered' : '') + (m.status === 'pending' ? ' pending' : '');
  else li.className = 'row' + (m.q ? ' q' : '');
  const mine = sess?.named && m.name === sess.name;
  if (mine) li.classList.add('me');
  if (!mine && sess?.named && new RegExp('@' + sess.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(m.text)) li.classList.add('mention');
  if (m.paid) return paidEl(li, m);

  const av = document.createElement('span'); av.className = 'wv-av'; av.style.background = nameColor(m.name);
  if (m.av && /^data:image\/(jpeg|png|webp);base64,/.test(m.av)) {
    av.style.background = 'none';
    queueMicrotask(() => { const im = document.createElement('img'); im.src = m.av; im.alt = ''; replaceKids(av, im); });
  }
  av.textContent = (m.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  av.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  const head = document.createElement('div'); head.className = 'wv-mh';
  const b = document.createElement('b'); b.textContent = m.name; if (!mine) b.style.color = nameColor(m.name);
  const t = document.createElement('time'); const d = new Date(m.ts || Date.now()); t.dateTime = d.toISOString(); t.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  head.append(b);
  if (m.host) { const hp = document.createElement('span'); hp.className = 'wv-host-pill'; hp.textContent = 'Host'; head.append(hp); }
  head.append(t);
  if (m.q) { const q = document.createElement('span'); q.className = 'wv-qb'; q.innerHTML = '<svg class="i" aria-hidden="true"><use href="/icons.svg#i-hand"/></svg>Question'; head.append(q); }

  const lk = document.createElement('button'); lk.type = 'button'; lk.className = 'wv-like'; lk.dataset.likeFor = m.id;
  lk.setAttribute('aria-label', 'Like'); lk.setAttribute('aria-pressed', String(W.liked?.has(m.id) || false));
  lk.innerHTML = '<svg class="i" aria-hidden="true"><use href="/icons.svg#i-heart"/></svg><span></span>'; lk.querySelector('span').textContent = m.likes ? String(m.likes) : '';
  if (m?.id != null && String(m.id).startsWith('mine-')) lk.disabled = true; else lk.onclick = () => likeMsg(m?.id, lk);

  const gap = document.createElement('span'); gap.className = 'wv-sp';
  const acts = document.createElement('span'); acts.className = 'wv-acts';
  const mk = (icon, label, fn) => { const k = document.createElement('button'); k.type = 'button'; k.innerHTML = `<svg class="i" aria-hidden="true"><use href="/icons.svg#i-${icon}"/></svg>`; k.setAttribute('aria-label', label); k.title = label; k.onclick = fn; return k; };
  if (m?.id != null && !String(m.id).startsWith('mine-')) {
    acts.append(mk('reply', 'Reply', () => setReply(m)));
    if (mine) acts.append(mk('trash-2', 'Delete my message', () => deleteMsg(m.id, li)));
    else acts.append(mk('flag', 'Report', () => reportMsg(m.id, li)), mk('volume-x', `Mute ${m.name} for me`, () => muteName(m.name)));
  }
  head.append(gap, acts, lk);
  const txtNode = richText(m.text);
  if (W.lang && m.text) applyLiveTranslation(txtNode, m.text);
  if (m.re?.n) { const q = document.createElement('span'); q.className = 'wv-re'; q.textContent = `${m.re.n}: ${m.re.t || ''}`; body.append(head, q, txtNode); }
  else body.append(head, txtNode);
  li.append(av, body);
  return li;
}

/** A super chat in the chat list: coloured by amount, with the viewer's voice message if they recorded one. */
function paidEl(li, m) {
  const amt = Number(m.amount) || Number(String(m.paid).replace(/[^0-9.]/g, '')) || 0;
  li.dataset.tier = tierOf(amt);
  const head = document.createElement('div'); head.className = 'wv-pd-h';
  const av = document.createElement('span'); av.className = 'wv-av'; av.style.background = nameColor(m.name); av.setAttribute('aria-hidden', 'true');
  if (m.av && /^data:image\/(jpeg|png|webp);base64,/.test(m.av)) { const im = document.createElement('img'); im.src = m.av; im.alt = ''; av.style.background = 'none'; av.append(im); }
  else av.textContent = (m.name || '?').trim().slice(0, 1).toUpperCase();
  const b = document.createElement('b'); b.textContent = m.name;
  const a = document.createElement('span'); a.className = 'amt'; a.textContent = m.paid;
  head.append(av, b);
  if (m.bounty) { const k = document.createElement('span'); k.className = 'wv-pd-bounty'; k.textContent = '🎯 Bounty'; head.append(k); }
  if (m.status === 'pending') { const k = document.createElement('span'); k.className = 'wv-pd-wait'; k.textContent = 'waiting for the streamer'; head.append(k); }
  head.append(a);
  li.append(head);
  const txt = richText(m.text); txt.classList.add('wv-pd-t'); li.append(txt);
  if (m.voice && m.sc && !String(m.id).startsWith('mine-')) {
    const v = document.createElement('button'); v.type = 'button'; v.className = 'wv-pd-voice';
    v.innerHTML = '<svg class="i" aria-hidden="true"><use href="/icons.svg#i-play"/></svg><span></span>';
    v.querySelector('span').textContent = `Voice message · 0:${String(m.voice).padStart(2, '0')}`;
    v.onclick = () => playScVoice(m.sc, v);
    li.append(v);
  }
  if (m.status !== 'pending' && m.status !== 'dismissed') {
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'wv-moment-btn';
    shareBtn.textContent = '✨ Share moment';
    shareBtn.onclick = () => openMomentCard(m);
    li.append(shareBtn);
  }
  return li;
}
let scAudio = null;
async function playScVoice(id, btn) {
  if (scAudio?.id === id) { scAudio.a.pause(); scAudio = null; btn.classList.remove('on'); return; }
  scAudio?.a.pause(); $$('.wv-pd-voice.on').forEach((x) => x.classList.remove('on'));
  try {
    const { data } = await api('wscvoice', { studio: code, sc: id });
    const a = new Audio(data); scAudio = { a, id }; btn.classList.add('on');
    a.onended = () => { btn.classList.remove('on'); if (scAudio?.a === a) scAudio = null; };
    await a.play();
  } catch (e) { btn.classList.remove('on'); toast(e.message || 'Couldn’t play that voice message.', true); }
}

// ---- super chat pop-up: amount, name and message burst over the video with a cash-register sound
const SCPOP = { queue: [], busy: false, seen: new Set(store.get('scSeen:' + code, [])) };
function scCelebrate(m) {
  if (SCPOP.seen.has(m.sc)) return;
  SCPOP.seen.add(m.sc); store.set('scSeen:' + code, [...SCPOP.seen].slice(-100));
  SCPOP.queue.push(m); if (!SCPOP.busy) scNext();
}
function scNext() {
  const m = SCPOP.queue.shift(); const box = $('#wScPop');
  if (!m) { SCPOP.busy = false; box.hidden = true; return; }
  SCPOP.busy = true;
  const amt = Number(m.amount) || Number(String(m.paid).replace(/[^0-9.]/g, '')) || 0, tier = tierOf(amt);
  box.dataset.tier = tier; replaceKids(box);
  const card = document.createElement('div'); card.className = 'wv-scpop-card';
  const amtEl = document.createElement('div'); amtEl.className = 'wv-scpop-amt num'; amtEl.textContent = m.paid;
  const who = document.createElement('div'); who.className = 'wv-scpop-who'; who.textContent = `${m.name} ${m.bounty ? 'set a bounty' : m.voice ? 'sent a voice super chat' : 'sent a super chat'}`;
  const txt = document.createElement('div'); txt.className = 'wv-scpop-txt'; txt.textContent = m.text || '';
  card.append(amtEl, who); if (m.text) card.append(txt);
  const burst = document.createElement('div'); burst.className = 'wv-scpop-burst'; burst.setAttribute('aria-hidden', 'true');
  const glyphs = amt >= 50 ? ['💎', '💸', '✨', '🔥'] : amt >= 20 ? ['💸', '✨', '🎉'] : ['✨', '💵', '🎉'];
  for (let i = 0; i < Math.min(28, 10 + amt / 3); i++) {
    const p = document.createElement('i'); p.textContent = glyphs[i % glyphs.length];
    p.style.setProperty('--dx', (Math.random() * 2 - 1) * 46 + 'vmin'); p.style.setProperty('--dy', -(12 + Math.random() * 34) + 'vmin');
    p.style.setProperty('--r', (Math.random() * 540 - 270) + 'deg'); p.style.animationDelay = Math.random() * 0.25 + 's';
    burst.append(p);
  }
  box.append(burst, card); box.hidden = false;
  box.classList.remove('go'); void box.offsetWidth; box.classList.add('go');
  cashSound(amt);
  setTimeout(scNext, Math.min(9000, 4600 + (m.text || '').length * 30));
}
let scCtx = null;
/** A short synthesized "ka-ching" chime; bigger super chats get a longer, brighter run. Respects the player's mute. */
function cashSound(amt) {
  // Watching gather's own stream? The stream already carries the studio's sound. Otherwise (YouTube/Twitch embed) play it here.
  const v = W.direct?.video; if (store.get('scSound', true) === false || (v && !v.paused && v.srcObject)) return;
  try {
    scCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const ctx = scCtx, t0 = ctx.currentTime, notes = amt >= 50 ? [784, 988, 1175, 1568, 1976] : amt >= 20 ? [784, 988, 1319, 1568] : [880, 1319, 1760];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * 0.075;
      o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.55);
    });
  } catch {}
}
/** The strip of recent super chats along the top of the chat; tap one to jump to it. */
function renderScTick(items) {
  const paid = items.filter((m) => m.paid && m.status !== 'pending' && m.status !== 'dismissed').slice(-8).reverse();
  const box = $('#wScTick'); box.hidden = !paid.length;
  replaceKids(box, ...paid.map((m) => {
    const amt = Number(m.amount) || Number(String(m.paid).replace(/[^0-9.]/g, '')) || 0;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wv-sctick-chip'; b.dataset.tier = tierOf(amt);
    const a = document.createElement('b'); a.className = 'num'; a.textContent = m.paid;
    const n = document.createElement('span'); n.textContent = m.name;
    b.append(a, n); if (m.voice) { const ic = document.createElement('span'); ic.textContent = '🎙'; b.append(ic); }
    b.title = m.text || '';
    b.onclick = () => { const li = $(`#wMsgs [data-id="${cssEsc(m.id)}"]`); li?.scrollIntoView({ block: 'center', behavior: 'smooth' }); li?.classList.add('flash'); setTimeout(() => li?.classList.remove('flash'), 1600); };
    return b;
  }));
}

function richText(text) {
  const span = document.createElement('span'); span.className = 'wv-mt';
  const emotes = new Map((W.info?.emotes || []).map((e) => [e.name, e.asset]));
  for (const part of String(text).split(/(:[a-z0-9_]{2,20}:|@[^\s@]{1,24})/i)) {
    if (!part) continue;
    const em = part.match(/^:([a-z0-9_]{2,20}):$/i);
    if (em && emotes.has(em[1].toLowerCase())) { const im = document.createElement('img'); im.className = 'emote'; im.alt = part; im.title = part; im.src = emoteSrc(emotes.get(em[1].toLowerCase())); span.append(im); continue; }
    if (/^@/.test(part)) { const a = document.createElement('span'); a.className = 'at'; a.textContent = part; span.append(a); continue; }
    span.append(document.createTextNode(part));
  }
  return span;
}

function renderTops(items) {
  const by = new Map();
  for (const m of items) if (m.paid && m.status !== 'pending') by.set(m.name, (by.get(m.name) || 0) + Number(String(m.paid).replace(/[^0-9.]/g, '')));
  const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#wTops').hidden = !top.length;
  if ($('#wTopsWrap')) $('#wTopsWrap').hidden = !top.length;
  replaceKids($('#wTops'), ...top.map(([n, a], i) => { const s = document.createElement('span'); const amt = document.createElement('i'); amt.textContent = '$' + (Number.isInteger(a) ? a : a.toFixed(2)); s.append(amt, (i === 0 ? '👑 ' : '') + n); return s; }));
}

// ---------------------------------------------------------------- sources & direct WebRTC viewing
function renderSources(info) {
  const links = info.found && info.live?.on ? info.live.links || [] : [];
  const embeds = links.map((l) => ({ ...l, embed: embedFor(l.kind, l.url) })).filter((l) => l.embed);
  const tabs = [];
  if (W.direct.state !== 'off') tabs.push({ id: 'direct', label: 'Direct' });
  for (const l of embeds) tabs.push({ id: l.embed, label: nameOf(l) });
  if (W.source === 'direct' && W.direct.state === 'off' && embeds.length) W.source = embeds[0].embed;
  if (W.source !== 'direct' && !embeds.some((l) => l.embed === W.source)) W.source = 'direct';
  $('#wTabs').hidden = tabs.length < 2;
  const tkey = JSON.stringify(tabs);
  if (W.tabsKey !== tkey) {
    W.tabsKey = tkey;
    replaceKids($('#wTabs'), ...tabs.map((t) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.setAttribute('role', 'tab'); b.dataset.src = t.id;
      b.textContent = t.label; b.onclick = () => { W.source = t.id; renderSources(W.info); };
      return b;
    }));
  }
  for (const b of $('#wTabs').children) { const on = b.dataset.src === W.source; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  const lkey = JSON.stringify(links);
  if (W.linksKey !== lkey) {
    W.linksKey = lkey;
    replaceKids($('#wLinks'), ...links.map((l) => { const a = document.createElement('a'); a.className = 'btn sm ghost'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `Open on ${nameOf(l)}`; return a; }));
  }
  showPlayer(info);
}

function showPlayer(info) {
  const box = $('#wPlayer');
  queueMicrotask(() => renderStreamType(info));
  if (W.source === 'direct') {
    const v = W.direct.video;
    const playing = W.direct.state === 'live' && v;
    if (playing && v.parentElement !== box) replaceKids(box, v);
    box.hidden = !playing; W.iframe = '';
    $('#wCtrls').hidden = !playing; $('#wUnmute').hidden = !playing || !v.muted;
    $('#wEmpty').hidden = !!playing;
    $('#wEmptyActs').hidden = !!info.found;
    renderEmptyExtras(info);
    $('#wEmptyH').textContent = info.ended ? 'That’s a wrap.' : info.offline && info.next ? info.next.title : info.offline ? `${info.name} isn’t live right now.` : info.unclaimed ? `${location.host}/w/${info.handle} isn’t anyone’s page yet.` : !info.found ? 'This show isn’t on right now.' : W.direct.state === 'connecting' ? 'Connecting to the studio…' : W.direct.state === 'full' ? 'The direct stream is full right now.' : 'Waiting for the show to start.';
    $('#wEmptyP').textContent = info.offline && info.next ? countdownText(info.next.when) : info.ended ? `${info.host?.name || 'The host'} ended the show. Keep this page open: it starts playing by itself the next time they go live.` : info.offline ? 'Keep this page open — it starts playing by itself the moment they go on.' : info.unclaimed ? 'Claim it for free in the gather studio: Show → Your watch page.' : !info.found ? 'Check the link with the host.' : W.direct.state === 'full' ? 'Watch on one of the platforms below, or try again in a minute.' : 'This page starts playing by itself.';
  } else if (W.iframe !== W.source) {
    W.iframe = W.source;
    const f = document.createElement('iframe');
    f.src = W.source; f.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'; f.allowFullscreen = true; f.title = 'Live player';
    replaceKids(box, f); box.hidden = false; $('#wEmpty').hidden = true; $('#wUnmute').hidden = true; $('#wCtrls').hidden = true;
  }
}

async function startDirect() {
  const D = W.direct, gen = ++D.gen;
  if (!W.info?.found) return setTimeout(startDirect, 4000);
  D.state = 'connecting'; render(W.info);
  let r;
  try { await ensureSession(); r = await api('wrtcJoin', creds()); }
  catch (e) {
    if (e.status === 401) { await renew().catch(() => {}); }
    D.state = 'idle'; render(W.info); return setTimeout(() => gen === D.gen && startDirect(), e.status === 404 ? 8000 : 4000);
  }
  if (r.full) { D.state = r.reason === 'off' ? 'off' : 'full'; render(W.info); return setTimeout(() => gen === D.gen && startDirect(), 30000); }
  const pc = new RTCPeerConnection({ iceServers: r.iceServers || [] });
  D.pc = pc;
  const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = true; video.id = 'wDirect';
  const stream = new MediaStream(); video.srcObject = stream;
  pc.ontrack = (e) => { stream.addTrack(e.track); video.play().catch(() => {}); };
  video.addEventListener('loadeddata', () => {
    if (gen !== D.gen) return;
    D.state = 'live'; D.video = video; D.connectedAt = Date.now(); W.statsPrev = null;
    setAmbient(stream); render(W.info); setMuted(video.muted); if (W.q !== 'auto') setQuality(W.q);
  }, { once: true });
  pc.onicecandidate = (e) => { if (e.candidate) api('wrtcSignal', { ...creds(), data: { candidate: e.candidate } }).catch(() => {}); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected' && D.state !== 'live') D.state = 'connecting';
    if (['failed', 'closed'].includes(pc.connectionState) && gen === D.gen) { stopDirect(); setTimeout(startDirect, 3000); }
  };
  for (;;) {
    if (gen !== D.gen) return;
    let msgs = [];
    try { ({ msgs } = await api('wrtcPoll', creds())); } catch (e) { if (e.status === 401) { stopDirect(); await renew().catch(() => {}); return setTimeout(startDirect, 2000); } }
    for (const m of msgs) {
      const d = m.data || {};
      try {
        if (d.sdp) {
          await pc.setRemoteDescription(d.sdp);
          if (d.sdp.type === 'offer') { await pc.setLocalDescription(); await api('wrtcSignal', { ...creds(), data: { sdp: pc.localDescription } }); }
        } else if (d.candidate) await pc.addIceCandidate(d.candidate).catch(() => {});
        else if (d.bye) { stopDirect(); D.state = 'idle'; render(W.info); return setTimeout(startDirect, 5000); }
      } catch (err) { console.warn('direct signal', err); }
    }
    await new Promise((res) => setTimeout(res, D.state === 'live' ? 5000 : 400));
  }
}

function stopDirect() {
  const D = W.direct; D.gen++;
  try { D.pc?.close(); } catch {}
  D.pc = null; D.video = null; D.connectedAt = 0; W.statsPrev = null;
  if (D.state !== 'off' && D.state !== 'full') D.state = 'idle';
}

function setMuted(m) {
  const v = W.direct.video; if (!v) return;
  v.muted = m; if (!m) v.play().catch(() => {});
  $('#wUnmute').hidden = !m || W.source !== 'direct';
  $('#wMute use').setAttribute('href', '/icons.svg#i-volume-' + (m ? 'x' : '2'));
  $('#wMute').setAttribute('aria-label', m ? 'Unmute (M)' : 'Mute (M)');
}
$('#wUnmute').onclick = () => setMuted(false);
$('#wMute').onclick = () => setMuted(!W.direct.video?.muted);
$('#wVol').oninput = (e) => { const v = W.direct.video; if (!v) return; v.volume = Number(e.target.value); setMuted(v.volume === 0); };
$('#wPip').hidden = !document.pictureInPictureEnabled;
$('#wPip').onclick = async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await W.direct.video?.requestPictureInPicture(); } catch {} };

function setTheater(on) {
  const next = typeof on === 'boolean' ? on : !$('#wv').classList.contains('theater');
  $('#wv').classList.toggle('theater', next);
  $('#wTheaterBtn')?.setAttribute('aria-pressed', String(next));
}
if ($('#wTheaterBtn')) $('#wTheaterBtn').onclick = () => setTheater();

$('#wFull').onclick = () => {
  if (document.fullscreenElement) return document.exitFullscreen();
  setTheater(true);
  const go = $('#wv').requestFullscreen?.(); if (!go) return;
  go.catch(() => {});
};
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) setTheater(false); if (document.fullscreenElement && innerHeight > innerWidth) setFill(true); });
function toggleKeysPop(force) {
  const pop = $('#wKeysPop'), btn = $('#wKeysBtn');
  if (!pop || !btn) return;
  const next = typeof force === 'boolean' ? force : pop.hidden;
  pop.hidden = !next;
  btn.setAttribute('aria-expanded', String(next));
}
if ($('#wKeysBtn')) $('#wKeysBtn').onclick = (e) => { e.stopPropagation(); toggleKeysPop(); };
if ($('#wKeysClose')) $('#wKeysClose').onclick = () => toggleKeysPop(false);

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('#wStatsPop').hidden) toggleStatsPop(false);
    if ($('#wKeysPop') && !$('#wKeysPop').hidden) toggleKeysPop(false);
    if (!$('#wDrawerWrap').hidden) openHostDrawer(false);
    if ($('#wv').classList.contains('theater') && !document.fullscreenElement) setTheater(false);
  }
});

function setAmbient(stream) {
  const a = $('#wAmbientVid'); if (!a) return;
  a.srcObject = stream || null; $('#wv').classList.toggle('glow', !!stream);
  if (stream) a.play().catch(() => {});
}

function toggleChat() {
  const off = $('#wv').classList.toggle('no-chat');
  $('#wChatToggle').setAttribute('aria-pressed', String(off));
  $('#wChatToggle').setAttribute('aria-label', off ? 'Show chat (C)' : 'Hide chat (C)');
  store.set('noChat', off);
}
$('#wChatToggle').onclick = toggleChat;
$('#wChatCollapse').onclick = toggleChat;
$('#wChatReopen').onclick = () => { toggleChat(); $('#wUnread').hidden = true; $('#wUnread').textContent = ''; $('#wText')?.focus(); };
if (store.get('noChat', false) && innerWidth > 900) toggleChat();

$('#wPlayerWrap').addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') {
    $('#wPlayerWrap').classList.add('show-ctrls');
    clearTimeout(W.ctrlT);
    W.ctrlT = setTimeout(() => $('#wPlayerWrap').classList.remove('show-ctrls'), 3500);
  }
});
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return;
  const k = (e.key || '').toLowerCase();
  if (k === 'f') { e.preventDefault(); $('#wFull').click(); }
  else if (k === 'm') { e.preventDefault(); setMuted(!W.direct.video?.muted); }
  else if (k === 'c') { e.preventDefault(); toggleChat(); }
  else if (k === 'i') { e.preventDefault(); openHostDrawer($('#wDrawerWrap').hidden); }
  else if (k === 't') { e.preventDefault(); setTheater(); }
  else if (k === 'h') { e.preventDefault(); sendReact('❤️'); }
  else if (e.key === '?') { e.preventDefault(); toggleKeysPop(); }
});

// ---------------------------------------------------------------- Stream Stats HUD (Bitrate, Resolution/FPS, Latency, Loss, Uptime)
function toggleStatsPop(force) {
  const pop = $('#wStatsPop'), btn = $('#wStatsHud');
  const next = typeof force === 'boolean' ? force : pop.hidden;
  pop.hidden = !next;
  btn.setAttribute('aria-expanded', String(next));
}
$('#wStatsHud').onclick = (e) => { e.stopPropagation(); toggleStatsPop(); };
document.addEventListener('click', (e) => {
  if (!e.target.closest('#wHudWrap')) toggleStatsPop(false);
  if (!e.target.closest('.wv-keys-wrap')) toggleKeysPop(false);
});

function updateHudUptime() {
  const since = W.info?.live?.on ? W.info.live.since : W.direct.connectedAt;
  const el = $('#wStatUptime');
  if (el) el.textContent = since ? clockText(since) : '—';
}

function syncHudShell() {
  const wrap = $('#wHudWrap'), btn = $('#wStatsHud');
  if (!wrap || !btn) return;
  if (!W.info?.found) { wrap.hidden = true; $('#wDelay').hidden = true; return; }
  wrap.hidden = false;
  updateHudUptime();
  if (W.source === 'direct' && (!W.direct.pc || W.direct.state !== 'live')) {
    btn.classList.add('off');
    btn.classList.remove('warn');
    $('#wHudSummary').textContent = '';
  }
}

setInterval(async () => {
  const wrap = $('#wHudWrap'), btn = $('#wStatsHud');
  if (!W.info?.found) { wrap.hidden = true; $('#wDelay').hidden = true; return; }
  wrap.hidden = false;
  updateHudUptime();

  if (W.source !== 'direct') {
    $('#wDelay').hidden = true;
    btn.classList.remove('warn', 'off');
    const srcLabel = $('#wTabs [aria-selected="true"]')?.textContent || 'Embed';
    $('#wHudSummary').textContent = `${srcLabel} · Live`;
    $('#wHudMode').textContent = srcLabel;
    $('#wStatBitrate').textContent = 'Adaptive';
    $('#wStatLatency').textContent = 'Platform';
    $('#wStatRes').textContent = 'Auto';
    $('#wStatLoss').textContent = 'Managed';
    $('#wStatCodec').textContent = 'HLS';
    return;
  }

  const pc = W.direct.pc;
  if (!pc || W.direct.state !== 'live') {
    $('#wDelay').hidden = true;
    btn.classList.add('off');
    btn.classList.remove('warn');
    $('#wHudSummary').textContent = '';
    $('#wHudMode').textContent = 'Direct WebRTC';
    $('#wStatBitrate').textContent = '—';
    $('#wStatLatency').textContent = '—';
    $('#wStatRes').textContent = '—';
    $('#wStatLoss').textContent = '—';
    $('#wStatCodec').textContent = '—';
    return;
  }

  btn.classList.remove('off');
  try {
    let rtt = 0, buf = 0, vBytes = 0, aBytes = 0, ts = 0, vw = 0, vh = 0, fps = 0, lost = 0, recvd = 0, jitter = 0, codecId = '';
    const codecs = new Map();
    const stats = await pc.getStats();
    stats.forEach((r) => {
      if (r.type === 'codec') codecs.set(r.id, String(r.mimeType || '').replace(/^(video|audio)\//i, ''));
      if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime;
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        vBytes = r.bytesReceived || 0;
        ts = r.timestamp || performance.now();
        vw = r.frameWidth || W.direct.video?.videoWidth || 0;
        vh = r.frameHeight || W.direct.video?.videoHeight || 0;
        fps = r.framesPerSecond || 0;
        lost = r.packetsLost || 0;
        recvd = r.packetsReceived || 0;
        jitter = r.jitter || 0;
        codecId = r.codecId || '';
        if (r.jitterBufferEmittedCount) buf = r.jitterBufferDelay / r.jitterBufferEmittedCount;
      }
      if (r.type === 'inbound-rtp' && r.kind === 'audio') aBytes = r.bytesReceived || 0;
    });

    const totalBytes = vBytes + aBytes;
    let bps = 0;
    if (W.statsPrev && ts > W.statsPrev.ts && totalBytes >= W.statsPrev.bytes) {
      bps = ((totalBytes - W.statsPrev.bytes) * 8) / ((ts - W.statsPrev.ts) / 1000);
    }
    W.statsPrev = { bytes: totalBytes, ts };

    const d = rtt / 2 + buf + 0.05;
    $('#wDelay').hidden = false;
    $('#wDelay').textContent = `Direct · ${d.toFixed(1)} s`;
    $('#wDelay').classList.toggle('slow', d > 1.5);

    const bitrateTxt = bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : bps > 0 ? `${Math.round(bps / 1000)} kbps` : 'Syncing…';
    const resTxt = vh ? `${vh}p${fps ? Math.round(fps) : ''}` : vw ? `${vw}px` : 'Live';
    const lossPct = recvd + lost > 0 ? ((lost / (recvd + lost)) * 100).toFixed(1) : '0.0';
    const codecName = codecs.get(codecId) || 'VP8/VP9';

    btn.classList.toggle('warn', d > 1.5 || Number(lossPct) > 2);
    $('#wHudSummary').textContent = `${bps > 0 ? bitrateTxt + ' · ' : ''}${resTxt} · ${d.toFixed(1)}s`;
    $('#wHudMode').textContent = 'Direct WebRTC';
    $('#wStatBitrate').textContent = bitrateTxt;
    $('#wStatLatency').textContent = `${Math.round(d * 1000)} ms (${d.toFixed(1)}s)`;
    $('#wStatRes').textContent = vh && vw ? `${vw}×${vh}${fps ? ` @ ${Math.round(fps)}fps` : ''}` : resTxt;
    $('#wStatLoss').textContent = `${lossPct}% · ${Math.round(jitter * 1000)}ms`;
    $('#wStatCodec').textContent = codecName.toUpperCase();
  } catch {}
}, 2000);

addEventListener('pagehide', () => {
  if (sess && W.direct.pc) navigator.sendBeacon?.('/api/studio?action=wrtcLeave', new Blob([JSON.stringify({ studio: code, ...creds() })], { type: 'application/json' }));
});

// ---------------------------------------------------------------- One-tap Reaction Dock & Live Hype Pulse
function initReactionDock() {
  const dock = $('#wReactDock');
  if (!dock) return;
  replaceKids(dock, ...REACTS.map((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wv-react-btn';
    b.textContent = e;
    b.setAttribute('aria-label', `React with ${e}`);
    b.title = `Send ${e}`;
    b.onclick = () => sendReact(e);
    return b;
  }));
}
initReactionDock();

function floatOne(e) {
  const s = document.createElement('span');
  s.textContent = e;
  s.style.right = 14 + Math.random() * 52 + 'px';
  $('#wFloats').append(s);
  setTimeout(() => s.remove(), 2600);
}

function floatReacts(r) {
  if (!r) return;
  const prev = W.lastReacts; W.lastReacts = r;
  if (!prev) return;
  for (const e of REACTS) {
    const n = Math.min(4, Math.max(0, (r[e] || 0) - (prev[e] || 0) - (W.mine[e] || 0)));
    for (let i = 0; i < n; i++) setTimeout(() => floatOne(e), i * 220);
  }
  W.mine = {};
}
W.mine = {};

function sendReact(e) {
  floatOne(e);
  W.mine[e] = (W.mine[e] || 0) + 1;
  W.reactMomentum = Math.min(35, W.reactMomentum + 2);
  renderHype(W.info || {});
  renderMoodMeter(W.info || {});

  W.combo = W.comboE === e && Date.now() - W.comboT < 1200 ? W.combo + 1 : 1;
  W.comboE = e; W.comboT = Date.now();
  const c = $('#wCombo');
  if (W.combo > 1) {
    c.hidden = false; c.textContent = `${e} ×${W.combo}`;
    c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
  }
  clearTimeout(W.comboHide); W.comboHide = setTimeout(() => { c.hidden = true; }, 1300);

  W.pendingReacts = (W.pendingReacts || 0) + 1;
  if (W.reactT) return;
  W.reactT = setTimeout(async () => {
    W.reactT = null;
    const n = Math.min(5, W.pendingReacts);
    W.pendingReacts = 0;
    try { await ensureSession(); for (let i = 0; i < n; i++) await api('wsend', { ...creds(), type: 'react', emoji: e }); awardXp(1); } catch {}
  }, 600);
}

setInterval(() => {
  if (W.reactMomentum > 0) {
    W.reactMomentum = Math.max(0, W.reactMomentum - 1.5);
    renderHype(W.info || {});
    renderMoodMeter(W.info || {});
  }
}, 1500);

$('#wHeart').onclick = () => sendReact('❤️');
$('#wHeart').oncontextmenu = (ev) => { ev.preventDefault(); $('#wReactPick').hidden = !$('#wReactPick').hidden; };
{
  let hold = 0;
  $('#wHeart').addEventListener('pointerdown', () => { hold = setTimeout(() => { $('#wReactPick').hidden = false; }, 450); });
  for (const ev of ['pointerup', 'pointerleave']) $('#wHeart').addEventListener(ev, () => clearTimeout(hold));
}
replaceKids($('#wReactPick'), ...REACTS.map((e) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', 'React ' + e);
  b.onclick = () => { sendReact(e); $('#wReactPick').hidden = true; };
  return b;
}));

function renderHype(info) {
  // Merged into the single Room meter via renderMoodMeter; keep hype boost responsive.
  if (W.reactMomentum > 0) renderMoodMeter(info);
}

// ---------------------------------------------------------------- chat
function showErr(sel, msg) { const e = $(sel); e.textContent = msg || ''; e.hidden = !msg; }
function renderMe() {
  const me = $('#wMe');
  if (!me) return;
  const nm = ACCT?.user?.name || (sess?.named ? sess.name : '');
  me.textContent = nm || 'Sign in';
  me.classList.toggle('signed', !!(ACCT?.user || sess?.named));
}

let naming = null;
async function setName(name) {
  naming = (async () => {
    await ensureSession();
    sess = { ...(await api('whello', { ...creds(), name, ...acctBody() })), named: true };
    store.set('sess:' + code, sess); store.set('name', name); renderMe();
  })();
  try { await naming; } finally { naming = null; }
}
async function submitGuestBar() {
  const name = $('#wName').value.trim();
  if (!name) return showErr('#wNameErr', 'Enter a name.');
  showErr('#wNameErr', '');
  $('#wGuestBar').hidden = true;
  $('#wMe').textContent = name;
  $('#wText').focus();
  try { await setName(name); const next = W.guestThen; W.guestThen = null; next?.(); }
  catch (err) { renderMe(); showErr('#wNameErr', err.message); $('#wGuestBar').hidden = false; $('#wName').focus(); }
}
$('#wGuestSave')?.addEventListener('click', submitGuestBar);
$('#wGuestCancel')?.addEventListener('click', () => { $('#wGuestBar').hidden = true; showErr('#wNameErr', ''); W.guestThen = null; $('#wText').focus(); });
$('#wName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitGuestBar(); }
  else if (e.key === 'Escape') { e.preventDefault(); $('#wGuestCancel')?.click(); }
});
$('#wCompose').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#wText').value.trim();
  if (!text) return;
  showErr('#wErr', '');
  if (!ACCT.user && !sess?.named) { ACCT.then = () => $('#wCompose').requestSubmit(); return openSignIn(); }
  try {
    if (ACCT.user && !sess?.signed) await joinSigned();
    if (naming) await naming.catch(() => {});
    await ensureSession(); renderMe();
    const asking = $('#wAsk').getAttribute('aria-pressed') === 'true';
    const re = W.reply ? { n: W.reply.name, t: String(W.reply.text || '').slice(0, 80) } : undefined;
    const r = await api('wsend', { ...creds(), type: asking ? 'question' : 'chat', text, re });
    setReply(null);
    if (asking) { setAsk(false); toast('Question sent. The host sees it highlighted.'); }
    $('#wText').value = '';
    W.shown.add(r.id + ':');
    const item = { id: r.id, name: sess.name, text, ts: Date.now(), q: asking, av: ACCT.av, re };
    W.recentChat = [...W.recentChat, item].slice(-80);
    awardXp(2);
    $('#wMsgs').append(msgEl(item)); $('#wMsgs').scrollTop = $('#wMsgs').scrollHeight;
    renderMoodMeter(W.info);
  } catch (err) {
    if (err.status === 401) { await renew().catch(() => {}); return showErr('#wErr', 'Your chat session ended. Send again.'); }
    showErr('#wErr', err.message);
  }
});

// ---------------------------------------------------------------- super chats (single unified inline tray)
const SC = { amount: 5, method: '', opened: false };
$('#wSuperBtn').onclick = () => openTipDock();

// ---------------------------------------------------------------- super chat in the chat input
// The same direct payment as the dialog (the streamer's own PayPal / Venmo / Cash App / Stripe link; gather never
// touches the money), but inline: the message you're typing becomes the super chat.
const tierOf = (a) => (a >= 50 ? 'rose' : a >= 20 ? 'amber' : a >= 10 ? 'emerald' : 'blue');
function tipRender() {
  const w = W.info?.watch || {};
  const methods = Object.keys(PAY).filter((m) => (m === 'card' ? w.card : w.pay?.[m]));
  if (!methods.includes(SC.method)) SC.method = methods[0] || '';
  const min = w.min || 2;
  SC.amount = Math.max(SC.amount, min);
  const amounts = [...new Set([min, 5, 10, 20, 50, 100].filter((a) => a >= min))].slice(0, 5);
  replaceKids($('#wTipAmts'), ...amounts.map((a) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.tier = tierOf(a); b.className = 'num'; b.textContent = '$' + a;
    b.setAttribute('aria-checked', String(a === SC.amount)); b.onclick = () => { SC.amount = a; SC.opened = false; const c = $('#wTipCustom'); if (c) c.value = ''; tipRender(); };
    return b;
  }), (() => {
    const c = Object.assign(document.createElement('input'), { className: 'input num', id: 'wTipCustom', type: 'number', min: String(min), max: '10000', step: '1', placeholder: 'Other', inputMode: 'decimal' });
    c.setAttribute('aria-label', 'Other amount in dollars');
    if (!amounts.includes(SC.amount)) c.value = String(SC.amount);
    c.oninput = () => { const v = Math.round(Number(c.value)); if (v >= min) { SC.amount = v; SC.opened = false; tipSync(); } };
    return c;
  })());
  replaceKids($('#wTipMethods'), ...methods.map((m) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.m = m; b.textContent = m === 'card' ? '💳 Card · Apple Pay' : m === 'stripe' ? 'Stripe link' : PAY[m].label;
    b.onclick = () => { SC.method = m; SC.opened = false; tipSync(); };
    return b;
  }));
  $('#wTipSub').textContent = `Paid straight to ${W.info?.host?.name || 'the streamer'}`;
  $('#wTipRec').hidden = !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || w.voice === false;
  tipSync();
}
function tipSync() {
  $$('#wTipAmts button').forEach((b) => b.setAttribute('aria-checked', String(b.textContent === '$' + SC.amount)));
  $$('#wTipMethods button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === SC.method)));
  $('#wTipDock').dataset.tier = tierOf(SC.amount);
  const onsite = !!PAY[SC.method]?.onsite;
  const label = SC.method === 'stripe' ? 'card' : onsite ? '' : PAY[SC.method]?.label || '';
  $('#wTipPay').textContent = SC.opened ? `Open ${label} again` : `${onsite ? 'Pay' : 'Pay'} $${SC.amount}${label ? ' with ' + label : ''}`;
  $('#wTipSend').hidden = onsite;
  $('#wTipDock').classList.toggle('onsite', onsite);
  $('#wTipSend').disabled = !SC.opened;
  $('#wTipSend').textContent = `I’ve paid · send $${SC.amount}`;
  const msg = $('#wTipMsg').value.trim();
  $('#wTipCount').textContent = `${$('#wTipMsg').value.length}/${$('#wTipMsg').maxLength}`;
  $('#wTipNote').textContent = onsite ? `Pay here without leaving. ${TV.blob ? 'Your voice message and ' : ''}${msg ? 'message' : 'super chat'} pops up on screen the moment it’s paid.`
    : SC.opened
    ? `Paid? Send it and it goes on screen as soon as the streamer sees your $${SC.amount}.`
    : $('#wBounty')?.checked ? (msg ? `Bounty: “${msg.slice(0, 60)}${msg.length > 60 ? '…' : ''}”, on stream once the streamer accepts it.` : 'Type the challenge above, e.g. “win a round with pistols only”.')
    : 'Pay in the app that opens, then come back and tap “I’ve paid”. It goes on screen once the streamer sees it.';
}
function openTipDock() {
  const w = W.info?.watch || {};
  if (!w.supers) return;
  SC.opened = false; showErr('#wTipErr', '');
  $('#wTipDock').hidden = false; $('#wTipBtn').setAttribute('aria-expanded', 'true'); $('#wTipBtn').classList.add('on');
  $('#wTipMsg').value ||= $('#wText').value.trim(); // anything typed in the chat box comes along
  tipRender();
  setTimeout(() => $('#wTipMsg').focus(), 30);
}
function closeTipDock() {
  $('#wTipDock').hidden = true; $('#wTipBtn').setAttribute('aria-expanded', 'false'); $('#wTipBtn').classList.remove('on');
  checkoutClose(); if (TV.rec?.state === 'recording') TV.rec.stop();
}
$('#wTipBtn').onclick = () => ($('#wTipDock').hidden ? openTipDock() : closeTipDock());
$('#wTipX').onclick = closeTipDock;
$('#wBounty').addEventListener('change', () => { $('#wTipDock').classList.toggle('bounty', $('#wBounty').checked); tipSync(); });
$('#wTipMsg').addEventListener('input', () => tipSync());

// ---- voice message attached to a super chat (up to 20 s)
const TV = { rec: null, chunks: [], stream: null, t0: 0, timer: null, blob: null, data: '', dur: 0 };
async function tipRecStart() {
  try { TV.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return showErr('#wTipErr', 'Allow the microphone to record a voice message (the lock icon in the address bar).'); }
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  TV.chunks = []; TV.rec = new MediaRecorder(TV.stream, { mimeType: mime, audioBitsPerSecond: 32000 });
  TV.rec.ondataavailable = (e) => { if (e.data.size) TV.chunks.push(e.data); };
  TV.rec.onstop = tipRecStopped;
  TV.rec.start(250); TV.t0 = Date.now();
  $('#wTipRec').classList.add('on'); $('#wTipRecLabel').textContent = 'Recording… tap to stop';
  TV.timer = setInterval(() => { const s = Math.floor((Date.now() - TV.t0) / 1000); $('#wTipRecTime').textContent = `0:${String(s).padStart(2, '0')} / 0:20`; if (s >= 20) TV.rec?.stop(); }, 200);
}
async function tipRecStopped() {
  clearInterval(TV.timer); TV.stream?.getTracks().forEach((t) => t.stop()); TV.stream = null;
  $('#wTipRec').classList.remove('on');
  TV.dur = Math.min(20, Math.round((Date.now() - TV.t0) / 1000));
  if (TV.dur < 1) return tipRecClear();
  TV.blob = new Blob(TV.chunks, { type: (TV.rec.mimeType || 'audio/webm').split(';')[0] });
  TV.data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(TV.blob); });
  $('#wTipRecPlay').src = URL.createObjectURL(TV.blob); $('#wTipRecPlay').hidden = false; $('#wTipRecX').hidden = false; $('#wTipRec').hidden = true;
  tipSync();
}
function tipRecClear() {
  TV.blob = null; TV.data = ''; TV.dur = 0;
  $('#wTipRecPlay').hidden = true; $('#wTipRecPlay').removeAttribute('src'); $('#wTipRecX').hidden = true; $('#wTipRec').hidden = false;
  $('#wTipRecLabel').textContent = 'Add a voice message'; $('#wTipRecTime').textContent = 'up to 20 s';
  tipSync();
}
$('#wTipRec').onclick = () => (TV.rec?.state === 'recording' ? TV.rec.stop() : tipRecStart());
$('#wTipRecX').onclick = tipRecClear;
const tipBody = () => ({ amount: SC.amount, text: $('#wTipMsg').value.trim(), ...($('#wBounty').checked ? { bounty: true } : {}), ...(TV.data ? { voice: TV.data, dur: TV.dur } : {}) });
function tipSent(id, pending) {
  const text = $('#wTipMsg').value.trim();
  $('#wBounty').checked = false; $('#wTipDock').classList.remove('bounty'); $('#wTipMsg').value = ''; tipRecClear(); closeTipDock();
  if (pending) {
    $('#wMsgs').append(msgEl({ id: 'mine-' + id, sc: id, name: sess.name, text: text || 'Waiting for the streamer to confirm your super chat…', paid: '$' + SC.amount, amount: SC.amount, status: 'pending' }));
    $('#wMsgs').scrollTop = $('#wMsgs').scrollHeight;
  }
  awardXp(Math.min(50, 5 + Math.round(SC.amount)));
}

// ---- on-site card checkout (Stripe's embedded checkout, on the streamer's own Stripe account)
let stripeJs = null, checkout = null;
function loadStripe() {
  stripeJs ||= new Promise((res, rej) => { if (window.Stripe) return res(window.Stripe); const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = () => res(window.Stripe); s.onerror = () => { stripeJs = null; rej(new Error('Couldn’t load the card form. Check your connection.')); }; document.head.append(s); });
  return stripeJs;
}
function checkoutClose() { try { checkout?.destroy(); } catch {} checkout = null; $('#wCheckout').hidden = true; replaceKids($('#wCheckout')); $('#wTipDock').classList.remove('paying'); }
async function payOnSite() {
  showErr('#wTipErr', '');
  if ($('#wBounty').checked && !$('#wTipMsg').value.trim()) { $('#wTipMsg').focus(); return showErr('#wTipErr', 'Type the challenge first.'); }
  const btn = $('#wTipPay'); btn.disabled = true; btn.textContent = 'Opening secure checkout…';
  try {
    await ensureSession();
    if (!sess?.named) { if (ACCT.user) await joinSigned(); else { ACCT.then = () => payOnSite(); return openSignIn(); } }
    const [Stripe, r] = await Promise.all([loadStripe(), api('wcheckout', { ...creds(), ...tipBody() })]);
    checkoutClose();
    const box = $('#wCheckout'); box.hidden = false; $('#wTipDock').classList.add('paying');
    const stripe = Stripe(r.pk, { stripeAccount: r.account });
    checkout = await stripe.initEmbeddedCheckout({ fetchClientSecret: async () => r.clientSecret, onComplete: () => checkoutDone(r.id) });
    checkout.mount(box);
  } catch (e) { showErr('#wTipErr', e.message); }
  finally { btn.disabled = false; tipSync(); }
}
async function checkoutDone(id) {
  for (let i = 0; i < 8; i++) {
    try { const r = await api('wcheckdone', { ...creds(), sc: id }); if (r.status === 'confirmed') { toast(`Paid! Your $${SC.amount} super chat is on screen.`); tipSent(id, false); poll?.(); return; } } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  toast('Payment received. Your super chat will appear in a moment.');
  tipSent(id, false);
}
$('#wTipPay').onclick = async () => {
  if (PAY[SC.method]?.onsite) return payOnSite();
  const w = W.info?.watch || {}, handle = w.pay?.[SC.method];
  if (!handle) return showErr('#wTipErr', 'The streamer hasn’t set up a payment method yet.');
  try { await ensureSession(); } catch {}
  window.open(PAY[SC.method].link(handle, SC.amount, `Super chat on gather: ${($('#wTipMsg').value || '').slice(0, 60)}`), '_blank', 'noopener');
  SC.opened = true; tipSync();
};
$('#wTipSend').onclick = async () => {
  showErr('#wTipErr', '');
  try {
    await ensureSession();
    if (!sess?.named) { if (ACCT.user) await joinSigned(); else { ACCT.then = () => $('#wTipSend').click(); return openSignIn(); } }
    if ($('#wBounty').checked && !$('#wTipMsg').value.trim()) { $('#wTipMsg').focus(); return showErr('#wTipErr', 'Type the challenge first.'); }
    const r = await api('wsend', { ...creds(), type: 'super', method: SC.method, ...tipBody() });
    tipSent(r.id, true);
    toast(`Sent. Your $${SC.amount} super chat pops up on screen once the streamer sees the payment.`);
  } catch (err) { showErr('#wTipErr', err.message); }
};
$$('button[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));

$('#wShare').onclick = async () => {
  const url = location.origin + location.pathname;
  try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast(url); }
};

renderMe();
if (code) {
  poll();
  startDirect();
  setInterval(() => {
    if (W.info?.live?.on) $('#wLiveText').textContent = 'Live · ' + clockText(W.info.live.since);
    updateHudUptime();
  }, 1000);
  setInterval(() => {
    if (sess) api('wping', creds()).catch(() => {});
    if ($('#wLive').hidden === false && W.info?.live?.since) $('#wLiveText').textContent = 'Live · ' + clockText(W.info.live.since);
  }, 30000);
} else render({ found: false });

// ---------------------------------------------------------------- Host Drawer & Tabs (Chat | Stage | Shop)
function openHostDrawer(on) {
  const wrap = $('#wDrawerWrap');
  if (!wrap) return;
  wrap.hidden = !on;
  $('#wInfoBtn')?.setAttribute('aria-expanded', String(!!on));
  if (on) $('#wDrawerClose')?.focus();
}
$('#wInfoBtn').onclick = () => openHostDrawer($('#wDrawerWrap').hidden);
$('#wDrawerClose').onclick = () => openHostDrawer(false);
$('#wDrawerBack').onclick = () => openHostDrawer(false);

function syncRailStrip() {
  const info = W.info || {};
  const on = !!info.found;
  const pin = on ? (info.watch?.pin || '') : '';
  const alertOpen = !$('#wStageAlert').hidden;
  const pinBtn = $('#wPinMiniBtn'), hereBtn = $('#wHereMiniBtn');
  if (pinBtn) {
    pinBtn.hidden = alertOpen || !pin;
    if (pin && $('#wPinMiniTxt')) $('#wPinMiniTxt').textContent = pin;
  }
  const n = on ? info.viewers || 0 : 0;
  if (hereBtn) {
    hereBtn.hidden = alertOpen || !!pin || n < 1;
    if (n >= 1 && $('#wHereMiniN')) $('#wHereMiniN').textContent = `${n.toLocaleString()} watching`;
  }
}

function setTab(tab) {
  tab = tab === true ? 'about' : tab === false ? 'chat' : tab;
  W.tab = tab;
  $('#wChat').classList.toggle('about', tab === 'about');
  $('#wChat').classList.toggle('shop', tab === 'shop');
  $('#wChat').classList.toggle('stage', tab === 'stage');
  $('#wChat').classList.toggle('pulse', tab === 'pulse');
  $('#wAbout').hidden = tab !== 'about';
  $('#wShop').hidden = tab !== 'shop';
  $('#wStagePanel').hidden = tab !== 'stage';
  if ($('#wPulsePanel')) $('#wPulsePanel').hidden = tab !== 'pulse';
  for (const [id, t] of [['#wTabChat', 'chat'], ['#wTabStage', 'stage'], ['#wTabPulse', 'pulse'], ['#wTabShop', 'shop'], ['#wTabAbout', 'about']]) {
    $(id)?.setAttribute('aria-selected', String(tab === t));
  }
  if (tab === 'stage') $('#wStageAlert').hidden = true;
  syncRailStrip();
}
$('#wTabChat').onclick = () => setTab('chat');
$('#wTabStage').onclick = () => setTab('stage');
if ($('#wTabPulse')) $('#wTabPulse').onclick = () => setTab('pulse');
$('#wTabShop').onclick = () => setTab('shop');
$('#wTabAbout').onclick = () => setTab('about');
$('#wAboutShare').onclick = () => $('#wShare').click();
$('#wStageAlertGo').onclick = () => setTab('stage');
$('#wStageAlertX').onclick = () => { W.dismissedAlertKey = $('#wStageAlert').dataset.key || ''; $('#wStageAlert').hidden = true; syncRailStrip(); };
if ($('#wPinMiniBtn')) $('#wPinMiniBtn').onclick = () => setTab('pulse');
if ($('#wHereMiniBtn')) $('#wHereMiniBtn').onclick = () => setTab('pulse');

function updateStageStatus(info) {
  const cards = $('#wCards').children.length;
  const badge = $('#wStageBadge');
  badge.hidden = cards === 0;
  badge.textContent = String(cards);
  const sale = info?.shop?.sale && info.shop.sale.until > Date.now() ? info.shop.sale : null;
  badge.classList.toggle('hot', !!(sale || W.called));

  // Surface a slim one-line banner in Chat when something active is happening on Stage
  let msg = '', alertKey = '';
  if (W.called) { msg = '🎮 You’re up next! Open Stage to join.'; alertKey = 'called'; }
  else if (sale) { msg = `⚡ Flash sale active${sale.pct ? ` (${sale.pct}% off)` : ''}`; alertKey = 'sale:' + sale.id + ':' + sale.until; }
  else if (info?.poll && info.poll.until > Date.now()) { msg = `📊 ${info.poll.q}`; alertKey = 'poll:' + info.poll.id; }
  else if (info?.queue?.open) { msg = `🎮 Play-with-me queue is open (${info.queue.size})`; alertKey = 'queue:open'; }

  if (W.modeType && alertKey !== 'called') msg = ''; // the shop / play-along panel already shows it
  const alert = $('#wStageAlert');
  if (msg && W.tab === 'chat' && W.dismissedAlertKey !== alertKey) {
    alert.dataset.key = alertKey;
    $('#wStageAlertTxt').textContent = msg;
    alert.hidden = false;
  } else {
    alert.hidden = true;
  }
  syncRailStrip();
}

function renderAbout(info) {
  const w = info.watch || {};
  $('#wAboutTitle').textContent = info.title || 'Live show';
  const bits = [info.live?.on ? `Live for ${clockText(info.live.since)}` : W.direct.state === 'live' ? 'On air now' : 'Not on air', info.viewers ? `${info.viewers} watching` : ''].filter(Boolean);
  $('#wAboutMeta').textContent = bits.join(' · ');
  $('#wAboutText').textContent = w.about || 'The host hasn’t written a description yet.';
  const links = [...(w.links || []), ...((info.live?.on && info.live.links) || []).map((l) => ({ label: 'Also live on ' + nameOf(l), url: l.url }))];
  const key = JSON.stringify(links);
  if (W.aboutKey === key) return;
  W.aboutKey = key;
  replaceKids($('#wAboutLinks'), ...links.map((l) => {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = l.url; a.target = '_blank'; a.rel = 'noopener nofollow'; a.textContent = l.label;
    const host = document.createElement('span'); try { host.textContent = new URL(l.url).hostname.replace(/^www\./, ''); } catch {}
    a.append(host); li.append(a); return li;
  }));
}

// ---------------------------------------------------------------- Captions, Quality, Fill
W.cc = store.get('cc', false);
function renderCaps(info) {
  const onStage = !!info.capsOnStage, b = $('#wCC');
  b.disabled = onStage; b.setAttribute('aria-pressed', String(W.cc && !onStage));
  b.dataset.tip = onStage ? 'Captions are already on screen' : 'Captions';
  const line = (info.caps || []).slice(-1)[0];
  const show = W.cc && !onStage && line && Date.now() - line.ts < 9000;
  $('#wCaps').hidden = !show;
  if (show) {
    const span = document.createElement('span');
    span.textContent = line.text;
    replaceKids($('#wCaps'), Object.assign(document.createElement('b'), { textContent: line.name }), span);
    if (W.lang) applyLiveTranslation(span, line.text);
  }
}
$('#wCC').onclick = () => { W.cc = !W.cc; store.set('cc', W.cc); if (W.info) renderCaps(W.info); if (W.cc && !(W.info?.caps || []).length) toast('Captions show here when the host turns on live captions.'); };

const QUALS = ['auto', '720', '480', '360'];
W.q = store.get('quality', 'auto');
function setQuality(q) {
  W.q = q; store.set('quality', q);
  $('#wQual').textContent = q === 'auto' ? 'Quality · Auto' : `Quality · ${q}p`;
  if (sess && W.direct.state === 'live') api('wrtcSignal', { ...creds(), data: { quality: q === 'auto' ? '720' : q } }).catch(() => {});
}
$('#wQual').onclick = () => setQuality(QUALS[(QUALS.indexOf(W.q) + 1) % QUALS.length]);
setQuality(W.q);

function setFill(on) { $('#wPlayerWrap').classList.toggle('fill', on); $('#wFill').setAttribute('aria-pressed', String(on)); }
$('#wFill').onclick = () => {
  W.vertical = !$('#wv').classList.contains('vertical');
  if (innerHeight > innerWidth && innerWidth <= 900) renderVertical(W.info || {});
  else setFill(!$('#wPlayerWrap').classList.contains('fill'));
};

// ---------------------------------------------------------------- chat tools: likes, report, mute, emoji, @mentions
W.liked = new Set(store.get('liked:' + code, []));
W.muted = new Set(store.get('muted', []));
async function likeMsg(id, btn) {
  if (W.liked.has(id)) return;
  W.liked.add(id); store.set('liked:' + code, [...W.liked].slice(-300)); btn?.setAttribute('aria-pressed', 'true');
  const lk = $(`[data-id="${cssEsc(id)}"] .wv-like span`); if (lk) lk.textContent = String((Number(lk.textContent) || 0) + 1);
  try { await ensureSession(); await api('wsend', { ...creds(), type: 'like', msg: id }); } catch {}
}
async function deleteMsg(id, li) {
  if (!confirm('Delete this message for everyone?')) return;
  try { await ensureSession(); await api('wsend', { ...creds(), type: 'delete', msg: id }); li.remove(); W.recentChat = W.recentChat.filter((x) => x.id !== id); toast('Message deleted.'); }
  catch (e) { toast(e.message || 'Couldn’t delete that message.'); }
}
async function reportMsg(id, li) {
  if (!confirm('Report this message as spam or abuse? It’s hidden for you now; several reports hide it for everyone.')) return;
  li.remove(); toast('Reported. Thanks for keeping the chat friendly.');
  try { await ensureSession(); await api('wsend', { ...creds(), type: 'report', msg: id }); } catch {}
}
function muteName(name) {
  W.muted.add(String(name).toLowerCase()); store.set('muted', [...W.muted]);
  for (const li of $$('#wMsgs li')) if (String(li.dataset.name).toLowerCase() === String(name).toLowerCase()) li.remove();
  toast(`You won’t see ${name}’s messages any more. Only you.`);
}
function setAsk(on) { $('#wAsk').setAttribute('aria-pressed', String(on)); $('#wText').placeholder = on ? 'Ask the host a question…' : 'Say something…'; }
$('#wAsk').onclick = () => { setAsk($('#wAsk').getAttribute('aria-pressed') !== 'true'); $('#wText').focus(); };

const emoteSrc = (asset) => `/api/studio?action=wemote&studio=${encodeURIComponent(code)}&asset=${encodeURIComponent(asset)}`;
const emoteData = new Map();
new MutationObserver(() => {
  for (const im of $$('img.emote:not([data-ok]), .wv-picker img:not([data-ok])')) {
    im.dataset.ok = '1';
    const u = im.getAttribute('src'); if (typeof u !== 'string' || !u || u.startsWith('data:')) continue;
    if (!emoteData.has(u)) emoteData.set(u, fetch(u).then((r) => r.json()).then((j) => j.data).catch(() => ''));
    emoteData.get(u).then((d) => { if (d) im.src = d; });
  }
}).observe(document.body, { childList: true, subtree: true });

const EMOJI = ['😂', '🤣', '😍', '😮', '😢', '😡', '👍', '👎', '🙏', '👏', '🔥', '💯', '🎉', '❤️', '💀', '😎', '🤯', '🥶', '😱', '🤔', '👀', '✅', '❌', '⚡', '🏆', '🎮', '🕹️', '🎯', '💎', '🚀', '🍿', 'GG', 'W', 'L', 'POG', '🤝'];
function openPicker() {
  const box = $('#wPicker'), emotes = W.info?.emotes || [];
  const btn = (label, insert, img) => {
    const b = document.createElement('button'); b.type = 'button';
    if (img) { const i = document.createElement('img'); i.src = img; i.alt = label; b.append(i); } else b.textContent = label;
    b.title = label; b.onclick = () => insertText(insert);
    return b;
  };
  const parts = [];
  if (emotes.length) { const h = document.createElement('h3'); h.textContent = 'This show'; parts.push(h, ...emotes.map((e) => btn(`:${e.name}:`, `:${e.name}: `, emoteSrc(e.asset)))); const h2 = document.createElement('h3'); h2.textContent = 'Emoji'; parts.push(h2); }
  parts.push(...EMOJI.map((e) => btn(e, e.length > 2 ? e + ' ' : e)));
  replaceKids(box, ...parts); box.hidden = false; $('#wEmoji').setAttribute('aria-expanded', 'true');
}
function closePicker() { $('#wPicker').hidden = true; $('#wEmoji').setAttribute('aria-expanded', 'false'); }
function insertText(t) { const x = $('#wText'), at = x.selectionStart ?? x.value.length; x.value = x.value.slice(0, at) + t + x.value.slice(x.selectionEnd ?? at); x.focus(); x.selectionStart = x.selectionEnd = at + t.length; }
$('#wEmoji').onclick = (e) => { e.stopPropagation(); if ($('#wPicker').hidden) openPicker(); else closePicker(); };
document.addEventListener('click', (e) => { if (!e.target.closest('#wPicker, #wEmoji')) closePicker(); if (!e.target.closest('#wMentions, #wText')) $('#wMentions').hidden = true; });

$('#wText').addEventListener('input', () => {
  const x = $('#wText'), m = x.value.slice(0, x.selectionStart).match(/@([^\s@]{0,24})$/);
  const box = $('#wMentions');
  if (!m) { box.hidden = true; return; }
  const names = [...new Set([...$$('#wMsgs li[data-name]')].map((li) => li.dataset.name).reverse())].filter((n) => typeof n === 'string' && n !== sess?.name && n.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 6);
  if (!names.length) { box.hidden = true; return; }
  replaceKids(box, ...names.map((n) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '@' + n;
    b.onclick = () => { const at = x.selectionStart; x.value = x.value.slice(0, at - m[0].length) + '@' + n + ' ' + x.value.slice(at); box.hidden = true; x.focus(); };
    return b;
  }));
  box.hidden = false;
});

// ---------------------------------------------------------------- Stage cards: Shop drop, Polls, Queue
function money(p) { return p || ''; }
function productCard(p, sale) {
  const card = document.createElement('div'); card.className = 'wv-card' + (sale ? ' sale' : '');
  const k = document.createElement('div'); k.className = 'k';
  const l = document.createElement('span'); l.textContent = sale ? `⚡ Flash sale${sale.pct ? ' · ' + sale.pct + '% off' : ''}` : '🛍 Featured now';
  const r = document.createElement('span'); r.className = 'wv-cd'; if (sale) r.dataset.until = sale.until;
  k.append(l, r);
  const row = document.createElement('div'); row.className = 'wv-prod';
  const im = document.createElement(p.img ? 'img' : 'div'); if (p.img) { im.src = p.img; im.alt = ''; im.loading = 'lazy'; } else { im.className = 'ph'; im.textContent = '🛍'; }
  const txt = document.createElement('div'); const b = document.createElement('b'); b.textContent = p.title; const sm = document.createElement('small'); sm.textContent = money(p.price); txt.append(b, sm);
  const buy = document.createElement('a'); buy.className = 'btn wv-buy'; buy.href = p.url; buy.target = '_blank'; buy.rel = 'noopener'; buy.textContent = 'Buy';
  buy.onclick = () => { if (sale?.code) navigator.clipboard?.writeText(sale.code).then(() => toast(`Code ${sale.code} copied. Paste it at checkout.`)).catch(() => {}); };
  row.append(im, txt, buy); card.append(k, row);
  if (sale?.code) { const c = document.createElement('div'); c.className = 'wv-code'; c.append('Use code ', Object.assign(document.createElement('code'), { textContent: sale.code }), ' at checkout'); card.append(c); }
  return card;
}

function renderShopUI(info) {
  const sh = info.shop, items = sh?.items || [];
  $('#wTabShop').hidden = !items.length;
  if (!items.length && W.tab === 'shop') setTab('chat');
  const sale = sh?.sale && sh.sale.until > Date.now() ? sh.sale : null;
  const key = JSON.stringify([sh?.pinned, sale, items.map((x) => x.id)]);
  if (W.shopKey !== key) {
    W.shopKey = key;
    $('#wShopNote').textContent = items.length ? `Checkout happens on ${sh.store || 'the seller’s store'}.` : '';
    replaceKids($('#wProducts'), ...items.map((p) => {
      const li = document.createElement('li'); const a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; if (sale?.id === p.id) li.className = 'on-sale';
      const im = document.createElement(p.img ? 'img' : 'div'); if (p.img) { im.src = p.img; im.alt = ''; im.loading = 'lazy'; } else { im.className = 'ph'; im.textContent = '🛍'; }
      const b = document.createElement('b'); b.textContent = p.title; const sm = document.createElement('small'); sm.textContent = sale?.id === p.id ? `${p.price} · ${sale.pct ? sale.pct + '% off with ' : 'code '}${sale.code}` : p.price; a.append(im, b, sm); li.append(a); return li;
    }));
    $('#wCards').querySelector('[data-card="shop"]')?.remove();
    const p = items.find((x) => x.id === sh?.pinned);
    if (p) { const c = productCard(p, sale?.id === p.id ? sale : null); c.dataset.card = 'shop'; $('#wCards').prepend(c); if (W.booted && sale?.id === p.id) toast(`⚡ Flash sale: ${p.title}`); }
  }
}

setInterval(() => {
  for (const el of $$('[data-until]')) {
    const ms = Number(el.dataset.until) - Date.now();
    el.textContent = ms > 0 ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')} left` : 'ended';
  }
}, 1000);

W.votes = store.get('votes:' + code, {});
function renderPollCard(info, box = $('#wCards')) {
  const p = info.poll; let card = box.querySelector('[data-card="poll"]');
  if (!p) { card?.remove(); return; }
  const open = p.until > Date.now(), mine = W.votes[p.id], total = p.counts.reduce((a, b) => a + b, 0), show = !open || mine != null;
  const key = JSON.stringify([p.id, p.counts, open, mine, p.answer]);
  if (card?.dataset.key === key) return;
  const fresh = document.createElement('div'); fresh.className = 'wv-card'; fresh.dataset.card = 'poll'; fresh.dataset.key = key;
  const k = document.createElement('div'); k.className = 'k'; const l = document.createElement('span'); l.textContent = p.kind === 'predict' ? '🔮 Prediction' : '📊 Poll'; const r = document.createElement('span'); if (open) r.dataset.until = p.until; else r.textContent = `${total} votes`; k.append(l, r);
  const q = document.createElement('b'); q.textContent = p.q;
  const list = document.createElement('div'); list.className = 'wv-vote';
  p.opts.forEach((o, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.disabled = !open || mine != null;
    if (mine === i) b.classList.add('mine'); if (p.answer === i) b.classList.add('right');
    const pct = total ? Math.round(p.counts[i] / total * 100) : 0;
    const bar = document.createElement('i'); bar.style.width = show ? pct + '%' : '0';
    const a = document.createElement('span'); a.textContent = (p.answer === i ? '✓ ' : mine === i ? '• ' : '') + o; const c = document.createElement('b'); c.textContent = show ? pct + '%' : '';
    b.append(bar, a, c);
    b.onclick = async () => { try { await ensureSession(); await api('wsend', { ...creds(), type: 'vote', poll: p.id, opt: i }); W.votes[p.id] = i; placeWager(p, i); store.set('votes:' + code, W.votes); renderInteractive(W.info); } catch (e) { toast(e.message, true); } };
    list.append(b);
  });
  fresh.append(k, q, list);
  if (box.id === 'wModePoll' && p.kind === 'predict') fresh.append(wagerRow(p, open && mine == null));
  if (p.kind === 'predict' && p.answer >= 0 && mine != null) { const res = document.createElement('small'); res.textContent = mine === p.answer ? '🎉 You called it!' : 'Not this time.'; fresh.append(res); }
  if (card) card.replaceWith(fresh); else box.append(fresh);
}

W.queued = store.get('queued:' + code, false);
function renderQueueCard(info, box = $('#wCards')) {
  const qi = info.queue, card = box.querySelector('[data-card="queue"]');
  if (!qi?.open && !W.called) { card?.remove(); if (!qi?.open) W.queued = false; return; }
  const ahead = W.queued && sess ? Math.max(0, (qi.up || []).indexOf(sess.name)) : 0;
  const key = JSON.stringify([qi.size, W.queued, W.called, ahead]);
  if (card?.dataset.key === key) return;
  const c = document.createElement('div'); c.className = 'wv-card' + (W.called ? ' up' : ''); c.dataset.card = 'queue'; c.dataset.key = key;
  const k = document.createElement('div'); k.className = 'k'; k.append(Object.assign(document.createElement('span'), { textContent: '🎮 Play with the streamer' }), Object.assign(document.createElement('span'), { textContent: `${qi.size} in line` }));
  c.append(k);
  if (W.called) {
    const b = document.createElement('b'); b.textContent = 'You’re up! The streamer called you.';
    const go = document.createElement('a'); go.className = 'btn wv-buy'; go.href = '/c/' + code; go.target = '_blank'; go.rel = 'noopener'; go.textContent = 'Join the stage';
    c.append(b, go);
  } else if (W.queued) {
    const b = document.createElement('span'); b.textContent = ahead ? `You’re in line · ${ahead} ahead of you` : 'You’re in line. We’ll ping you when you’re up.';
    const leave = document.createElement('button'); leave.type = 'button'; leave.className = 'btn sm ghost'; leave.textContent = 'Leave the line';
    leave.onclick = async () => { W.queued = false; store.set('queued:' + code, false); try { await api('wsend', { ...creds(), type: 'unqueue' }); } catch {} renderInteractive(W.info); };
    c.append(b, leave);
  } else {
    const f = document.createElement('div'); f.className = 'wv-q';
    const inp = document.createElement('input'); inp.className = 'input'; inp.placeholder = 'Your gamertag'; inp.maxLength = 20; inp.value = store.get('gamertag', '');
    const mkSel = (opts, key, label) => { const s = document.createElement('select'); s.className = 'input wv-q-sel'; s.setAttribute('aria-label', label); s.append(...opts.map((o) => Object.assign(document.createElement('option'), { value: o, textContent: o }))); s.value = store.get(key, opts[0]); s.onchange = () => store.set(key, s.value); return s; };
    const plat = box.id === 'wModeQueue' ? mkSel(['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile'], 'gplat', 'Platform') : null;
    const role = box.id === 'wModeQueue' ? mkSel(['Flex', 'Support', 'Tank', 'DPS', 'IGL'], 'grole', 'Role') : null;
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Join the line';
    go.onclick = async () => { try { await ensureSession(); store.set('gamertag', inp.value.trim()); await api('wsend', { ...creds(), type: 'queue', tag: [inp.value.trim(), plat?.value, role?.value].filter(Boolean).join(' · ').slice(0, 32) }); awardXp(5); W.queued = true; store.set('queued:' + code, true); renderInteractive(W.info); } catch (e) { toast(e.message, true); } };
    if (plat) { const sels = document.createElement('div'); sels.className = 'wv-q-sels'; sels.append(plat, role); c.append(sels); }
    f.append(inp, go); c.append(f);
  }
  if (card) card.replaceWith(c); else box.append(c);
}

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
        li.append(skuThumb(p), tx, q, buyLink(p, sale, 'Checkout', 'btn sm primary'));
        return li;
      }));
      out.push(ul);
      const sum = document.createElement('div'); sum.className = 'wv-bag-sum';
      sum.append(Object.assign(document.createElement('span'), { textContent: `${count} item${count === 1 ? '' : 's'}` }), Object.assign(document.createElement('b'), { className: 'num', textContent: known ? fmtPrice(Math.round(total * 100) / 100, sym) : '' }));
      out.push(sum, Object.assign(document.createElement('p'), { className: 'wv-bag-note', textContent: `Each Checkout opens ${sh.store || 'the seller’s store'}${sale?.code ? `, with code ${sale.code} copied for the sale item` : ''}. Your bag stays on this device.` }));
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
function renderPartyMe() {
  if (!$('#wPtXp')) return;
  $('#wPtXp').textContent = `${W.xp.toLocaleString()} XP`;
  const i = BADGES.filter(([m]) => W.watched >= m).length - 1, [m0, ic, name] = BADGES[i], nxt = BADGES[i + 1];
  $('#wPtBadgeIc').textContent = ic; $('#wPtBadgeName').textContent = name;
  $('#wPtBadgeNext').textContent = nxt ? `${nxt[0] - W.watched} min to “${nxt[2]}”` : `${W.watched} min watched · top badge`;
  $('#wPtProg').style.width = (nxt ? Math.round((W.watched - m0) / (nxt[0] - m0) * 100) : 100) + '%';
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
  const me = sess?.named ? sess.name : ACCT?.user?.name || '';
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
    if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Say hi, win predictions, or send a super chat to top the board.'; items.push(li); }
    replaceKids($('#wPtBoard'), ...items);
  }
  $('#wCntParty').hidden = !(info.viewers > 1); $('#wCntParty').textContent = info.viewers > 1 ? String(info.viewers) : '';
  renderPartyMe();
}
$('#wPtHypeIt')?.addEventListener('click', (e) => {
  const fire = [...$$('#wReactDock button')].find((b) => b.textContent.includes('🔥')) || $('#wHeart');
  fire?.click();
  const b = e.currentTarget; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
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
    const c = document.createElement('span'); c.className = 'wv-upnext-c' + (n === sess?.name ? ' me' : '');
    c.append(Object.assign(document.createElement('b'), { className: 'num', textContent: String(i + 1) }), document.createTextNode(n === sess?.name ? `${n} (you)` : n));
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
  if (!W.queued || W.called || !sess) return;
  try {
    const r = await api('wping', creds());
    if (r.queue?.status === 'called') { W.called = true; toast('🎮 You’re up! Open Stage to join.'); try { new AudioContext().resume(); } catch {} renderInteractive(W.info); updateStageStatus(W.info); }
  } catch {}
}, 8000);

// ---------------------------------------------------------------- vertical handling
function renderVertical(info) {
  const native = info.aspect === '9:16', upright = innerHeight > innerWidth && innerWidth <= 900;
  $('#wv').classList.toggle('native916', native);
  $('#wv').classList.toggle('vertical', !native && upright && W.vertical === true);
  const v = $('#wDirect'); if (v) v.style.objectPosition = `${Math.round((info.focus ?? 0.5) * 100)}% 50%`;
  $('#wFill').setAttribute('aria-pressed', String($('#wv').classList.contains('vertical')));
}
addEventListener('resize', () => { if (W.info) renderVertical(W.info); });

// ---------------------------------------------------------------- Instant 30s Clip Studio with Trim Preview
const CLIP = { recs: [], timer: null, on: false, active: null, exporting: false, cancelExport: null };
function clipStart() {
  const v = W.direct.video; if (!v?.srcObject || !window.MediaRecorder || CLIP.on) return;
  CLIP.on = true;
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const spawn = () => {
    if (!W.direct.video?.srcObject) return clipStop();
    try {
      const rec = new MediaRecorder(W.direct.video.srcObject, { mimeType: mime, videoBitsPerSecond: 2_000_000 }), chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.start(1000); CLIP.recs.push({ rec, chunks, t0: Date.now(), mime: rec.mimeType || mime });
      while (CLIP.recs.length > 2) { const old = CLIP.recs.shift(); try { old.rec.stop(); } catch {} }
    } catch (e) { console.warn('clip recorder', e); }
  };
  spawn(); CLIP.timer = setInterval(spawn, 30000);
}
function clipStop() { clearInterval(CLIP.timer); for (const r of CLIP.recs) { try { r.rec.stop(); } catch {} } CLIP.recs = []; CLIP.on = false; }

const fmtSec = (s) => {
  const v = Math.max(0, Number(s) || 0);
  const m = Math.floor(v / 60), sec = Math.floor(v % 60), tenth = Math.floor((v % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenth}`;
};

function updateClipTrimUI() {
  const a = CLIP.active; if (!a) return;
  const dur = Math.max(1, a.dur);
  const start = Number($('#wTrimIn').value), end = Number($('#wTrimOut').value);
  a.start = start; a.end = end;
  const left = (start / dur) * 100, right = 100 - (end / dur) * 100;
  $('#wClipSel').style.left = `${left}%`;
  $('#wClipSel').style.right = `${Math.max(0, right)}%`;
  const selDur = Math.max(0, end - start);
  $('#wClipInTxt').textContent = `In ${fmtSec(start)}`;
  $('#wClipOutTxt').textContent = `Out ${fmtSec(end)}`;
  $('#wClipDurTxt').textContent = `Selection ${selDur.toFixed(1)}s`;
  $('#wClipExportTxt').textContent = `Export trim (${selDur.toFixed(1)}s)`;
}

async function openClipStudio() {
  if (!CLIP.on) { clipStart(); toast('Buffering rolling 30s clip… give it ~3 seconds.'); }
  $('#wClipDlg').showModal();
  const vid = $('#wClipPreview');
  $('#wClipWait').hidden = false;
  $('#wClipWaitTxt').textContent = 'Preparing rolling clip buffer…';
  $('#wClipProg').hidden = true;
  $('#wClipExport').disabled = true;
  $('#wClipFullSave').disabled = true;

  // Pick richest recorder with >= 2.5s of recorded data (or wait briefly if freshly enabled)
  let r = CLIP.recs[0];
  if (!r || Date.now() - r.t0 < 2500) {
    await new Promise((res) => setTimeout(res, 2600));
    r = CLIP.recs[0];
  }
  if (!r) { $('#wClipDlg').close(); return toast('Direct video is not ready for clipping yet.', true); }
  try { r.rec.requestData(); } catch {}
  await new Promise((res) => setTimeout(res, 250));

  const mime = (r.mime || 'video/webm').split(';')[0];
  const blob = new Blob(r.chunks, { type: mime });
  if (!blob.size) { $('#wClipWaitTxt').textContent = 'Buffer is warming up — try again in a second.'; return; }

  if (CLIP.active?.url) URL.revokeObjectURL(CLIP.active.url);
  const url = URL.createObjectURL(blob);
  const approxDur = Math.max(2, (Date.now() - r.t0) / 1000);
  CLIP.active = { blob, url, mime, dur: approxDur, start: 0, end: approxDur };

  vid.src = url;
  vid.onloadedmetadata = () => {
    const d = Number.isFinite(vid.duration) && vid.duration > 0.5 && vid.duration < 180 ? vid.duration : approxDur;
    CLIP.active.dur = d;
    CLIP.active.start = Math.max(0, d - Math.min(30, d));
    CLIP.active.end = d;
    $('#wTrimIn').max = d.toFixed(1);
    $('#wTrimOut').max = d.toFixed(1);
    $('#wTrimIn').value = CLIP.active.start.toFixed(1);
    $('#wTrimOut').value = CLIP.active.end.toFixed(1);
    updateClipTrimUI();
    $('#wClipWait').hidden = true;
    $('#wClipExport').disabled = false;
    $('#wClipFullSave').disabled = false;
    const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
    const testFile = new File([blob], `clip.${ext}`, { type: mime });
    $('#wClipShare').hidden = !navigator.canShare?.({ files: [testFile] });
    vid.currentTime = CLIP.active.start;
    vid.play().catch(() => {});
  };
}

$('#wClipPreview').addEventListener('timeupdate', () => {
  const a = CLIP.active, vid = $('#wClipPreview');
  if (!a || CLIP.exporting) return;
  const ct = vid.currentTime;
  $('#wClipClock').textContent = `${fmtSec(ct)} / ${fmtSec(a.dur)}`;
  $('#wClipHead').style.left = `${Math.min(100, Math.max(0, (ct / Math.max(1, a.dur)) * 100))}%`;
  if (ct >= a.end) { vid.currentTime = a.start; vid.play().catch(() => {}); }
});
$('#wClipPreview').addEventListener('play', () => $('#wClipPlay use').setAttribute('href', '/icons.svg#i-pause'));
$('#wClipPreview').addEventListener('pause', () => $('#wClipPlay use').setAttribute('href', '/icons.svg#i-play'));
$('#wClipPlay').onclick = () => { const v = $('#wClipPreview'); if (v.paused) v.play().catch(() => {}); else v.pause(); };

$('#wTrimIn').oninput = () => {
  let inV = Number($('#wTrimIn').value), outV = Number($('#wTrimOut').value);
  if (inV > outV - 1.5) { inV = Math.max(0, outV - 1.5); $('#wTrimIn').value = inV.toFixed(1); }
  updateClipTrimUI();
  $('#wClipPreview').currentTime = inV;
};
$('#wTrimOut').oninput = () => {
  let inV = Number($('#wTrimIn').value), outV = Number($('#wTrimOut').value);
  if (outV < inV + 1.5) { outV = Math.min(CLIP.active?.dur || 30, inV + 1.5); $('#wTrimOut').value = outV.toFixed(1); }
  updateClipTrimUI();
};
$$('.wv-clip-presets button').forEach((b) => b.onclick = () => {
  const a = CLIP.active; if (!a) return;
  const p = b.dataset.trim;
  const span = p === 'all' ? a.dur : Math.min(a.dur, Number(p));
  $('#wTrimIn').value = Math.max(0, a.dur - span).toFixed(1);
  $('#wTrimOut').value = a.dur.toFixed(1);
  updateClipTrimUI();
  $('#wClipPreview').currentTime = Number($('#wTrimIn').value);
});

function clipFilename(ext) {
  return `${(W.info?.title || 'gather').replace(/[^\w-]+/g, '-').slice(0, 40)}-clip-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${ext}`;
}
function saveBlob(blob, mime) {
  const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
  const name = clipFilename(ext);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast(`Clip downloaded (${name}).`);
}

$('#wClipFullSave').onclick = () => { if (CLIP.active) saveBlob(CLIP.active.blob, CLIP.active.mime); };
$('#wClipShare').onclick = async () => {
  if (!CLIP.active) return;
  const ext = /mp4/.test(CLIP.active.mime) ? 'mp4' : 'webm';
  const file = new File([CLIP.active.blob], clipFilename(ext), { type: CLIP.active.mime });
  try { await navigator.share({ files: [file], title: 'Clip from ' + (W.info?.title || 'the show') }); } catch {}
};

$('#wClipExport').onclick = async () => {
  const a = CLIP.active; if (!a || CLIP.exporting) return;
  // Instant zero-reencode export if full range selected or captureStream unsupported
  const isFull = a.start <= 0.3 && a.end >= a.dur - 0.3;
  const vid = $('#wClipPreview');
  const capFn = vid.captureStream || vid.mozCaptureStream;
  if (isFull || typeof capFn !== 'function') {
    saveBlob(a.blob, a.mime);
    return;
  }
  CLIP.exporting = true;
  $('#wClipExport').disabled = true;
  $('#wClipProg').hidden = false;
  const dur = Math.max(1.5, a.end - a.start);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || a.mime;

  try {
    vid.pause();
    vid.currentTime = a.start;
    await new Promise((res) => { const onSeek = () => { vid.removeEventListener('seeked', onSeek); res(); }; vid.addEventListener('seeked', onSeek); setTimeout(res, 600); });
    const stream = capFn.call(vid);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start(250);
    vid.play().catch(() => {});

    const timer = setInterval(() => {
      const elapsed = Math.max(0, vid.currentTime - a.start);
      const pct = Math.min(100, Math.round((elapsed / dur) * 100));
      $('#wClipProgBar').style.width = `${pct}%`;
      $('#wClipProgTxt').textContent = `Trimming ${elapsed.toFixed(1)}s / ${dur.toFixed(1)}s…`;
      if (vid.currentTime >= a.end || vid.ended) { clearInterval(timer); if (rec.state === 'recording') rec.stop(); vid.pause(); }
    }, 100);
    CLIP.cancelExport = () => { clearInterval(timer); if (rec.state === 'recording') rec.stop(); };

    await done;
    CLIP.cancelExport = null;
    if (chunks.length) saveBlob(new Blob(chunks, { type: mime.split(';')[0] }), mime);
    else saveBlob(a.blob, a.mime);
  } catch {
    saveBlob(a.blob, a.mime);
  } finally {
    CLIP.exporting = false;
    $('#wClipExport').disabled = false;
    $('#wClipProg').hidden = true;
    $('#wClipProgBar').style.width = '0';
  }
};

$('#wClipDlg').addEventListener('close', () => {
  CLIP.cancelExport?.();
  $('#wClipPreview').pause();
});

$('#wClip').onclick = openClipStudio;

setInterval(() => {
  const ready = W.direct.state === 'live' && !!window.MediaRecorder;
  $('#wClip').hidden = !ready;
  if (ready && !CLIP.on && (navigator.hardwareConcurrency || 2) >= 6 && !/Mobi/i.test(navigator.userAgent)) clipStart();
  if (!ready && CLIP.on) clipStop();
}, 2000);

// ---------------------------------------------------------------- voice questions
const VQ = { rec: null, chunks: [], stream: null, t0: 0, timer: null, sr: null, text: '', blob: null, meter: null };
const MAX_S = 45;
function voiceOpen() { $('#wVoiceName').value = sess?.named ? sess.name : store.get('name', ''); voiceReset(); showErr('#wVoiceErr', ''); $('#wVoiceDlg').showModal(); }
function voiceReset() {
  VQ.blob = null; VQ.text = ''; $('#wRecPlay').hidden = true; $('#wRecPlay').removeAttribute('src');
  $('#wRecText').hidden = true; $('#wRecSend').disabled = true; $('#wRecAgain').hidden = true;
  $('#wRecTime').textContent = `0:00 / 0:${MAX_S}`; $('#wRecHint').textContent = 'Tap the red button and speak.'; $('#wRecBtn').classList.remove('on');
}
async function voiceStart() {
  try { VQ.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return showErr('#wVoiceErr', 'Allow the microphone to record a question (the lock icon in the address bar).'); }
  const v = W.direct.video; VQ.wasMuted = v?.muted; if (v) v.muted = true;
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  VQ.chunks = []; VQ.rec = new MediaRecorder(VQ.stream, { mimeType: mime, audioBitsPerSecond: 32000 });
  VQ.rec.ondataavailable = (e) => { if (e.data.size) VQ.chunks.push(e.data); };
  VQ.rec.onstop = voiceStopped;
  VQ.rec.start(500); VQ.t0 = Date.now();
  $('#wRecBtn').classList.add('on'); $('#wRecBtn').setAttribute('aria-label', 'Stop recording'); $('#wRecHint').textContent = 'Recording… tap to stop.';
  VQ.timer = setInterval(() => { const s = Math.floor((Date.now() - VQ.t0) / 1000); $('#wRecTime').textContent = `0:${String(s).padStart(2, '0')} / 0:${MAX_S}`; if (s >= MAX_S) voiceStop(); }, 250);
  try { const ac = new AudioContext(), an = ac.createAnalyser(); ac.createMediaStreamSource(VQ.stream).connect(an); const buf = new Uint8Array(an.fftSize); VQ.meter = { ac, id: setInterval(() => { an.getByteTimeDomainData(buf); let p = 0; for (const x of buf) p = Math.max(p, Math.abs(x - 128)); $('#wRecLevel').style.width = Math.min(100, p * 1.6) + '%'; }, 80) }; } catch {}
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try {
      const sr = new SR(); sr.continuous = true; sr.interimResults = true; sr.lang = navigator.language || 'en-US';
      let finals = '';
      sr.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finals += e.results[i][0].transcript + ' '; else interim += e.results[i][0].transcript; } VQ.text = (finals + interim).trim(); $('#wRecText').hidden = !VQ.text; $('#wRecText').textContent = VQ.text; };
      sr.onerror = () => {}; sr.start(); VQ.sr = sr;
    } catch {}
  }
}
function voiceStop() { if (VQ.rec?.state === 'recording') VQ.rec.stop(); }
function voiceStopped() {
  clearInterval(VQ.timer); try { VQ.sr?.stop(); } catch {} VQ.sr = null;
  if (VQ.meter) { clearInterval(VQ.meter.id); VQ.meter.ac.close().catch(() => {}); VQ.meter = null; } $('#wRecLevel').style.width = '0';
  VQ.stream?.getTracks().forEach((t) => t.stop()); VQ.stream = null;
  const v = W.direct.video; if (v && VQ.wasMuted === false) v.muted = false;
  VQ.dur = Math.round((Date.now() - VQ.t0) / 1000);
  VQ.blob = new Blob(VQ.chunks, { type: (VQ.rec.mimeType || 'audio/webm').split(';')[0] });
  $('#wRecBtn').classList.remove('on'); $('#wRecBtn').setAttribute('aria-label', 'Start recording');
  if (VQ.dur < 2) { showErr('#wVoiceErr', 'That was very short. Try again and say your question.'); return voiceReset(); }
  $('#wRecPlay').src = URL.createObjectURL(VQ.blob); $('#wRecPlay').hidden = false;
  $('#wRecHint').textContent = 'Listen back, then send it.'; $('#wRecSend').disabled = false; $('#wRecAgain').hidden = false;
}
$('#wRecBtn').onclick = () => (VQ.rec?.state === 'recording' ? voiceStop() : voiceStart());
$('#wRecAgain').onclick = () => voiceReset();
$('#wRecSend').onclick = async () => {
  showErr('#wVoiceErr', '');
  const name = $('#wVoiceName').value.trim();
  if (!name) { $('#wVoiceName').focus(); return showErr('#wVoiceErr', 'Add your name so the host can greet you.'); }
  $('#wRecSend').disabled = true;
  try {
    await ensureSession(); if (name !== sess.name) await setName(name);
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(VQ.blob); });
    await api('wsend', { ...creds(), type: 'voice', data, transcript: VQ.text, dur: VQ.dur });
    $('#wVoiceDlg').close();
    $('#wMsgs').append(Object.assign(document.createElement('li'), { className: 'hello', textContent: '✋ Your voice question went to the host. They’ll play it if they pick it.' }));
    $('#wMsgs').scrollTop = $('#wMsgs').scrollHeight;
  } catch (e) { showErr('#wVoiceErr', e.message); $('#wRecSend').disabled = false; }
};
$('#wVoiceDlg').addEventListener('close', () => { if (VQ.rec?.state === 'recording') voiceStop(); });
$('#wMic').onclick = voiceOpen;

// ---------------------------------------------------------------- signing in to chat
const acctToken = () => { try { return JSON.parse(localStorage.getItem('gather:acctToken') || 'null') || ''; } catch { return ''; } };
const acctBody = () => (ACCT.user && acctToken() ? { acct: acctToken(), ...(ACCT.av ? { av: ACCT.av } : {}) } : {});
async function acctApi(action, body = {}) {
  const t = acctToken();
  const r = await fetch(`/api/account?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
  return j;
}
async function smallAvatar(src) {
  if (!src) return '';
  try {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d');
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    x.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 48, 48);
    const out = c.toDataURL('image/jpeg', 0.8); return out.length <= 9000 ? out : '';
  } catch { return ''; }
}
async function setAccount(user, token) {
  if (token) localStorage.setItem('gather:acctToken', JSON.stringify(token));
  ACCT.user = user; ACCT.av = await smallAvatar(user?.avatar);
  renderMe();
}
async function joinSigned() {
  await ensureSession();
  sess = { ...(await api('whello', { ...creds(), name: ACCT.user.name, ...acctBody() })), named: true };
  store.set('sess:' + code, sess); renderMe();
}
function renderSignMode() {
  const up = ACCT.up;
  $('#wSignH').textContent = up ? 'Create your account' : 'Sign in to chat';
  $('#wSignNameRow').hidden = $('#wSignAgreeRow').hidden = !up;
  $('#wSignGo').textContent = up ? 'Create account and chat' : 'Sign in';
  $('#wSignQ').textContent = up ? 'Have an account?' : 'New here?';
  $('#wSignMode').textContent = up ? 'Sign in' : 'Create an account';
  $('#wSignPass').autocomplete = up ? 'new-password' : 'current-password';
  showErr('#wSignErr', '');
}
let googleReady = api('config', {}).then((c) => {
  configureGoogle(c.googleClientId);
  $('#wGoogle').hidden = $('#wOr').hidden = $('#wSignLegal').hidden = !googleConfigured();
}).catch(() => {});
function openSignIn() {
  renderSignMode();
  googleReady ||= api('config', {}).then((c) => { configureGoogle(c.googleClientId); }).catch(() => {});
  googleReady.then(() => { $('#wGoogle').hidden = $('#wOr').hidden = $('#wSignLegal').hidden = !googleConfigured(); });
  $('#wSignDlg').showModal();
}
async function signedIn(r) {
  await setAccount(r.user, r.token);
  $('#wSignDlg').close();
  await joinSigned().catch((err) => showErr('#wErr', err.message));
  toast(`Signed in as ${r.user.name}.`);
  const next = ACCT.then; ACCT.then = null; if (next) next();
}
$('#wSignMode').onclick = () => { ACCT.up = !ACCT.up; renderSignMode(); };
$('#wGoogle').onclick = async () => {
  showErr('#wSignErr', ''); $('#wGoogle').setAttribute('aria-busy', 'true');
  try { const accessToken = await googleSignInToken(); await signedIn(await acctApi('google', { accessToken, agree: true })); }
  catch (err) { showErr('#wSignErr', err.message); }
  finally { $('#wGoogle').removeAttribute('aria-busy'); }
};
$('#wSignForm').addEventListener('submit', async (e) => {
  e.preventDefault(); showErr('#wSignErr', '');
  const email = $('#wSignEmail').value.trim(), password = $('#wSignPass').value;
  if (!email || !password) return showErr('#wSignErr', 'Type your email and password.');
  if (ACCT.up && !$('#wSignAgree').checked) return showErr('#wSignErr', 'Tick the box to agree to the Terms and Privacy policy first.');
  $('#wSignGo').setAttribute('aria-busy', 'true');
  try { await signedIn(await acctApi(ACCT.up ? 'signup' : 'login', ACCT.up ? { email, password, name: $('#wSignName').value.trim(), agree: true } : { email, password })); }
  catch (err) { showErr('#wSignErr', err.message); }
  finally { $('#wSignGo').removeAttribute('aria-busy'); }
});
$('#wSignDlg').addEventListener('close', () => { if (!ACCT.user) ACCT.then = null; });
if (acctToken()) acctApi('me').then((r) => setAccount(r.user)).catch(() => {});
$('#wMe').onclick = () => {
  if (!ACCT.user) return openSignIn();
  if (confirm(`Signed in as ${ACCT.user.name}. Sign out of the chat?`)) { localStorage.removeItem('gather:acctToken'); ACCT.user = null; ACCT.av = ''; renew().then(renderMe).catch(() => {}); toast('Signed out.'); }
};

// ---------------------------------------------------------------- Host details inside Show & Host Drawer
function initialsOf(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?'; }
function renderHost(info) {
  const card = $('#wHost'), infoBtn = $('#wInfoBtn');
  if (!info.found && !info.ended && !(info.offline && info.host)) {
    card.hidden = true; infoBtn.hidden = true;
    if ($('#wEmptyHost')) $('#wEmptyHost').textContent = 'Broadcast Feed';
    if ($('#wEmptyAv')) $('#wEmptyAv').textContent = '';
    return;
  }
  card.hidden = false; infoBtn.hidden = false;
  const h = info.host || {}, w = info.watch || {};
  $('#wHostTitle').textContent = info.offline ? `${h.name || 'This streamer'} isn’t live right now` : info.title || 'Live show';
  $('#wHostName').textContent = h.name || 'The host';
  $('#wInfoName').textContent = h.name || 'Show info';
  if ($('#wEmptyHost')) $('#wEmptyHost').textContent = (h.name || 'Broadcast Host') + (h.handle ? ` · @${h.handle}` : '');
  $('#wHostHandle').textContent = h.handle ? '@' + h.handle : '';
  const live = info.live?.on || W.direct.state === 'live';
  $('#wHostLive').hidden = !live || !!info.ended || !!info.offline;
  renderSub(h);
  $('#wHostMeta').textContent = info.offline ? 'Subscribe to get an email when they go live.' : info.ended ? 'Show ended' : [live ? (info.live?.on ? `Live for ${clockText(info.live.since)}` : 'On air now') : 'Not on air', info.viewers ? `${info.viewers} watching` : ''].filter(Boolean).join(' · ');

  const av = $('#wHostAv'), topAv = $('#wInfoAv'), slateAv = $('#wEmptyAv');
  if (!av.dataset.done) {
    const ini = initialsOf(h.name), col = nameColor(h.name || '?');
    av.textContent = ini; av.style.background = col;
    topAv.textContent = ini; topAv.style.background = col;
    if (slateAv) { slateAv.textContent = ini; slateAv.style.background = col; }
    if (h.photo) {
      av.dataset.done = '1';
      api('havatar', {}).then((r) => {
        if (r.avatar) {
          W.hostAvatar = r.avatar;
          const im1 = document.createElement('img'); im1.src = r.avatar; im1.alt = ''; replaceKids(av, im1); av.style.background = 'none';
          const im2 = document.createElement('img'); im2.src = r.avatar; im2.alt = ''; replaceKids(topAv, im2); topAv.style.background = 'none';
          if (slateAv) { const im3 = document.createElement('img'); im3.src = r.avatar; im3.alt = ''; replaceKids(slateAv, im3); slateAv.style.background = 'none'; }
          if (W.info) renderCreatorCard(W.info);
        }
      }).catch(() => {});
    }
  }
  $('#wHostAbout').textContent = w.about || '';
  $('#wHostAbout').hidden = !w.about;
  const links = [...(w.links || []), ...((info.live?.on && info.live.links) || []).map((l) => ({ label: 'Also live on ' + nameOf(l), url: l.url }))];
  const key = JSON.stringify(links);
  if (W.hostLinks !== key) {
    W.hostLinks = key;
    replaceKids($('#wHostLinks'), ...links.map((l) => { const li = document.createElement('li'), a = document.createElement('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener nofollow'; a.textContent = l.label; li.append(a); return li; }));
  }
  $('#wHostLinks').hidden = !links.length;
}


// ---------------------------------------------------------------- live actions under the video
// Auction (bid), giveaway (enter), shoutout (go follow) and raid (countdown, then off to the next show). The cards
// themselves are drawn into the video by the studio; this bar holds what a viewer can do about them.
W.myBids = store.get('bids:' + code, {});
W.entered = store.get('entered:' + code, {});
W.raidStay = '';
const usd = (c) => '$' + ((c || 0) / 100).toFixed((c || 0) % 100 ? 2 : 0);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function actRow(kind, html) { const d = document.createElement('div'); d.className = 'wv-act'; d.dataset.kind = kind; d.innerHTML = html; return d; }
function needName() { if (!sess?.named) { openSignIn(); return true; } return false; }

async function placeBid(a, amt, btn) {
  try {
    await ensureSession(); if (needName()) return;
    btn.disabled = true;
    const r = await api('wbid', { ...creds(), auction: a.id, amt });
    W.myBids[a.id] = amt; store.set('bids:' + code, W.myBids);
    toast(`You lead at ${usd(amt)}!`);
    if (W.info) { W.info.auction = r.auction; renderLiveActs(W.info); }
  } catch (e) { toast(e.message, true); poll(); }
  finally { btn.disabled = false; }
}
async function payAuction(a, btn) {
  try {
    btn.disabled = true;
    const r = await api('wauctionpay', { ...creds(), auction: a.id });
    if (r.mode === 'paid') return toast('Already paid. Thank you!');
    if (r.mode === 'stripe') {
      const host = $('#wShopCheckout'); if (!host) return;
      if ($('#wMode')) $('#wMode').hidden = false;
      host.hidden = false;
      host.innerHTML = '<div class="wv-co-bar"><b></b><button type="button" class="btn sm ghost" id="wCoCancel">Cancel</button></div><div id="wCoMount"></div>';
      host.querySelector('b').textContent = `${a.title} · ${usd(a.top.amt)}`;
      $('#wCoCancel').onclick = () => { try { shopCheckoutMount?.destroy(); } catch {} shopCheckoutMount = null; host.hidden = true; replaceKids(host); };
      const stripe = (await loadStripe())(r.pk, r.account ? { stripeAccount: r.account } : undefined);
      try { shopCheckoutMount?.destroy(); } catch {}
      shopCheckoutMount = await stripe.initEmbeddedCheckout({
        fetchClientSecret: async () => r.clientSecret,
        onComplete: async () => {
          try { await api('wshopdone', { ...creds(), orderId: r.orderId }); } catch {}
          try { shopCheckoutMount?.destroy(); } catch {}
          shopCheckoutMount = null; host.hidden = true; replaceKids(host);
          toast(`Paid! ${a.title} is yours.`);
        },
      });
      shopCheckoutMount.mount($('#wCoMount'));
      host.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const names = { paypal: 'PayPal', venmo: 'Venmo', cashapp: 'Cash App', stripe: 'Card' };
    const ways = Object.entries(r.pay || {}).map(([m, h]) => `${names[m] || m}: ${h}`);
    if (r.url) window.open(r.url, '_blank', 'noopener');
    toast(ways.length ? `Send ${r.amount} to the host — ${ways.join(' · ')}` : r.url ? `Finish your ${r.amount} order on the store that just opened.` : `The host will tell you how to pay ${r.amount}.`);
  } catch (e) { toast(e.message, true); }
  finally { btn.disabled = false; }
}
async function enterGiveaway(gv, btn) {
  try {
    await ensureSession(); if (needName()) return;
    btn.disabled = true;
    await api('wenter', { ...creds(), giveaway: gv.id });
    W.entered[gv.id] = true; store.set('entered:' + code, W.entered);
    toast('You’re in! Good luck.');
    renderLiveActs(W.info);
  } catch (e) { toast(e.message, true); btn.disabled = false; }
}
function actButton(label, primary, onClick) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm' + (primary ? ' primary' : ''); b.textContent = label; b.onclick = () => onClick(b); return b;
}

function renderLiveActs(info) {
  const box = $('#wActs'); if (!box || !info) return;
  const now = Date.now(), a = info.auction, gv = info.giveaway, so = info.shoutout, raid = info.raid;
  const rows = [];
  if (raid && W.raidStay !== raid.at + raid.url && raid.at > now - 4000) {
    const r = actRow('raid', `<span class="wv-act-tag">Raid</span><span class="wv-act-main"><b class="wv-act-t"></b><small class="wv-act-s">The host is sending everyone to their next show</small></span><span class="wv-act-clock num" data-raid="${raid.at}"></span>`);
    r.querySelector('.wv-act-t').textContent = `Heading to ${raid.name}`;
    r.append(actButton('Go now', true, () => goRaid(raid)), actButton('Stay here', false, () => { W.raidStay = raid.at + raid.url; renderLiveActs(W.info); }));
    rows.push(r);
  }
  if (a && (a.status === 'live' || now - (a.endedAt || 0) < 60_000) && a.status !== 'cancelled') {
    const live = a.status === 'live' && a.endsAt > now;
    const mine = !!(a.top && W.myBids[a.id] === a.top.amt && a.top.name === sess?.name);
    const next = a.top ? a.top.amt + a.inc : a.start;
    const r = actRow('auction', `<span class="wv-act-tag">${live ? 'Auction' : a.status === 'sold' ? 'Sold' : 'Ended'}</span><span class="wv-act-main"><b class="wv-act-t"></b><small class="wv-act-s"></small></span><span class="wv-act-clock num" ${live ? `data-ends="${a.endsAt}"` : ''}></span>`);
    r.querySelector('.wv-act-t').textContent = `${a.title} · ${usd(a.top ? a.top.amt : a.start)}`;
    r.querySelector('.wv-act-s').textContent = a.top ? (live ? (mine ? 'You’re winning' : `${a.top.name} leads`) : mine ? 'You won!' : `Won by ${a.top.name}`) : live ? `No bids yet · raises of ${usd(a.inc)}` : 'No bids';
    r.classList.toggle('mine', mine);
    if (live && !mine) for (const amt of [next, next + a.inc * 2]) r.append(actButton(`Bid ${usd(amt)}`, amt === next, (b) => placeBid(a, amt, b)));
    if (!live && mine && a.status === 'sold') r.append(actButton(`Pay ${usd(a.top.amt)}`, true, (b) => payAuction(a, b)));
    rows.push(r);
  }
  if (gv && gv.status !== 'cancelled' && (gv.status === 'open' || now - (gv.endedAt || 0) < 60_000)) {
    const open = gv.status === 'open' && gv.endsAt > now, inIt = !!W.entered[gv.id];
    const won = !!(gv.status === 'drawn' && gv.winner && gv.winner === sess?.name && inIt);
    const r = actRow('giveaway', `<span class="wv-act-tag">Giveaway</span><span class="wv-act-main"><b class="wv-act-t"></b><small class="wv-act-s"></small></span><span class="wv-act-clock num" ${open ? `data-ends="${gv.endsAt}"` : ''}></span>`);
    r.querySelector('.wv-act-t').textContent = gv.prize;
    r.querySelector('.wv-act-s').textContent = gv.status === 'drawn' ? (won ? 'You won! The host will be in touch.' : gv.winner ? `Winner: ${gv.winner}` : 'Nobody entered') : `${gv.entries || 0} entered${inIt ? ' · you’re in' : ''}`;
    r.classList.toggle('mine', won);
    if (open && !inIt) r.append(actButton('Enter', true, (b) => enterGiveaway(gv, b)));
    rows.push(r);
  }
  if (so && !raid) {
    const r = actRow('shoutout', `<span class="wv-act-tag">Shoutout</span><span class="wv-act-main"><b class="wv-act-t"></b><small class="wv-act-s"></small></span>`);
    r.querySelector('.wv-act-t').textContent = so.name; r.querySelector('.wv-act-s').textContent = so.game || 'Go say hi';
    if (so.url) { const l = document.createElement('a'); l.className = 'btn sm'; l.textContent = 'Go follow'; l.href = so.url; l.target = '_blank'; l.rel = 'noopener'; r.append(l); }
    rows.push(r);
  }
  // Rebuild only when something a viewer can see changed (keeps focus and avoids flicker on every poll).
  const key = JSON.stringify([raid, W.raidStay, a && [a.id, a.status, a.top, a.endsAt], gv && [gv.id, gv.status, gv.entries, gv.winner, W.entered[gv.id]], so, sess?.name]);
  if (box.dataset.k !== key) {
    const had = new Set([...box.children].map((x) => x.dataset.kind));
    for (const r of rows) if (!had.has(r.dataset.kind)) r.classList.add('fresh'); // only new rows slide in
    box.dataset.k = key; replaceKids(box, ...rows); tickActs();
  }
  box.hidden = !rows.length;
}
function goRaid(raid) {
  const url = /^\/w\//.test(raid.url) || /^https:\/\//.test(raid.url) ? raid.url : '';
  if (!url) return;
  W.raidStay = raid.at + raid.url; // go once
  location.href = url.startsWith('/w/') ? `${url}${url.includes('?') ? '&' : '?'}raid=${encodeURIComponent(W.info?.title || '')}` : url;
}
function tickActs() {
  const now = Date.now();
  for (const el of $$('#wActs [data-ends]')) el.textContent = mmss(Number(el.dataset.ends) - now);
  for (const el of $$('#wActs [data-raid]')) {
    const left = Number(el.dataset.raid) - now;
    el.textContent = left > 0 ? `in ${Math.ceil(left / 1000)} s` : 'now';
    const raid = W.info?.raid;
    if (left <= 0 && raid && W.raidStay !== raid.at + raid.url) goRaid(raid);
  }
}
setInterval(tickActs, 500);
// Ambient surround behind the player: a 64×36 copy of the direct video, blurred by CSS, ~8 times a second.
{
  const amb = $('#wAmbient'), ag = amb?.getContext('2d');
  if (ag) setInterval(() => {
    const v = W.direct?.video;
    const on = !document.hidden && W.source === 'direct' && W.direct?.state === 'live' && v && v.readyState >= 2;
    amb.classList.toggle('on', !!on);
    if (on) { try { ag.drawImage(v, 0, 0, amb.width, amb.height); } catch {} }
  }, 125);
}
// Arriving from a raid: say hello.
{ const from = new URLSearchParams(location.search).get('raid'); if (from) setTimeout(() => toast(`👋 You arrived with the raid from ${from.slice(0, 60)}`), 1200); }

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

// ---------------------------------------------------------------- subscribe
const SUBS = {
  get: () => { try { return JSON.parse(localStorage.getItem('gather:subs') || '{}'); } catch { return {}; } },
  set: (o) => { try { localStorage.setItem('gather:subs', JSON.stringify(o)); } catch {} },
};
const subKey = (h) => (h?.handle || h?.name || '').toLowerCase();
function renderSub(h) {
  const on = !!SUBS.get()[subKey(h)];
  W.subHost = h;
  for (const [btnSel, txtSel] of [['#wSub', '#wSubText'], ['#wSubTop', '#wSubTopText'], ['#wSubCard', '#wSubCardText']]) {
    const btn = $(btnSel); if (!btn) continue;
    btn.hidden = !h?.alerts;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    $(txtSel).textContent = on ? 'Subscribed' : 'Subscribe';
    btn.querySelector('use')?.setAttribute('href', '/icons.svg#i-' + (on ? 'bell-ring' : 'bell'));
  }
  const n = h?.subs || 0;
  const subTxt = h?.alerts ? `${n.toLocaleString()} subscriber${n === 1 ? '' : 's'}` : '';
  $('#wHostSubs').textContent = subTxt;
  if ($('#wCreatorSubs')) $('#wCreatorSubs').textContent = subTxt;
}
async function handleSubClick() {
  const h = W.subHost || {}, all = SUBS.get(), t = all[subKey(h)];
  if (t) {
    if (!confirm(`Stop getting emails when ${h.name || 'they'} go live?`)) return;
    try { await api('wunsub', { t: t === true ? '' : t }); } catch {}
    delete all[subKey(h)]; SUBS.set(all); renderSub(h); toast('Unsubscribed. You won’t get live alerts.');
    return;
  }
  $('#wSubWho').textContent = h.name ? `${h.name} live` : 'a show';
  $('#wSubAsk').hidden = false; $('#wSubDone').hidden = true; $('#wSubErr').hidden = true;
  if (!$('#wSubEmail').value && ACCT?.user?.email) $('#wSubEmail').value = ACCT.user.email;
  $('#wSubDlg').showModal(); $('#wSubEmail').focus();
}
$('#wSub').onclick = handleSubClick;
$('#wSubTop').onclick = handleSubClick;
if ($('#wSubCard')) $('#wSubCard').onclick = handleSubClick;

$('#wSubForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const go = $('#wSubGo'); go.disabled = true; $('#wSubErr').hidden = true;
  try {
    const r = await api('wsub', { studio: W.info?.handle || W.code || code, email: $('#wSubEmail').value.trim(), origin: location.origin });
    if (r.already) { const all = SUBS.get(); all[subKey(W.subHost)] = all[subKey(W.subHost)] || true; SUBS.set(all); renderSub(W.subHost); $('#wSubDlg').close(); toast('You’re already subscribed.'); return; }
    $('#wSubDoneP').textContent = `We sent a link to ${$('#wSubEmail').value.trim()}. Tap it and you’re in.`;
    $('#wSubAsk').hidden = true; $('#wSubDone').hidden = false;
  } catch (err) { $('#wSubErr').textContent = err.message; $('#wSubErr').hidden = false; }
  finally { go.disabled = false; }
});

(async () => {
  const q = new URLSearchParams(location.search), ok = q.get('subok'), off = q.get('unsub');
  if (!ok && !off) return;
  q.delete('subok'); q.delete('unsub');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  try {
    if (ok) {
      const r = await api('wsubok', { t: ok });
      const all = SUBS.get(); const k = String(r?.handle || r?.name || '').toLowerCase(); if (k) all[k] = r.t; SUBS.set(all);
      if (W.subHost) renderSub(W.subHost);
      toast(`You’re subscribed. We’ll email you when ${r.name || 'they'} go live.`);
    } else {
      const r = await api('wunsub', { t: off });
      const all = SUBS.get(); for (const k of Object.keys(all)) if (all[k] === off) delete all[k]; SUBS.set(all);
      if (W.subHost) renderSub(W.subHost);
      toast(r.name ? `Unsubscribed from ${r.name}. No more live alerts.` : 'Unsubscribed.');
    }
  } catch (err) { toast(err.message, true); }
})();

$('#wHostMore').onclick = () => { const on = $('#wHostDesc').classList.toggle('open'); $('#wHostMore').textContent = on ? 'Show less' : 'Show more'; };
new ResizeObserver(() => { const p = $('#wHostAbout'); $('#wHostMore').hidden = !$('#wHostDesc').classList.contains('open') && p.scrollHeight <= p.clientHeight + 2; }).observe($('#wHostAbout'));

// ---------------------------------------------------------------- room: who's here, pin, goal, reply, countdown
function renderRoom(info) {
  const on = !!info.found;
  const names = on ? (info.here || []) : [], n = on ? info.viewers || 0 : 0;
  $('#wHere').hidden = !on || n < 1;
  const key = names.join('|');
  if ($('#wHereAvs').dataset.k !== key) {
    $('#wHereAvs').dataset.k = key;
    replaceKids($('#wHereAvs'), ...names.slice(0, 7).map((nm) => { const a = document.createElement('i'); a.textContent = initialsOf(nm); a.title = nm; a.style.background = nameColor(nm); return a; }));
  }
  const others = Math.max(0, n - Math.min(7, names.length));
  $('#wHereN').textContent = names.length ? (others ? `+${others.toLocaleString()} watching` : 'watching now') : `${n.toLocaleString()} watching now`;
  const pin = on ? (info.watch?.pin || '') : '';
  $('#wPin').hidden = !pin;
  $('#wPinText').textContent = pin;
  $('#wPinBy').textContent = `Pinned by ${info.host?.name || 'the host'}`;
  $('#wMsgs').dataset.welcome = on ? `Welcome to ${info.title || 'the show'}! Say hi, ${info.host?.name || 'the host'} sees every message.` : '';
  syncRailStrip();
}

$('#wGuest').onclick = () => {
  W.guestThen = ACCT.then; ACCT.then = null;
  $('#wSignDlg').close();
  $('#wName').value = store.get('name', '') || '';
  showErr('#wNameErr', '');
  $('#wGuestBar').hidden = false;
  $('#wName').focus();
};

$('#wMsgs').addEventListener('click', (e) => {
  if (matchMedia('(hover: hover)').matches || e.target.closest('button, a')) return;
  const li = e.target.closest('li.row'); if (!li) return;
  const on = !li.classList.contains('tapped');
  for (const x of $$('#wMsgs li.tapped')) x.classList.toggle('tapped', false);
  li.classList.toggle('tapped', on);
});

function renderGoal(info) {
  const goal = info.found ? info.watch?.goal : null;
  $('#wGoal').hidden = !goal;
  if (!goal) return;
  const raised = info.raised || 0, p = Math.min(100, Math.round(raised / goal.target * 100));
  $('#wGoalLabel').textContent = '🎯 ' + (goal.label || 'Community goal');
  $('#wGoalBar').style.width = p + '%';
  $('#wGoalN').textContent = `$${Math.round(raised).toLocaleString()} / $${goal.target.toLocaleString()}`;
  $('#wGoal').classList.toggle('done', p >= 100);
}

function setReply(m) {
  W.reply = m ? { name: m.name, text: m.text } : null;
  $('#wReplyTo').hidden = !m;
  if (m) { $('#wReplyName').textContent = m.name; $('#wText').focus(); }
}
$('#wReplyX').onclick = () => setReply(null);

function countdownText(when) {
  const ms = when - Date.now();
  if (ms <= 0) return 'Starting any minute. This page plays by itself.';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const at = new Date(when).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return `Starts in ${d ? d + 'd ' : ''}${d || h ? h + 'h ' : ''}${m}m ${d ? '' : s + 's'} · ${at}`.replace(/\s+·/, ' ·');
}
setInterval(() => {
  const i = W.info;
  if (i?.offline && i.next && !$('#wEmpty').hidden) $('#wEmptyP').textContent = countdownText(i.next.when);
  for (const el of $$('[data-next-cd]')) {
    const w = Number(el.dataset.nextCd);
    if (w) el.textContent = countdownText(w);
  }
}, 1000);
function renderEmptyExtras(info) {
  const acts = $('#wEmptyActs');
  const key = `${!!(info.offline && info.host?.alerts)}|${info.ended ? (W.last?.links || [])[0]?.url || '' : ''}`;
  if (acts.dataset.k === key) return; acts.dataset.k = key;
  for (const x of acts.querySelectorAll('.extra')) x.remove();
  const add = (el) => { el.classList.add('extra'); acts.prepend(el); };
  if (info.offline && info.host?.alerts) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm primary'; b.innerHTML = '<svg class="i" aria-hidden="true"><use href="/icons.svg#i-bell"/></svg>Remind me'; b.onclick = () => $('#wSub').click(); add(b); }
  const replay = info.ended && (W.last?.links || [])[0];
  if (replay) { const a = document.createElement('a'); a.className = 'btn sm primary'; a.href = replay.url; a.target = '_blank'; a.rel = 'noopener'; a.innerHTML = '<svg class="i" aria-hidden="true"><use href="/icons.svg#i-play"/></svg>Watch the replay'; add(a); }
}

// ============================================================================
// V7 INTERACTIVE WATCH FEATURES:
// 1. Buy Without Leaving (embedded checkout + live stock + purchase alert)
// 2. AI Catch-up ("Missed 10 minutes?" with jump-to-moment links)
// 3. Private Watch-Party Rooms (synced side room with friend code)
// 4. Live Translation (captions + chat)
// 5. Super Chat "Moments" (shareable shout-out replay card)
// 6. Hot Seat (60-second camera slot unlocked by Hot Seat super chat)
// ============================================================================

let shopCheckoutMount = null;
async function buyProductInline(drop, sale) {
  const host = $('#wShopCheckout');
  if (!drop || !host) return;
  try {
    await ensureSession();
    if (!sess?.named) { openSignIn(); return; }
    host.hidden = false;
    host.innerHTML = '<div class="wv-co-bar"><b>Opening secure checkout…</b><button type="button" class="btn sm ghost" id="wCoCancel">Cancel</button></div><div id="wCoMount"></div>';
    $('#wCoCancel').onclick = () => { try { shopCheckoutMount?.destroy(); } catch {} shopCheckoutMount = null; host.hidden = true; replaceKids(host); };
    const r = await api('wshopbuy', { ...creds(), itemId: drop.id });
    if (r.mode === 'stripe' && r.clientSecret && r.pk) {
      const StripeFn = await loadStripe();
      const stripe = StripeFn(r.pk, r.account ? { stripeAccount: r.account } : undefined);
      try { shopCheckoutMount?.destroy(); } catch {}
      shopCheckoutMount = await stripe.initEmbeddedCheckout({
        fetchClientSecret: async () => r.clientSecret,
        onComplete: async () => {
          try { await api('wshopdone', { ...creds(), orderId: r.orderId }); } catch {}
          try { shopCheckoutMount?.destroy(); } catch {}
          shopCheckoutMount = null;
          host.hidden = true; replaceKids(host);
          toast(`Order confirmed! Thanks for grabbing ${drop.title}.`);
          poll();
        },
      });
      const mount = $('#wCoMount');
      if (mount) shopCheckoutMount.mount(mount);
      host.querySelector('.wv-co-bar b').textContent = `${drop.title} · ${salePriceOf(drop, sale) || money(drop.price)}`;
    } else {
      host.hidden = true; replaceKids(host);
      toast(`Reserved ${drop.title}!${r.remaining != null ? ` (${r.remaining} left)` : ''}`);
      if (r.url && /^https?:\/\//i.test(r.url)) {
        const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
      }
      poll();
    }
  } catch (e) {
    host.hidden = true; replaceKids(host);
    toast(e.message || 'Couldn’t start checkout right now.');
  }
}

// ---- AI Catch-up ("Missed 10 minutes?") ----
async function loadCatchup() {
  const body = $('#wCatchupBody');
  if (!body) return;
  const btn = $('#wCatchupBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Building recap…'; }
  try {
    const r = await api('wcatchup', { studio: code });
    const wrap = document.createElement('div'); wrap.className = 'wv-cu-list';
    const sum = document.createElement('p'); sum.className = 'wv-cu-sum'; sum.textContent = r.summary || 'Here is what just happened on stream.';
    wrap.append(sum);
    const moments = r.moments || [];
    if (!moments.length) {
      const em = document.createElement('p'); em.className = 'wv-cu-empty';
      em.textContent = 'Quiet last 10 minutes — highlights appear here as captions, super chats, and challenges happen.';
      wrap.append(em);
    } else {
      const ul = document.createElement('ul'); ul.className = 'wv-cu-ul';
      for (const m of moments) {
        const li = document.createElement('li');
        const agoMin = Math.max(0, Math.round((Date.now() - (m.ts || Date.now())) / 60000));
        const t = document.createElement('span'); t.className = 'wv-cu-time num'; t.textContent = agoMin ? `${agoMin}m ago` : 'Just now';
        const info = document.createElement('div'); info.className = 'wv-cu-txt';
        info.append(Object.assign(document.createElement('b'), { textContent: m.title }), Object.assign(document.createElement('span'), { textContent: m.detail || '' }));
        li.append(t, info);
        if (m.msgId) {
          const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'btn sm ghost'; jump.textContent = 'Jump';
          jump.onclick = () => {
            setTab('chat');
            const target = $(`#wMsgs [data-id="${cssEsc(m.msgId)}"]`);
            if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1600); }
            else toast('That chat moment scrolled past the live window.');
          };
          li.append(jump);
        }
        ul.append(li);
      }
      wrap.append(ul);
    }
    replaceKids(body, wrap);
  } catch (e) {
    replaceKids(body, Object.assign(document.createElement('p'), { className: 'wv-cu-empty', textContent: e.message || 'Could not load recap right now.' }));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh recap'; }
  }
}
$('#wCatchupBtn')?.addEventListener('click', loadCatchup);
$$('.wv-sc-tab[data-sc-tab="catchup"]').forEach((t) => t.addEventListener('click', () => {
  if (!$('#wCatchupBody')?.querySelector('.wv-cu-list')) loadCatchup();
}));

// ---- Private Watch-Party Rooms ----
const WROOM = { code: store.get('wroom:' + code, ''), timer: null };
function renderWatchRoomState(data) {
  const active = !!(WROOM.code && data?.found !== false);
  if ($('#wRoomSetup')) $('#wRoomSetup').hidden = active;
  if ($('#wRoomLive')) $('#wRoomLive').hidden = !active;
  if ($('#wCntRoom')) {
    const n = data?.members?.length || 0;
    $('#wCntRoom').hidden = !active || !n;
    $('#wCntRoom').textContent = String(n);
  }
  if (!active) return;
  if ($('#wRoomCodeTxt')) $('#wRoomCodeTxt').textContent = WROOM.code;
  if ($('#wRoomRoster') && data?.members) $('#wRoomRoster').textContent = `${data.members.length} here: ${data.members.slice(0, 5).join(', ')}`;
  const ul = $('#wRoomMsgs');
  if (ul && Array.isArray(data?.chat)) {
    const atBottom = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 40;
    replaceKids(ul, ...data.chat.map((m) => {
      const li = document.createElement('li');
      const d = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      li.append(Object.assign(document.createElement('b'), { textContent: m.name }), Object.assign(document.createElement('span'), { textContent: m.text }), Object.assign(document.createElement('time'), { textContent: d }));
      return li;
    }));
    if (!data.chat.length) ul.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Share the room code with friends to chat privately while watching.' }));
    if (atBottom) ul.scrollTop = ul.scrollHeight;
  }
}
async function pollWatchRoom() {
  if (!WROOM.code || !sess?.vid) return;
  try {
    const r = await api('wroomPoll', { ...creds(), room: WROOM.code });
    if (!r.found) { leaveWatchRoom(true); return; }
    renderWatchRoomState(r);
  } catch {}
}
function startWatchRoomPoll() {
  clearInterval(WROOM.timer);
  if (!WROOM.code) return;
  pollWatchRoom();
  WROOM.timer = setInterval(pollWatchRoom, 2500);
}
function leaveWatchRoom(silent) {
  WROOM.code = '';
  store.set('wroom:' + code, '');
  clearInterval(WROOM.timer);
  renderWatchRoomState({ found: false });
  if (!silent) toast('Left the private watch room.');
}
$('#wRoomCreate')?.addEventListener('click', async () => {
  try {
    await ensureSession();
    if (!sess?.named) { openSignIn(); return; }
    const r = await api('wroomCreate', { ...creds() });
    WROOM.code = r.room; store.set('wroom:' + code, r.room);
    renderWatchRoomState({ found: true, members: [sess.name], chat: [] });
    startWatchRoomPoll();
    toast(`Private room ${r.room} created — share the code with friends!`);
  } catch (e) { toast(e.message || 'Could not create watch room.'); }
});
$('#wRoomJoinForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rm = ($('#wRoomCodeIn')?.value || '').trim().toUpperCase();
  if (!rm) return;
  try {
    await ensureSession();
    if (!sess?.named) { openSignIn(); return; }
    const r = await api('wroomJoin', { ...creds(), room: rm });
    WROOM.code = r.room; store.set('wroom:' + code, r.room);
    if ($('#wRoomCodeIn')) $('#wRoomCodeIn').value = '';
    startWatchRoomPoll();
    toast(`Joined watch room ${r.room}!`);
  } catch (err) { toast(err.message || 'Watch room not found.'); }
});
$('#wRoomSendForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const inp = $('#wRoomMsgIn');
  const text = (inp?.value || '').trim();
  if (!text || !WROOM.code) return;
  inp.value = '';
  try {
    await ensureSession();
    await api('wroomSend', { ...creds(), room: WROOM.code, text });
    pollWatchRoom();
  } catch (err) { toast(err.message || 'Could not send message.'); }
});
$('#wRoomCopy')?.addEventListener('click', () => {
  if (!WROOM.code) return;
  const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(WROOM.code)}`;
  navigator.clipboard?.writeText(shareUrl).then(() => toast(`Copied room invite (${WROOM.code})!`)).catch(() => toast(`Room code: ${WROOM.code}`));
});
$('#wRoomLeave')?.addEventListener('click', () => leaveWatchRoom(false));
(() => {
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom && /^[a-z0-9]{4,8}$/i.test(urlRoom)) {
    WROOM.code = urlRoom.toUpperCase();
    store.set('wroom:' + code, WROOM.code);
  }
  if (WROOM.code) setTimeout(() => { if (sess?.vid) startWatchRoomPoll(); }, 1500);
})();

// ---- Live Translation (captions + chat) ----
W.lang = store.get('lang', '');
const TR_CACHE = new Map();
async function translateText(text, lang) {
  if (!lang || !text || text.length < 2) return text;
  const key = `${lang}::${text}`;
  if (TR_CACHE.has(key)) return TR_CACHE.get(key);
  const p = fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 400), targetLang: lang }),
  }).then((r) => r.ok ? r.json() : { text }).then((d) => d.text || text).catch(() => text);
  TR_CACHE.set(key, p);
  return p;
}
function applyLiveTranslation(el, originalText) {
  const lang = W.lang;
  if (!lang || !el || !originalText) return;
  el.dataset.origText = originalText;
  translateText(originalText, lang).then((tr) => {
    if (W.lang === lang && el.isConnected && tr && tr !== originalText) {
      el.textContent = tr;
      el.title = `Original: ${originalText}`;
    }
  });
}
if ($('#wLangSel')) {
  $('#wLangSel').value = W.lang || '';
  $('#wLangSel').addEventListener('change', (e) => {
    W.lang = e.target.value || '';
    store.set('lang', W.lang);
    toast(W.lang ? `Live translation on (${W.lang})` : 'Showing original language');
    for (const el of $$('#wMsgs .wv-mt')) {
      const orig = el.dataset.origText || el.textContent;
      if (!W.lang) { if (el.dataset.origText) el.textContent = el.dataset.origText; el.title = ''; }
      else applyLiveTranslation(el, orig);
    }
    if (W.info) renderCaps(W.info);
  });
}

// ---- Super Chat "Moments" (shareable shout-out replay card) ----
let activeMoment = null;
function openMomentCard(m) {
  const dlg = $('#wMomentDlg');
  const cv = $('#wMomentCanvas');
  if (!dlg || !cv || !m) return;
  activeMoment = m;
  const ctx = cv.getContext('2d');
  const Wc = cv.width, Hc = cv.height;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38bdf8';
  const hostName = W.info?.host?.name || W.info?.title || 'Live Show';
  const showTitle = W.info?.title || 'Live Broadcast';

  const g = ctx.createLinearGradient(0, 0, Wc, Hc);
  g.addColorStop(0, '#090d18'); g.addColorStop(0.6, '#10182b'); g.addColorStop(1, '#0b1020');
  ctx.fillStyle = g; ctx.fillRect(0, 0, Wc, Hc);
  const rad = ctx.createRadialGradient(Wc * 0.85, Hc * 0.18, 20, Wc * 0.85, Hc * 0.18, 420);
  rad.addColorStop(0, accent + '44'); rad.addColorStop(1, 'transparent');
  ctx.fillStyle = rad; ctx.fillRect(0, 0, Wc, Hc);

  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.roundRect(48, 44, 232, 42, 21); ctx.fill();
  ctx.fillStyle = '#061018'; ctx.font = '700 18px system-ui, -apple-system, sans-serif';
  ctx.fillText('SUPER CHAT MOMENT', 66, 71);

  ctx.fillStyle = '#ffffff'; ctx.font = '800 56px system-ui, -apple-system, sans-serif';
  ctx.fillText(String(m.paid || '$5'), 48, 168);

  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '600 24px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${m.name || 'Viewer'} got a shout-out on ${hostName}’s stream`, 48, 216);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(48, 250, Wc - 96, 174, 18); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f8fafc'; ctx.font = '600 28px system-ui, -apple-system, sans-serif';
  const words = String(m.text || 'Thanks for the awesome stream!').split(/\s+/);
  let line = '', y = 306;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > Wc - 156 && line) { ctx.fillText(line, 76, y); line = w; y += 38; if (y > 395) break; }
    else line = test;
  }
  if (line && y <= 405) ctx.fillText(line, 76, y);

  ctx.fillStyle = 'rgba(255,255,255,0.58)'; ctx.font = '500 18px system-ui, -apple-system, sans-serif';
  ctx.fillText(showTitle.slice(0, 62), 48, Hc - 42);
  ctx.textAlign = 'right';
  ctx.fillText(location.host, Wc - 48, Hc - 42);
  ctx.textAlign = 'left';

  dlg.showModal();
}
$('#wMomentCopy')?.addEventListener('click', () => {
  if (!activeMoment) return;
  const hostName = W.info?.host?.name || 'the host';
  const txt = `I got a ${activeMoment.paid || ''} shout-out on ${hostName}’s live stream! “${activeMoment.text || ''}” ${location.href}`;
  navigator.clipboard?.writeText(txt).then(() => toast('Copied shout-out text!')).catch(() => toast('Ready to share!'));
});
$('#wMomentDl')?.addEventListener('click', () => {
  const cv = $('#wMomentCanvas');
  if (!cv) return;
  const a = document.createElement('a');
  a.download = `super-chat-moment-${Date.now()}.png`;
  a.href = cv.toDataURL('image/png');
  a.click();
});

// ---- Hot Seat (60s camera slot unlocked by Hot Seat super chat) ----
function syncHotSeatBtn(info) {
  const btn = $('#wHotSeatBtn');
  if (!btn) return;
  const pass = info?.hotSeatPass;
  const active = !!(pass && pass.expires > Date.now());
  btn.hidden = !active;
  if (active) {
    btn.textContent = `🔥 Join Hot Seat (${pass.sec || 60}s)`;
  }
}
$('#wHotSeatBtn')?.addEventListener('click', async () => {
  try {
    await ensureSession();
    const r = await api('whotseat', { ...creds() });
    toast(`Hot Seat claimed! Get ready — you have ${r.sec || 60}s on camera when the host pulls you in.`);
  } catch (e) {
    toast(e.message || 'Send a Hot Seat super chat to unlock the 60-second camera slot.');
  }
});
