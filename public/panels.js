// The studio's side panels, upgraded as one system: every panel gets the same header (its rail icon in the accent
// colour, a title and a one-line description), long panels get a "find a setting" box and jump chips, and the
// collapsible sections open and close smoothly and remember how you left them.
// Plus the new tools that live in the panels: brand themes, "brand from your logo", built-in music and AI quick
// actions. app.js hands over the few functions these need through init().
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('gather:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gather:' + k, JSON.stringify(v)); } catch {} },
};

const PANEL_INFO = {
  chat: ['message-square', 'Everything said in the studio and on every platform'],
  show: ['clapperboard', 'Watch page, viewers, super chats and what the stage does'],
  layouts: ['palette', 'Arrange the stage: layouts, scenes and elements'],
  brand: ['palette', 'Your colours, backdrop, logo and type'],
  overlays: ['palette', 'Banners, lower thirds, frames and on-screen graphics'],
  shop: ['shopping-bag', 'Products, checkout links and support'],
  polls: ['bar-chart-2', 'Polls, Q&A and audience moments'],
  gaming: ['gamepad-2', 'Scoreboard, bounties, lobby and play-with-me'],
  music: ['music', 'Background music that ducks when anyone speaks'],
};
const icon = (n) => `<svg class="i" aria-hidden="true"><use href="/icons.svg#i-${n}"/></svg>`;

// ---------------------------------------------------------------- headers, search and jump chips
function upgradeHeaders() {
  for (const p of $$('.panel')) {
    const info = PANEL_INFO[p.dataset.panel], head = $('.panel-head', p);
    if (!info || !head || head.classList.contains('ph2')) continue;
    head.classList.add('ph2');
    const h2 = $('h2', head);
    const ic = document.createElement('span'); ic.className = 'ph-ic'; ic.innerHTML = icon(info[0]);
    const wrap = document.createElement('div'); wrap.className = 'ph-title';
    h2.replaceWith(wrap); wrap.append(h2);
    const sub = document.createElement('small'); sub.className = 'ph-sub'; sub.textContent = info[1]; wrap.append(sub);
    head.prepend(ic);
    // a static subtitle that the new header line now covers
    const meta = $('.panel-meta', head); if (meta && !meta.id) meta.remove();
    const secs = $$('details.psec', p).filter((d) => !d.parentElement.closest('details.psec'));
    if (secs.length >= 3) addFinder(p, secs);
  }
}
function addFinder(p, secs) {
  const bar = document.createElement('div'); bar.className = 'ph-tools';
  const find = document.createElement('label'); find.className = 'ph-find';
  find.innerHTML = `${icon('search')}<input type="search" placeholder="Find a setting" aria-label="Find a setting in this panel" spellcheck="false">`;
  const chips = document.createElement('div'); chips.className = 'ph-chips'; chips.setAttribute('role', 'list');
  for (const s of secs) {
    const label = $('summary b', s)?.textContent.trim(); if (!label) continue;
    const c = document.createElement('button'); c.type = 'button'; c.className = 'ph-chip'; c.textContent = label.replace(/&amp;/g, '&');
    c.onclick = () => { if (!s.open) toggle(s, true); s.scrollIntoView({ block: 'start', behavior: 'smooth' }); s.classList.add('ph-flash'); setTimeout(() => s.classList.remove('ph-flash'), 1200); };
    chips.append(c);
  }
  bar.append(find, chips);
  $('.panel-head', p).after(bar);
  const input = $('input', find);
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    for (const s of secs) {
      const hit = !q || s.textContent.toLowerCase().includes(q);
      s.hidden = !hit;
      if (q && hit && !s.open) { s.open = true; s.dataset.autoOpened = '1'; }
      if (!q && s.dataset.autoOpened) { s.open = false; delete s.dataset.autoOpened; }
    }
    chips.hidden = !!q;
  });
}

