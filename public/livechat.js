import { busy, togglePopover, cssEsc } from './ui.js';
import { configureGoogle, googleConfigured, googleSignedIn, googleToken, googleSignOut, findLiveChat, pollLiveChat, ytModerate } from './google.js';

// Live chat in the studio: the crowd mood meter, moderation, message chrome, and YouTube and Rumble chat.
// Created by app.js through createLiveChat(app): `app` carries the studio state and helpers this part uses.
export function createLiveChat(app) {
  const {
    $, $$, store, S, isHost, toast, api, creds, wsSend, setStage, seenFeed, addExternal, renderAIPanel,
    syncWizAiBar, renderLive, renderDriveButton, renderProducerUI, renderVoiceNames
  } = app;
  // ---------------------------------------------------------------- live chat real-time sentiment mood meter
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
    let raw = meta.paid ? 0.5 : 0;
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

  function analyzeChatMood() {
    const recent = S.feed.filter((m) => m && m.src !== 'studio' && !isModerated(m)).slice(-30);
    if (!recent.length) {
      return { state: 'idle', label: 'Quiet', pct: 50, displayPct: '—', total: 0, pos: 0, neu: 0, neg: 0, meta: 'Waiting for viewer chat' };
    }
    let weighted = 0, wSum = 0, pos = 0, neu = 0, neg = 0;
    for (let i = 0; i < recent.length; i++) {
      const sc = scoreMessageSentiment(recent[i].text, recent[i]);
      if (sc >= 0.2) pos++;
      else if (sc <= -0.2) neg++;
      else neu++;
      const age = recent.length - 1 - i;
      const w = Math.pow(0.92, age);
      weighted += sc * w;
      wSum += w;
    }
    const avg = wSum ? weighted / wSum : 0;
    const pct = Math.max(0, Math.min(100, Math.round(((avg + 1) / 2) * 100)));
    const state = pct >= 72 ? 'hype' : pct >= 58 ? 'warm' : pct >= 43 ? 'steady' : pct >= 28 ? 'mixed' : 'tense';
    const label = { hype: 'Hyped', warm: 'Positive', steady: 'Steady', mixed: 'Mixed', tense: 'Tense' }[state];
    const meta = `${recent.length} viewer msg${recent.length === 1 ? '' : 's'} · ${pos} pos · ${neu} neu · ${neg} neg`;
    return { state, label, pct, displayPct: `${pct}%`, total: recent.length, pos, neu, neg, meta };
  }

  function renderChatMood() {
    const box = $('#chatMood');
    if (!box) return;
    const m = analyzeChatMood();
    box.dataset.mood = m.state;
    const bar = $('#chatMoodBar');
    if (bar) bar.style.width = `${m.pct}%`;
    const ic = $('#chatMoodIconUse');
    if (ic) {
      const iconId = { idle: 'i-activity', hype: 'i-flame', warm: 'i-smile', steady: 'i-activity', mixed: 'i-meh', tense: 'i-frown' }[m.state] || 'i-activity';
      ic.setAttribute('href', `/icons.svg#${iconId}`);
    }
    const lbl = $('#chatMoodLabel');
    if (lbl) lbl.textContent = m.total ? m.label : 'Quiet';
    const pctEl = $('#chatMoodPct');
    if (pctEl) {
      pctEl.hidden = !m.total;
      pctEl.textContent = m.total ? m.displayPct : '';
    }
    const desc = m.total
      ? `Crowd sentiment: ${m.label} (${m.pct}%) — ${m.meta}. Hover bar for live viewer mood.`
      : 'Crowd sentiment: Quiet — measures viewer chat positivity & hype in real time.';
    box.setAttribute('aria-valuenow', String(m.pct));
    box.setAttribute('aria-valuetext', desc);
    box.dataset.tip = desc;
    const tip = $('#ui-tooltip');
    if (tip && box.getAttribute('aria-describedby') === tip.id && tip.classList.contains('show')) {
      tip.textContent = desc;
    }
  }

  // Moderation is enforced by gather for every platform: hidden, timed-out and blocked viewers
  // disappear from the overlay and from everyone's studio chat. Lists live in the shared stage state.
  const modState = () => S.state.mod || { hidden: [], blocked: [], timeouts: [] };
  function isModerated(m) {
    const mod = modState(), user = String(m.name || m.user || '').toLowerCase(), src = m.src || 'studio', now = Date.now();
    if (mod.hidden.includes(m.id)) return 'by host';
    if (mod.blocked.some((x) => x.src === src && x.user === user)) return 'blocked';
    if (mod.timeouts.some((x) => x.src === src && x.user === user && x.until > now)) return 'timed out';
    return '';
  }
  function deleteMessage(m) {
    if (!isHost() || !m?.id) return;
    if (S.studio) wsSend({ type: 'chatDel', id: m.id });
    const mod = structuredClone(modState());
    if (!mod.hidden.includes(m.id)) mod.hidden.push(m.id);
    const patch = { mod };
    if (S.state.featured?.id === m.id) patch.featured = null;
    setStage(patch);
    $$(`#msgs li[data-fid="${cssEsc(m.id)}"]`).forEach((li) => li.remove());
    const idx = S.feed.findIndex((x) => x.id === m.id);
    if (idx >= 0) S.feed.splice(idx, 1);
    renderChatMood();
    if (m.src === 'youtube' && yt.liveChatId) {
      ytModerate('hide', yt.liveChatId, m).catch(() => {});
    }
    toast('Message deleted.');
  }
  function moderate(kind, m, secs) {
    if (!isHost()) return;
    if (kind === 'delete') return deleteMessage(m);
    const mod = structuredClone(modState()), user = String(m.name || m.user || '').toLowerCase(), src = m.src || 'studio';
    if (kind === 'hide' && !mod.hidden.includes(m.id)) mod.hidden.push(m.id);
    if (kind === 'unhide') {
      mod.hidden = mod.hidden.filter((x) => x !== m.id);
      mod.blocked = mod.blocked.filter((x) => !(x.src === src && x.user === user));
      mod.timeouts = mod.timeouts.filter((x) => !(x.src === src && x.user === user));
    }
    if (kind === 'block' && !mod.blocked.some((x) => x.src === src && x.user === user)) mod.blocked.push({ src, user });
    if (kind === 'timeout') {
      mod.timeouts = mod.timeouts.filter((x) => !(x.src === src && x.user === user));
      mod.timeouts.push({ src, user, until: Date.now() + secs * 1000 });
    }
    const patch = { mod };
    const f = S.state.featured;
    if (kind !== 'unhide' && f && (f.id === m.id || (kind !== 'hide' && f.src === src && String(f.name).toLowerCase() === user))) patch.featured = null;
    setStage(patch);
    renderModList();
    const label = { hide: 'Message hidden', block: `${m.name} blocked`, timeout: `${m.name} timed out for ${secs >= 3600 ? secs / 3600 + ' h' : secs / 60 + ' min'}`, unhide: `${m.name} unblocked` }[kind];
    if (src === 'youtube' && kind !== 'unhide') {
      if (!yt.liveChatId) return toast(`${label} in gather. Connect YouTube in the Stream tab to also apply it on YouTube.`);
      ytModerate(kind, yt.liveChatId, m, secs)
        .then(() => toast(`${label}, in gather and on YouTube.`))
        .catch((e) => toast(`${label} in gather. YouTube didn’t take it: ${e.message}`, { err: true, ms: 6000 }));
      return;
    }
    const platformSide = { twitch: 'Twitch', x: 'X' }[src];
    toast(label + (kind !== 'unhide' && platformSide ? ` in gather. ${platformSide} has no moderation access from gather yet, so it stays visible there.` : '.'));
  }
  let timeoutFor = null, timeoutPop = null;
  function timeoutMenu() {
    if (timeoutPop) return timeoutPop;
    timeoutPop = document.createElement('div');
    timeoutPop.className = 'popover glass raised'; timeoutPop.popover = 'auto'; timeoutPop.setAttribute('role', 'menu'); timeoutPop.setAttribute('aria-label', 'Time out for');
    const menu = document.createElement('div'); menu.className = 'menu';
    for (const [sec, l] of [[300, '5 minutes'], [3600, '1 hour'], [86400, '24 hours']]) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'menu-item compact'; b.setAttribute('role', 'menuitem'); b.textContent = l;
      b.onclick = () => { timeoutPop.hidePopover(); if (timeoutFor) moderate('timeout', timeoutFor, sec); };
      menu.append(b);
    }
    timeoutPop.append(menu);
    document.body.append(timeoutPop);
    return timeoutPop;
  }
  function renderModList() {
    const sec = $('#chatModSec'), list = $('#chatModList'), cnt = $('#chatModCount');
    if (!sec || !list) return;
    const mod = modState(), now = Date.now();
    const rows = [
      ...(mod.blocked || []).map((x) => ({ kind: 'Blocked', src: x.src, user: x.user })),
      ...(mod.timeouts || []).filter((x) => x.until > now).map((x) => ({ kind: `${Math.ceil((x.until - now) / 60000)}m left`, src: x.src, user: x.user })),
    ];
    sec.hidden = !rows.length || !isHost();
    if (cnt) cnt.textContent = String(rows.length);
    list.replaceChildren(...rows.map((r) => {
      const li = document.createElement('li'); li.className = 'chat-mod-row';
      const info = document.createElement('span'); info.className = 'chat-mod-who';
      info.innerHTML = `<b></b><small></small>`;
      info.querySelector('b').textContent = r.user;
      info.querySelector('small').textContent = `${r.kind} · ${r.src}`;
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn sm ghost'; btn.textContent = 'Unblock';
      btn.onclick = () => moderate('unhide', { id: '', src: r.src, name: r.user });
      li.append(info, btn);
      return li;
    }));
  }
  // Every chat line: avatar, name, time, a like button, then the message.
  const CHAT_HUES = [210, 262, 330, 20, 145, 190, 45, 290];
  function chatColor(name) { let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${CHAT_HUES[h % CHAT_HUES.length]} 70% 58%)`; }
  function chatAvatar(name, img) {
    const a = document.createElement('span'); a.className = 'cav'; a.setAttribute('aria-hidden', 'true');
    if (img && /^data:image\/(jpeg|png|webp);base64,/.test(img)) { const i = document.createElement('img'); i.src = img; i.alt = ''; a.append(i); }
    else { a.style.background = chatColor(name); a.textContent = String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?'; }
    return a;
  }
  function chatTime(ts) { const t = document.createElement('time'); const d = new Date(ts || Date.now()); t.dateTime = d.toISOString(); t.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return t; }
  const LIKED = new Set();
  function likeBtn(id, n = 0) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'clike'; b.dataset.like = id;
    b.setAttribute('aria-label', 'Like'); b.setAttribute('aria-pressed', String(LIKED.has(id)));
    b.innerHTML = '<svg class="i" aria-hidden="true"><use href="/icons.svg#i-heart"/></svg><span></span>';
    b.querySelector('span').textContent = n ? String(n) : '';
    b.onclick = () => {
      if (!S.studio || LIKED.has(id)) return;
      LIKED.add(id); b.setAttribute('aria-pressed', 'true');
      const sp = b.querySelector('span'); sp.textContent = String((Number(sp.textContent) || 0) + 1);
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      wsSend({ type: 'like', id });
    };
    return b;
  }
  function setLikes(id, n, from) {
    if (from === S.id) LIKED.add(id);
    for (const b of document.querySelectorAll(`#msgs [data-like="${cssEsc(id)}"]`)) { b.querySelector('span').textContent = n ? String(n) : ''; b.setAttribute('aria-pressed', String(LIKED.has(id))); }
  }
  /** Wrap a message: avatar on the left, then the name line (with time and like) and the words. */
  function chatShell(li, { id, name, ts, av, likes }) {
    const who = li.querySelector('.who');
    if (who) { who.append(chatTime(ts)); const sp = document.createElement('span'); sp.className = 'cgrow'; who.append(sp, likeBtn(id, likes)); }
    li.classList.add('has-av');
    li.prepend(chatAvatar(name, av));
  }
  function msgActions(m) {
    const bar = document.createElement('div'); bar.className = 'mact host-only';
    const mk = (txt, cls, fn, title = '') => {
      const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt;
      if (title) b.title = title;
      b.onclick = fn; return b;
    };
    const isSelf = m.src === 'studio' && m.from && m.from === S.id;
    bar.append(mk('Stage', 'mact-btn accent feat', () => {
      const on = S.state.featured?.id === m.id;
      setStage({ featured: on ? null : { id: m.id, src: m.src, name: m.name, text: m.text, color: m.color || '' } });
    }, 'Show or hide this message on stage'));
    // Hide takes the message off the overlay and the viewers' feed but keeps it in the host's log;
    // Delete removes it outright. moderate() has always had the 'hide' verb — the button was missing.
    bar.append(mk('Hide', 'mact-btn mod-hide', () => moderate('hide', m), 'Hide this message from the overlay and viewers'));
    bar.append(mk('Delete', 'mact-btn danger mod-del', () => moderate('delete', m), 'Delete message'));
    if (!isSelf) {
      const tm = mk('Time out', 'mact-btn mod-to', (ev) => { timeoutFor = m; togglePopover(timeoutMenu(), ev.currentTarget, 'bottom'); }, 'Time out sender');
      tm.setAttribute('aria-haspopup', 'menu');
      bar.append(tm);
      bar.append(mk('Block', 'mact-btn danger mod-block', () => moderate('block', m), 'Block sender from chatting'));
    }
    bar.append(mk('Restore', 'mact-btn mod-restore', () => moderate('unhide', m), 'Restore message & unblock sender'));
    return bar;
  }
  function applyModeration(li) {
    const m = { id: li.dataset.fid, src: li.dataset.src, name: li.dataset.user };
    const why = isModerated(m);
    li.classList.toggle('modded', !!why);
    li.dataset.why = why;
  }
  function applyModerationAll() { $$('#msgs li[data-fid]').forEach(applyModeration); renderModList(); }

  // YouTube: the host signs in with Google (in this browser only), gather reads the broadcast's live chat,
  // relays new messages to the studio, and Hide / Time out / Block act on YouTube too.
  const yt = { liveChatId: '', title: '', stop: null };
  function setYtStatus(state, detail = '') {
    const el = $('#ytStatus');
    el.dataset.state = state === 'live' ? 'live' : state === 'error' || state === 'ended' ? 'error' : 'off';
    el.textContent = { live: `Reading “${yt.title}”`, connecting: 'Connecting…', error: detail || 'Something went wrong', ended: detail || 'The live chat has ended', off: googleConfigured() ? 'Not connected' : 'Needs Google sign-in set up on the server' }[state] || detail;
    $('#ytGo').textContent = yt.liveChatId ? 'Disconnect' : 'Connect';
  }
  function stopYouTube() { yt.stop?.(); Object.assign(yt, { liveChatId: '', title: '', stop: null }); S.ytVideoId = ''; setYtStatus('off'); }
  $('#ytForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!isHost()) return toast('Only the host can connect platform chat.', { err: true });
    if (yt.liveChatId) { stopYouTube(); return toast('YouTube chat disconnected.'); }
    if (!S.studio) return toast('Enter your studio first, then connect YouTube chat.', { err: true });
    busy($('#ytGo')); setYtStatus('connecting');
    try {
      const chat = await findLiveChat($('#ytInput').value);
      Object.assign(yt, chat);
      S.ytVideoId = chat.videoId || ''; // viewers.js reads its live viewer count
      yt.stop = pollLiveChat(chat.liveChatId, (items) => {
        const fresh = items.filter((m) => !seenFeed.has(m.id));
        fresh.forEach(addExternal);
        if (fresh.length) wsSend({ type: 'feed', items: fresh.map(({ id, src, name, color, text, ts, paid }) => ({ id, src, name, color, text, ts, paid })) });
      }, (state, detail) => { if (state !== 'live') { yt.stop?.(); yt.liveChatId = ''; } setYtStatus(state, detail); });
      setYtStatus('live');
      toast(`Connected to “${chat.title}”. Its chat now flows into gather.`);
    } catch (e) { setYtStatus('error', e.message); toast(e.message, { err: true }); }
    finally { busy($('#ytGo'), false); renderGoogle(); }
  });
  $('#driveAuto').onchange = async (e) => {
    if (!e.target.checked) { store.set('driveAuto', false); return renderGoogle(); }
    try { await googleToken(['drive']); store.set('driveAuto', true); toast('New recordings will be saved to Google Drive.'); }
    catch (err) { e.target.checked = false; toast(err.message, { err: true }); }
    renderGoogle();
  };
  $('#googleOut').onclick = async () => { stopYouTube(); await googleSignOut(); store.set('driveAuto', false); renderGoogle(); toast('Disconnected from Google.'); };
  function renderGoogle() {
    const ok = googleConfigured(), host = isHost();
    $('#ytGo').disabled = !ok || !host; $('#ytInput').disabled = !ok || !host;
    $('#driveAuto').disabled = !ok; $('#driveAuto').checked = ok && !!store.get('driveAuto', false);
    $('#driveNote').textContent = ok ? 'Each recording goes into a “gather recordings” folder in your Drive.' : 'Needs Google sign-in set up on this server (GOOGLE_CLIENT_ID in Vercel).';
    const parts = [googleSignedIn('drive') && 'Drive', googleSignedIn('youtube') && 'YouTube'].filter(Boolean);
    $('#googleState').textContent = !ok ? 'Google sign-in isn’t set up on this server yet.' : parts.length ? `Connected to Google: ${parts.join(' and ')}. Sign-in lasts an hour, then Google asks again.` : 'Not connected. You’ll be asked to sign in the first time you use Drive or YouTube.';
    $('#googleOut').hidden = !parts.length;
    if (!yt.liveChatId) setYtStatus('off');
    renderDriveButton();
  }
  S.configP = api('config').then((c) => {
    configureGoogle(c.googleClientId); renderGoogle();
    S.houseAI = c.houseAI || null; S.houseVoice = c.houseVoice || null; S.houseImages = c.houseImages || null; syncWizAiBar(); renderAIPanel(); renderProducerUI(); renderVoiceNames();
    S.relayOn = !!c.relay; renderLive();
    S.requireAccount = !!c.requireAccount;
    if (c.builtInTurn) $('#turnHint').textContent = 'gather’s built-in relay already connects guests on strict corporate and mobile networks. Add your own only if you need to.';
  }).catch(() => renderGoogle());

  // Rumble: the host's personal Live Stream API URL (contains a key) stays in the host's browser.
  // The host polls it through our proxy and relays new messages to the studio.
  const rumble = { timer: null, url: '', status: 'off', fails: 0 };
  function syncRumble() {
    const want = isHost() && S.studio ? store.get('rumbleUrl', '') : '';
    if (want === rumble.url) return;
    rumble.url = want; rumble.fails = 0;
    clearTimeout(rumble.timer);
    if (want) pollRumble(); else setRumbleStatus(store.get('rumbleUrl', '') ? 'saved' : 'off');
  }
  async function pollRumble() {
    if (!rumble.url || !S.studio) return;
    try {
      const r = await api('rumble', { ...creds(), url: rumble.url });
      rumble.fails = 0;
      setRumbleStatus(r.live ? 'live' : 'idle', r.title);
      (S.platViewers ||= {}).rumble = r.live && Number.isFinite(r.viewers) ? r.viewers : undefined;
      const fresh = r.msgs.filter((m) => !seenFeed.has(m.id));
      fresh.forEach(addExternal);
      if (fresh.length) wsSend({ type: 'feed', items: fresh });
    } catch (e) {
      rumble.fails++;
      setRumbleStatus('error', e.message);
    }
    rumble.timer = setTimeout(pollRumble, rumble.fails ? Math.min(60000, 5000 * 2 ** rumble.fails) : 5000);
  }
  function setRumbleStatus(st, detail = '') {
    rumble.status = st;
    const el = $('#rumbleStatus'); if (!el) return;
    el.dataset.state = st === 'live' ? 'live' : st === 'error' ? 'error' : 'off';
    el.textContent = { off: 'Not connected', saved: 'Connects when you enter a studio', idle: 'Connected · not live right now', live: `Reading ${detail ? '“' + detail + '”' : 'your live chat'}`, error: detail || 'Could not read Rumble chat' }[st];
  }

  return { renderChatMood, isModerated, setLikes, chatShell, msgActions, applyModeration, applyModerationAll, stopYouTube, renderGoogle, rumble, syncRumble, setRumbleStatus };
}
