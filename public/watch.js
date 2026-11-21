// The public watch page (/w/<studio>): Obsidian Broadcast Theater over WebRTC,
// with platform embed fallback, Stream Stats HUD, Host Drawer, One-Tap Reaction Dock,
// Live Chat Mood Meter synced with reactions, Consolidated Stage Tab, and 30s Clip Studio.
import { configureGoogle, googleConfigured, googleSignInToken } from './google.js';
import './ui.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return ''; } };
const code = safeDecode(location.pathname.split('/')[2] || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

const NAMES = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick', facebook: 'Facebook', x: 'X', rumble: 'Rumble', custom: 'Watch' };
const HOSTS = { 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'twitch.tv': 'Twitch', 'kick.com': 'Kick', 'facebook.com': 'Facebook', 'x.com': 'X', 'twitter.com': 'X', 'rumble.com': 'Rumble' };
const PAY = {
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

const MOOD_ICONS = { idle: 'activity', hype: 'flame', warm: 'smile', steady: 'activity', mixed: 'meh', tense: 'frown' };

function syncMoodUI(state, label, pct, metaText) {
  const box = $('#wMoodBox');
  if (box) box.dataset.mood = state;
  if ($('#wMoodLabel')) $('#wMoodLabel').textContent = label;
  if ($('#wMoodPct')) $('#wMoodPct').textContent = `${pct}%`;
  if ($('#wMoodBar')) $('#wMoodBar').style.width = `${pct}%`;
  $('#wMoodMeter')?.setAttribute('aria-valuenow', String(pct));
  if ($('#wMoodMeta')) $('#wMoodMeta').textContent = metaText;
  const iconHref = `/icons.svg#i-${MOOD_ICONS[state] || 'activity'}`;
  $('#wMoodMiniIconUse')?.setAttribute('href', iconHref);
  $('#wMoodBoxIconUse')?.setAttribute('href', iconHref);

  const shortLbl = state === 'idle' ? 'Calm' : label;
  const mini = $('#wMoodMiniBtn');
  if (mini) {
    mini.dataset.mood = state;
    const desc = `Crowd sentiment: ${shortLbl} (${pct}%) — ${metaText || 'tracks live chat & reactions'}. Click for Pulse.`;
    mini.dataset.tip = desc;
    const tip = $('#ui-tooltip');
    if (tip && mini.getAttribute('aria-describedby') === tip.id && tip.classList.contains('show')) tip.textContent = desc;
  }
  if ($('#wMoodMiniLbl')) $('#wMoodMiniLbl').textContent = shortLbl;
  if ($('#wMoodMiniBar')) $('#wMoodMiniBar').style.width = `${pct}%`;
  if ($('#wMoodMiniPct')) $('#wMoodMiniPct').textContent = `${pct}%`;
}

function renderMoodMeter(info) {
  const box = $('#wMoodBox');
  if (!box) return;
  const items = (info?.chat || W.recentChat || []).filter((m) => m && !W.muted.has(String(m.name).toLowerCase())).slice(-30);
  const reacts = info?.reacts || {};
  const reactTotal = Object.values(reacts).reduce((a, b) => a + b, 0);
  const hypeFactor = Math.min(1, (reactTotal + W.reactMomentum) / 25);

  if (!items.length && reactTotal === 0 && W.reactMomentum === 0) {
    syncMoodUI('idle', 'Room Calm', 50, 'Synced with live chat & reactions');
    return;
  }

  let weighted = 0, wSum = 0, pos = 0, neg = 0;
  for (let i = 0; i < items.length; i++) {
    const sc = scoreMessageSentiment(items[i].text, items[i]);
    if (sc >= 0.2) pos++;
    else if (sc <= -0.2) neg++;
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
  const label = { hype: 'Hyped', warm: 'Upbeat', steady: 'Steady', mixed: 'Mixed', tense: 'Tense' }[state];
  const parts = [];
  if (items.length) parts.push(`${items.length} msg${items.length === 1 ? '' : 's'} (${pos} positive)`);
  if (reactTotal + W.reactMomentum > 0) parts.push(`${reactTotal + Math.round(W.reactMomentum)} reactions`);
  syncMoodUI(state, label, pct, parts.join(' · ') || 'Synced with live chat & reactions');
}

// ---------------------------------------------------------------- feed (cached GET shared by viewers)
async function poll() {
  try {
    const r = await fetch(`/api/studio?action=wfeed&studio=${encodeURIComponent(code)}`);
    render(r.ok ? await r.json() : { found: false });
  } catch {
    $('#wv').classList.remove('sk-wait');
    window.gatherBoot?.done();
    $('#wEmptyH').textContent = 'Can’t reach gather right now. Retrying…';
  }
  setTimeout(poll, document.hidden ? 8000 : 2000);
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
  $('#wMic').hidden = w.voice === false || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
  $('#wChatState').textContent = !info.found ? '' : w.chat === false ? 'Chat off' : w.slow ? `Slow · ${w.slow}s` : '';
  $('#wCompose').hidden = !info.found || w.chat === false;

  W.recentChat = info.chat || [];
  renderChat(W.recentChat);
  renderRoom(info);
  renderGoal(info);
  $('#wChat').classList.toggle('quiet', !$('#wMsgs li.row, #wMsgs li.paid'));
  renderTops(W.recentChat);
  renderAbout(info);
  renderShopUI(info);
  renderPollCard(info);
  renderQueueCard(info);
  updateStageStatus(info);
  renderHype(info);
  renderMoodMeter(info);
  renderVertical(info);
  renderCaps(info);
  renderSources(info);
  floatReacts(info.reacts);
  syncHudShell();
}

function renderChat(items) {
  const log = $('#wMsgs'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  for (const m of items) {
    if (W.muted.has(String(m.name).toLowerCase())) continue;
    const old = log.querySelector(`[data-id="${CSS.escape(m.id)}"] .wv-like span`);
    if (old) old.textContent = m.likes ? String(m.likes) : '';
    const key = m.id + ':' + (m.status || '');
    if (W.shown.has(key)) continue;
    if (W.booted && sess?.named && m.name !== sess.name && new RegExp('@' + sess.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(m.text)) toast(`${m.name} mentioned you.`);
    W.shown.add(key);
    if (W.booted && $('#wv').classList.contains('no-chat')) {
      const u = $('#wUnread'); u.textContent = Math.min(99, (+u.textContent || 0) + 1); u.hidden = false;
    }
    log.querySelector(`[data-id="${CSS.escape(m.id)}"]`)?.remove();
    log.querySelector(`[data-sc="${CSS.escape(m.sc || '')}"]`)?.remove();
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
  if (m.paid) li.className = 'paid' + (m.status === 'answered' ? ' answered' : '') + (m.status === 'pending' ? ' pending' : '');
  else li.className = 'row' + (m.q ? ' q' : '');
  const mine = sess?.named && m.name === sess.name;
  if (mine) li.classList.add('me');
  if (!mine && sess?.named && new RegExp('@' + sess.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(m.text)) li.classList.add('mention');
  if (m.paid) { const a = document.createElement('span'); a.className = 'amt'; a.textContent = m.paid; li.append(a); const b = document.createElement('b'); b.textContent = m.name; li.append(b, richText(m.text)); return li; }

  const av = document.createElement('span'); av.className = 'wv-av'; av.style.background = nameColor(m.name);
  if (m.av && /^data:image\/(jpeg|png|webp);base64,/.test(m.av)) {
    av.style.background = 'none';
    queueMicrotask(() => { const im = document.createElement('img'); im.src = m.av; im.alt = ''; av.replaceChildren(im); });
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
    if (!mine) acts.append(mk('flag', 'Report spam', () => reportMsg(m.id, li)), mk('volume-x', `Mute ${m.name} for me`, () => muteName(m.name)));
  }
  head.append(gap, acts, lk);
  if (m.re?.n) { const q = document.createElement('span'); q.className = 'wv-re'; q.textContent = `${m.re.n}: ${m.re.t || ''}`; body.append(head, q, richText(m.text)); }
  else body.append(head, richText(m.text));
  li.append(av, body);
  return li;
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
  $('#wTops').replaceChildren(...top.map(([n, a], i) => { const s = document.createElement('span'); const amt = document.createElement('i'); amt.textContent = '$' + (Number.isInteger(a) ? a : a.toFixed(2)); s.append(amt, (i === 0 ? '👑 ' : '') + n); return s; }));
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
    $('#wTabs').replaceChildren(...tabs.map((t) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.setAttribute('role', 'tab'); b.dataset.src = t.id;
      b.textContent = t.label; b.onclick = () => { W.source = t.id; renderSources(W.info); };
      return b;
    }));
  }
  for (const b of $('#wTabs').children) { const on = b.dataset.src === W.source; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  const lkey = JSON.stringify(links);
  if (W.linksKey !== lkey) {
    W.linksKey = lkey;
    $('#wLinks').replaceChildren(...links.map((l) => { const a = document.createElement('a'); a.className = 'btn sm ghost'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `Open on ${nameOf(l)}`; return a; }));
  }
  showPlayer(info);
}

function showPlayer(info) {
  const box = $('#wPlayer');
  if (W.source === 'direct') {
    const v = W.direct.video;
    const playing = W.direct.state === 'live' && v;
    if (playing && v.parentElement !== box) box.replaceChildren(v);
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
    box.replaceChildren(f); box.hidden = false; $('#wEmpty').hidden = true; $('#wUnmute').hidden = true; $('#wCtrls').hidden = true;
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
  dock.replaceChildren(...REACTS.map((e) => {
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
    try { await ensureSession(); for (let i = 0; i < n; i++) await api('wsend', { ...creds(), type: 'react', emoji: e }); } catch {}
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
$('#wReactPick').replaceChildren(...REACTS.map((e) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.setAttribute('aria-label', 'React ' + e);
  b.onclick = () => { sendReact(e); $('#wReactPick').hidden = true; };
  return b;
}));

function renderHype(info) {
  const total = Object.values(info?.reacts || {}).reduce((a, b) => a + b, 0) + W.reactMomentum;
  const lv = Math.min(100, Math.round(total * 4));
  $('#wHypeBar').style.width = lv + '%';
  $('#wHypeLvl').textContent = lv >= 100 ? 'MAX' : lv >= 60 ? 'Hot' : lv >= 25 ? 'Warm' : 'Chill';
  $('#wHype').classList.toggle('max', lv >= 100);
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
    $('#wMsgs').append(msgEl(item)); $('#wMsgs').scrollTop = $('#wMsgs').scrollHeight;
    renderMoodMeter(W.info);
  } catch (err) {
    if (err.status === 401) { await renew().catch(() => {}); return showErr('#wErr', 'Your chat session ended. Send again.'); }
    showErr('#wErr', err.message);
  }
});

// ---------------------------------------------------------------- super chats
const SC = { amount: 5, method: '', opened: false };
function openSuper() {
  const w = W.info?.watch || {};
  const methods = Object.keys(PAY).filter((m) => w.pay?.[m]);
  SC.method = methods.includes(SC.method) ? SC.method : methods[0] || '';
  SC.amount = Math.max(SC.amount, w.min || 2); SC.opened = false;
  const amounts = [...new Set([w.min || 2, 5, 10, 20, 50].filter((a) => a >= (w.min || 2)))].slice(0, 5);
  $('#wAmounts').replaceChildren(...amounts.map((a) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = '$' + a;
    b.setAttribute('aria-checked', String(a === SC.amount)); b.onclick = () => { SC.amount = a; $('#wCustom').value = ''; openSuperRefresh(); };
    return b;
  }), Object.assign(document.createElement('input'), { className: 'input', id: 'wCustom', type: 'number', min: String(w.min || 2), max: '10000', step: '1', placeholder: 'Other amount ($)', inputMode: 'decimal' }));
  $('#wCustom').oninput = (e) => { const v = Number(e.target.value); if (v) SC.amount = v; openSuperRefresh(); };
  $('#wMethods').replaceChildren(...methods.map((m) => {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.m = m; b.textContent = PAY[m].label;
    b.onclick = () => { SC.method = m; SC.opened = false; openSuperRefresh(); };
    return b;
  }));
  showErr('#wScErr', '');
  $('#wScName').value = sess?.named ? sess.name : store.get('name', '');
  openSuperRefresh();
  $('#wSuperDlg').showModal();
}
function openSuperRefresh() {
  $$('#wAmounts button').forEach((b) => b.setAttribute('aria-checked', String(b.textContent === '$' + SC.amount)));
  $$('#wMethods button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === SC.method)));
  const label = PAY[SC.method]?.label || '';
  $('#wPayGo').textContent = SC.method === 'stripe' ? `Pay $${SC.amount} by card, Apple Pay or Google Pay` : `Pay $${SC.amount} with ${label}`;
  $('#wPayNote').textContent = `Your payment goes straight to the host${SC.method === 'stripe' ? ' through Stripe' : ` on ${label}`}. gather never touches it. Enter $${SC.amount} if the app asks.`;
  $('#wPaid').disabled = !SC.opened;
}
$('#wSuperBtn').onclick = () => openSuper();
$('#wPayGo').onclick = async () => {
  const w = W.info?.watch || {}, handle = w.pay?.[SC.method];
  if (!handle) return;
  try { await ensureSession(); } catch {}
  window.open(PAY[SC.method].link(handle, SC.amount, `Super chat on gather: ${($('#wScText').value || '').slice(0, 60)}`), '_blank', 'noopener');
  SC.opened = true; openSuperRefresh();
};
$('#wPaid').onclick = async () => {
  showErr('#wScErr', '');
  try {
    await ensureSession();
    const nm = $('#wScName').value.trim();
    if (!nm) { $('#wScName').focus(); return showErr('#wScErr', 'Add your name so the host can thank you.'); }
    if (nm !== sess.name) await setName(nm);
    const r = await api('wsend', { ...creds(), type: 'super', amount: SC.amount, method: SC.method, text: $('#wScText').value.trim() });
    $('#wSuperDlg').close(); $('#wScText').value = '';
    $('#wMsgs').append(msgEl({ id: 'mine-' + r.id, sc: r.id, name: sess.name, text: 'Waiting for the host to confirm your super chat…', paid: '$' + SC.amount, status: 'pending' }));
    $('#wMsgs').scrollTop = $('#wMsgs').scrollHeight;
    toast('Sent. It shows up once the host sees your payment.');
  } catch (err) { showErr('#wScErr', err.message); }
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
if ($('#wMoodMiniBtn')) $('#wMoodMiniBtn').onclick = () => setTab('pulse');
if ($('#wPinMiniBtn')) $('#wPinMiniBtn').onclick = () => setTab('pulse');
if ($('#wHereMiniBtn')) $('#wHereMiniBtn').onclick = () => setTab('pulse');

function updateStageStatus(info) {
  const cards = $('#wCards').children.length;
  const badge = $('#wStageBadge');
  badge.hidden = cards === 0;
  badge.textContent = String(cards);
  const sale = info?.shop?.sale && info.shop.sale.until > Date.now();
  badge.classList.toggle('hot', !!(sale || W.called));

  // Surface a slim one-line banner in Chat when something active is happening on Stage
  let msg = '', alertKey = '';
  if (W.called) { msg = '🎮 You’re up next! Open Stage to join.'; alertKey = 'called'; }
  else if (sale) { msg = `⚡ Flash sale active${sale.pct ? ` (${sale.pct}% off)` : ''}`; alertKey = 'sale:' + sale.id + ':' + sale.until; }
  else if (info?.poll && info.poll.until > Date.now()) { msg = `📊 ${info.poll.q}`; alertKey = 'poll:' + info.poll.id; }
  else if (info?.queue?.open) { msg = `🎮 Play-with-me queue is open (${info.queue.size})`; alertKey = 'queue:open'; }

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
  $('#wAboutLinks').replaceChildren(...links.map((l) => {
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
  if (show) $('#wCaps').replaceChildren(Object.assign(document.createElement('b'), { textContent: line.name }), document.createTextNode(line.text));
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
  const lk = $(`[data-id="${CSS.escape(id)}"] .wv-like span`); if (lk) lk.textContent = String((Number(lk.textContent) || 0) + 1);
  try { await ensureSession(); await api('wsend', { ...creds(), type: 'like', msg: id }); } catch {}
}
async function reportMsg(id, li) {
  li.remove(); toast('Reported. Messages reported by several viewers are hidden for everyone.');
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
  box.replaceChildren(...parts); box.hidden = false; $('#wEmoji').setAttribute('aria-expanded', 'true');
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
  box.replaceChildren(...names.map((n) => {
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
    $('#wProducts').replaceChildren(...items.map((p) => {
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
function renderPollCard(info) {
  const p = info.poll; let card = $('#wCards [data-card="poll"]');
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
    b.onclick = async () => { try { await ensureSession(); await api('wsend', { ...creds(), type: 'vote', poll: p.id, opt: i }); W.votes[p.id] = i; store.set('votes:' + code, W.votes); renderPollCard(W.info); } catch (e) { toast(e.message, true); } };
    list.append(b);
  });
  fresh.append(k, q, list);
  if (p.kind === 'predict' && p.answer >= 0 && mine != null) { const res = document.createElement('small'); res.textContent = mine === p.answer ? '🎉 You called it!' : 'Not this time.'; fresh.append(res); }
  if (card) card.replaceWith(fresh); else $('#wCards').append(fresh);
}

W.queued = store.get('queued:' + code, false);
function renderQueueCard(info) {
  const qi = info.queue, card = $('#wCards [data-card="queue"]');
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
    leave.onclick = async () => { W.queued = false; store.set('queued:' + code, false); try { await api('wsend', { ...creds(), type: 'unqueue' }); } catch {} renderQueueCard(W.info); };
    c.append(b, leave);
  } else {
    const f = document.createElement('div'); f.className = 'wv-q';
    const inp = document.createElement('input'); inp.className = 'input'; inp.placeholder = 'Your gamertag'; inp.maxLength = 32; inp.value = store.get('gamertag', '');
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Join the line';
    go.onclick = async () => { try { await ensureSession(); store.set('gamertag', inp.value.trim()); await api('wsend', { ...creds(), type: 'queue', tag: inp.value.trim() }); W.queued = true; store.set('queued:' + code, true); renderQueueCard(W.info); } catch (e) { toast(e.message, true); } };
    f.append(inp, go); c.append(f);
  }
  if (card) card.replaceWith(c); else $('#wCards').append(c);
}

setInterval(async () => {
  if (!W.queued || W.called || !sess) return;
  try {
    const r = await api('wping', creds());
    if (r.queue?.status === 'called') { W.called = true; toast('🎮 You’re up! Open Stage to join.'); try { new AudioContext().resume(); } catch {} renderQueueCard(W.info); updateStageStatus(W.info); }
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
          const im1 = document.createElement('img'); im1.src = r.avatar; im1.alt = ''; av.replaceChildren(im1); av.style.background = 'none';
          const im2 = document.createElement('img'); im2.src = r.avatar; im2.alt = ''; topAv.replaceChildren(im2); topAv.style.background = 'none';
          if (slateAv) { const im3 = document.createElement('img'); im3.src = r.avatar; im3.alt = ''; slateAv.replaceChildren(im3); slateAv.style.background = 'none'; }
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
    $('#wHostLinks').replaceChildren(...links.map((l) => { const li = document.createElement('li'), a = document.createElement('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener nofollow'; a.textContent = l.label; li.append(a); return li; }));
  }
  $('#wHostLinks').hidden = !links.length;
}

// ---------------------------------------------------------------- Watch Party Bento Hub (Creator Profile + Showcase)
const STREAM_TYPES = {
  live: { label: 'Live Stream', short: 'Live', icon: 'i-radio' },
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
    $('#wWatchBadgeTxt').textContent = cfg.label;
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

  const tags = Array.isArray(info.hashtags) ? info.hashtags.filter(Boolean).slice(0, 8) : [];
  const tagsBox = $('#wCreatorTags');
  tagsBox.hidden = !tags.length;
  const tagKey = tags.join('|');
  if (tagsBox.dataset.k !== tagKey) {
    tagsBox.dataset.k = tagKey;
    tagsBox.replaceChildren(...tags.map((t) => {
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
        logo.replaceChildren(im);
      });
    } else if (W.hostAvatar) {
      const im = document.createElement('img'); im.src = W.hostAvatar; im.alt = '';
      logo.replaceChildren(im);
    }
  }
}
$('#wCardMoreBtn')?.addEventListener('click', () => openHostDrawer(true));

function setShowcaseTab(tab) {
  W.scTab = tab;
  $$('[data-sc-tab]').forEach((b) => {
    const on = b.dataset.scTab === tab;
    b.setAttribute('aria-selected', String(on));
  });
  if ($('#wPaneNotices')) $('#wPaneNotices').hidden = tab !== 'notices';
  if ($('#wPaneNext')) $('#wPaneNext').hidden = tab !== 'next';
  if ($('#wPaneSpotlight')) $('#wPaneSpotlight').hidden = tab !== 'spotlight';
}
$$('[data-sc-tab]').forEach((b) => b.addEventListener('click', () => setShowcaseTab(b.dataset.scTab)));

function renderShowcase(info) {
  const notices = Array.isArray(info.notices) ? info.notices : [];
  const next = info.whatNext || info.next || null;
  const spot = info.aiSpotlight || null;

  if ($('#wCntNotices')) { $('#wCntNotices').hidden = !notices.length; $('#wCntNotices').textContent = String(notices.length); }
  if ($('#wCntNext')) $('#wCntNext').hidden = !next;
  if ($('#wCntSpot')) $('#wCntSpot').hidden = !spot;

  const nBox = $('#wNoticesList');
  const w = info.watch || {};
  const canMic = w.voice !== false && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder;
  const canTip = !!(w.supers && w.chat !== false);
  const nKey = JSON.stringify([notices, canMic, canTip, info.found]);
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
        mkAct('i-sparkles', 'Interactive Stage', 'Join live polls, drops, and queue games', () => setTab('stage')),
        mkAct('i-activity', 'Room Pulse', 'Check crowd sentiment, pins, and viewers', () => setTab('pulse')),
      ];
      if (canMic) items.push(mkAct('i-mic', 'Ask by Voice', 'Record a 45s voice question for the host', () => voiceOpen()));
      if (canTip) items.push(mkAct('i-tip', 'Send a Super Chat', 'Highlight a tipped message on screen', () => openSuper()));
      if (items.length < 4) items.push(mkAct('i-share-2', 'Invite Friends', 'Share this Watch Party link', () => $('#wShareTop').click()));
      if (items.length < 4) items.push(mkAct('i-info', 'Show Details', 'View links, platforms, and host bio', () => openHostDrawer(true)));
      deck.replaceChildren(...items.slice(0, 4));
      nBox.replaceChildren(deck);
    } else {
      nBox.replaceChildren(...notices.map((n) => {
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
      nextBox.replaceChildren(em);
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
      nextBox.replaceChildren(card);
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
      spotBox.replaceChildren(em);
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
      spotBox.replaceChildren(card);
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
      const all = SUBS.get(); all[(r.handle || r.name).toLowerCase()] = r.t; SUBS.set(all);
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
    $('#wHereAvs').replaceChildren(...names.slice(0, 7).map((nm) => { const a = document.createElement('i'); a.textContent = initialsOf(nm); a.title = nm; a.style.background = nameColor(nm); return a; }));
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