// ---------------------------------------------------------------- smooth sections that remember their state
function toggle(d, open) {
  const body = $('.psec-body', d);
  if (!body || matchMedia('(prefers-reduced-motion: reduce)').matches) { d.open = open; return; }
  if (open) {
    d.open = true;
    const h = body.scrollHeight;
    body.animate([{ height: '0px', opacity: 0, transform: 'translateY(-4px)' }, { height: h + 'px', opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  } else {
    const h = body.scrollHeight;
    const a = body.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.4,0,.2,1)' });
    a.onfinish = () => { d.open = false; };
  }
}
function smoothSections() {
  const saved = store.get('secOpen', {});
  for (const d of $$('details.psec')) {
    const key = (d.closest('.panel')?.dataset.panel || '') + ':' + (d.dataset.sec || '');
    if (key in saved) d.open = !!saved[key];
    const sum = $('summary', d); if (!sum || sum.dataset.smooth) continue;
    sum.dataset.smooth = '1';
    sum.addEventListener('click', (e) => {
      e.preventDefault();
      const open = !d.open; toggle(d, open);
      const s = store.get('secOpen', {}); s[key] = open; store.set('secOpen', s);
    });
  }
}

// panels slide in softly when you switch tabs
function panelEnter() {
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      const p = m.target;
      if (m.attributeName === 'hidden' && !p.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        p.animate([{ opacity: 0, transform: 'translateX(10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
  });
  for (const p of $$('.panel')) mo.observe(p, { attributes: true, attributeFilter: ['hidden'] });
}

// ---------------------------------------------------------------- brand themes: one tap restyles the whole show
export const THEMES = [
  { id: 'midnight', name: 'Midnight Pro', color: '#3b82f6', bg: 'dusk', font: 'jakarta', tag: 'glass', bannerStyle: 'glass', anim: 'slide', frame: 'none', panel: 'glass' },
  { id: 'creator', name: 'Creator Pop', color: '#ec4899', bg: 'dusk', font: 'onest', tag: 'solid', bannerStyle: 'bold', anim: 'pop', frame: 'corners', panel: 'glass' },
  { id: 'esports', name: 'Esports', color: '#22d3ee', bg: 'graphite', font: 'bebas', tag: 'solid', bannerStyle: 'bold', anim: 'wipe', frame: 'corners', panel: 'solid', panelColor: '#0b1220' },
  { id: 'luxe', name: 'Luxe', color: '#c8a45a', bg: 'graphite', font: 'playfair', tag: 'minimal', bannerStyle: 'minimal', anim: 'fade', frame: 'border', panel: 'solid', panelColor: '#111111' },
  { id: 'studio', name: 'Clean Studio', color: '#2563eb', bg: 'paper', font: 'jakarta', tag: 'outline', bannerStyle: 'classic', anim: 'fade', frame: 'none', panel: 'glass' },
  { id: 'shop', name: 'Live Shop', color: '#f97316', bg: 'ember', font: 'onest', tag: 'solid', bannerStyle: 'bold', anim: 'pop', frame: 'none', panel: 'glass' },
  { id: 'nature', name: 'Calm', color: '#10b981', bg: 'forest', font: 'serif', tag: 'glass', bannerStyle: 'glass', anim: 'fade', frame: 'vignette', panel: 'glass' },
  { id: 'terminal', name: 'Dev Stream', color: '#a3e635', bg: 'graphite', font: 'mono', tag: 'outline', bannerStyle: 'minimal', anim: 'type', frame: 'none', panel: 'solid', panelColor: '#0a0f0a' },
];
const FONT_CSS = { jakarta: '"Plus Jakarta Sans"', onest: 'Onest', playfair: '"Playfair Display"', bebas: '"Bebas Neue"', mono: '"JetBrains Mono"', serif: '"DM Serif Display"' };
const BG_CSS = { dusk: null, ember: '#3a1d24,#a0533a', forest: '#10291f,#3b6b4b', graphite: '#15181d,#3a404b', paper: '#f1efe9,#d4d0c4' };

function themeCard(t) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'bt-card'; b.dataset.theme = t.id;
  const bg = BG_CSS[t.bg] ? `linear-gradient(135deg,${BG_CSS[t.bg]})` : `linear-gradient(135deg, color-mix(in srgb, ${t.color} 22%, #05070d), color-mix(in srgb, ${t.color} 48%, #0b0f1e))`;
  b.innerHTML = `<span class="bt-prev" style="background:${bg}"><i class="bt-bar" style="background:${t.color}"></i><i class="bt-tag" style="font-family:${FONT_CSS[t.font]};color:${t.bg === 'paper' ? '#111' : '#fff'}">Aa</i><i class="bt-dot" style="background:${t.color}"></i></span><span class="bt-name"></span>`;
  $('.bt-name', b).textContent = t.name;
  b.setAttribute('aria-label', `Apply the ${t.name} theme`);
  return b;
}

// ---------------------------------------------------------------- brand from your logo: pull its colours
export async function paletteFrom(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas'), n = 64; c.width = n; c.height = n;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data, buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const sat = mx ? (mx - mn) / mx : 0;
      if (mx < 28 || (mn > 232) || sat < 0.18) continue; // skip black, white and greys: we want brand colours
      const key = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4);
      const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, s: 0 };
      e.r += r; e.g += gg; e.b += b; e.n++; e.s += sat; buckets.set(key, e);
    }
    const hex = (e) => '#' + [e.r, e.g, e.b].map((v) => Math.round(v / e.n).toString(16).padStart(2, '0')).join('');
    const out = [];
    for (const e of [...buckets.values()].sort((a, b) => b.n * (0.5 + b.s / b.n) - a.n * (0.5 + a.s / a.n))) {
      const h = hex(e), rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
      if (out.every((o) => Math.hypot(o.rgb[0] - rgb[0], o.rgb[1] - rgb[1], o.rgb[2] - rgb[2]) > 60)) out.push({ hex: h, rgb });
      if (out.length >= 6) break;
    }
    return out.map((o) => o.hex);
  } finally { URL.revokeObjectURL(url); }
}

// ---------------------------------------------------------------- built-in music: loops rendered right in the browser
const MOODS = {
  lofi: { name: 'Lo-fi', sub: 'Warm keys, lazy beat', bpm: 78, chords: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]], wave: 'triangle', kick: [0, 10], snare: [4, 12], hat: 2, swing: 0.12 },
  chill: { name: 'Chill', sub: 'Soft pads, no drums', bpm: 64, chords: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]], wave: 'sine', kick: [], snare: [], hat: 0, swing: 0 },
  upbeat: { name: 'Upbeat', sub: 'Bright and bouncy', bpm: 116, chords: [[60, 64, 67, 72], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]], wave: 'sawtooth', kick: [0, 4, 8, 12], snare: [4, 12], hat: 1, swing: 0 },
  hype: { name: 'Hype', sub: 'Big drums for game time', bpm: 140, chords: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 58], [40, 47, 52, 55]], wave: 'square', kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: 1, swing: 0 },
};
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
export async function renderMood(id) {
  const m = MOODS[id], sr = 44100, beat = 60 / m.bpm, bar = beat * 4, bars = 8, len = bar * bars;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * len), sr);
  const master = ctx.createGain(); master.gain.value = 0.55;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = m.wave === 'sawtooth' || m.wave === 'square' ? 2400 : 3200;
  lp.connect(master); master.connect(ctx.destination);
  const noise = ctx.createBuffer(1, sr, sr); const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar, ch = m.chords[b % m.chords.length];
    // pad / keys
    for (const note of ch) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = m.wave; o.frequency.value = midi(note); o.detune.value = (Math.random() - 0.5) * 8;
      const peak = m.wave === 'sine' ? 0.1 : m.wave === 'triangle' ? 0.08 : 0.035;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + (m.hat ? 0.03 : 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + bar * 0.98);
      o.connect(g).connect(lp); o.start(t0); o.stop(t0 + bar);
    }
    // bass on the root
    const bo = ctx.createOscillator(), bg = ctx.createGain(); bo.type = 'sine'; bo.frequency.value = midi(ch[0] - 12);
    bg.gain.setValueAtTime(0.0001, t0); bg.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02); bg.gain.exponentialRampToValueAtTime(0.0001, t0 + bar * 0.9);
    bo.connect(bg).connect(master); bo.start(t0); bo.stop(t0 + bar);
    // drums on a 16-step grid
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * beat / 4 + (s % 2 ? m.swing * beat / 4 : 0);
      if (m.kick.includes(s)) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g).connect(master); o.start(t); o.stop(t + 0.32); }
      const hit = (dur, vol, freq) => { const src = ctx.createBufferSource(); src.buffer = noise; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq; const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02); };
      if (m.snare.includes(s)) hit(0.18, 0.28, 1500);
      if (m.hat && s % m.hat === 0 && !(m.hat === 1 && s % 2)) hit(0.04, 0.07, 7000);
    }
  }
  const buf = await ctx.startRendering();
  return new File([wav(buf)], `${m.name} (gather).wav`, { type: 'audio/wav' });
}
function wav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return out.buffer;
}

// ---------------------------------------------------------------- wiring
export function initPanels(api) {
  upgradeHeaders();
  smoothSections();
  panelEnter();

  // brand themes + brand from logo, at the top of Look → Brand
  const kit = $('#brandKit');
  if (kit && !$('#brandThemes')) {
    const sec = document.createElement('div'); sec.className = 'bt-wrap'; sec.id = 'brandThemes';
    sec.innerHTML = `<div class="bt-head"><b>Themes</b><small>One tap restyles colours, type, banners and frames</small></div><div class="bt-grid" role="list"></div>
      <div class="bt-logo"><button type="button" class="btn sm" id="btLogoBtn">${icon('upload')}Brand from my logo</button><small>We pull your colours from it and set it as your logo</small><input type="file" id="btLogoFile" accept="image/*" hidden></div>
      <div class="bt-pal" id="btPal" hidden></div>`;
    kit.after(sec);
    const grid = $('.bt-grid', sec);
    for (const t of THEMES) {
      const c = themeCard(t);
      c.onclick = () => {
        if (!api.isHost()) return api.toast('Only the host can change the brand.', { err: true });
        const { id, name, ...brand } = t; void id;
        api.setStage({ brand: { ...brand, bgImage: '' } });
        $$('.bt-card', grid).forEach((x) => x.classList.toggle('on', x === c));
        api.toast(`${name} theme applied. Fine-tune anything below.`);
      };
      grid.append(c);
    }
    $('#btLogoBtn').onclick = () => (api.isHost() ? $('#btLogoFile').click() : api.toast('Only the host can change the brand.', { err: true }));
    $('#btLogoFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      api.brandImage('logo', f);
      const cols = await paletteFrom(f).catch(() => []);
      const pal = $('#btPal'); pal.hidden = !cols.length;
      if (!cols.length) return api.toast('Logo set. It has no strong colours, so pick an accent below.');
      pal.replaceChildren(Object.assign(document.createElement('small'), { textContent: 'Colours from your logo. Tap one for your accent:' }),
        ...cols.map((h, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bt-sw'; b.style.setProperty('--c', h); b.setAttribute('aria-label', 'Use ' + h); b.title = h; b.onclick = () => { api.setStage({ brand: { color: h } }); $$('.bt-sw', pal).forEach((x) => x.classList.toggle('on', x === b)); }; if (!i) b.classList.add('on'); return b; }));
      api.setStage({ brand: { color: cols[0] } });
      api.toast('Logo set and your accent now matches it.');
    };
  }

  // built-in music moods, above "Choose audio track"
  const music = $('#musicSec .psec-body');
  if (music && !$('#moodGrid')) {
    const box = document.createElement('div'); box.className = 'mood-wrap';
    box.innerHTML = `<div class="bt-head"><b>Built-in music</b><small>Made for you on the spot. Free to stream, no copyright strikes.</small></div><div class="mood-grid" id="moodGrid"></div><div class="mood-or"><span>or use your own</span></div>`;
    music.prepend(box);
    for (const [id, m] of Object.entries(MOODS)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mood'; b.dataset.mood = id;
      b.innerHTML = `<span class="mood-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><b></b><small></small>`;
      $('b', b).textContent = m.name; $('small', b).textContent = `${m.sub} · ${m.bpm} bpm`;
      b.onclick = async () => {
        $$('.mood', box).forEach((x) => x.classList.toggle('on', x === b)); b.classList.add('busy');
        try { api.playMusicFile(await renderMood(id)); } catch (e) { api.toast('Couldn’t make that track: ' + (e.message || e), { err: true }); }
        finally { b.classList.remove('busy'); }
      };
      $('#moodGrid').append(b);
    }
  }

  // AI quick actions at the top of the AI panel
  const aiBody = $('.ai-body');
  if (aiBody && !$('#aiQuick')) {
    const q = document.createElement('div'); q.className = 'ai-quick host-only'; q.id = 'aiQuick';
    q.innerHTML = '<div class="bt-head"><b>Quick actions</b><small>One tap. Sam does the rest.</small></div><div class="aq-grid"></div>';
    const acts = [
      ['sparkles', 'Design an overlay', () => api.designer('overlay')],
      ['image', 'Make a thumbnail', () => api.designer('thumb')],
      ['palette', 'Design a backdrop', () => api.designer('backdrop')],
      ['star', 'Create a logo', () => api.designer('logo')],
      ['file-text', 'Title, description & tags', () => api.ask('Write a catchy stream title, a two-sentence description and 8 hashtags for my show. Put the title on screen if I say yes.')],
      ['message-square', 'Sum up the chat', () => api.ask('Sum up what chat has been saying in the last 10 minutes: top questions, mood, and anything I should answer on air.')],
      ['bar-chart-2', 'Start a poll', () => api.ask('Suggest a fun poll for my audience right now based on the chat, then start it.')],
      ['presentation', 'Run of show', () => api.ask('Make a short run of show for the next 30 minutes with segments and timings, and put the next segment in the What’s next card.')],
    ];
    for (const [ic, label, fn] of acts) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'aq';
      b.innerHTML = `<span class="aq-ic">${icon(ic)}</span><span></span>`; $('span:last-child', b).textContent = label; b.onclick = fn;
      $('.aq-grid', q).append(b);
    }
    aiBody.prepend(q);
  }
}
