// Upgraded Music & AI Audio Workstation for gather studio:
// 1. Audio Clips Grid (mounted via audio-clips.js)
// 2. AI Song & Beat Maker (prompt + 8 genres + key/scale + BPM + duration + 4-stem mixer + WAV export)
// 3. Interactive Waveform Audio Editor & FX (drag-to-trim, 6 FX presets, live Preview Edit, Fade In/Out, Speed/Pitch, 3-Band EQ, Lo-fi/Reverb, Reset, WAV export)
// 4. AI Soundboard & SFX Creator (12 broadcast stingers + SFX volume + quick prompt chips + Save to Audio Clips)
// 5. AI Intro & Voiceover Announcer (5 script presets, real system voice selector, speed/pitch, auto-duck toggle, Preview / Play on air / Stop)

import { mountAudioClips } from './audio-clips.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const GENRES = {
  lofi: { name: 'Lo-fi Chill', bpm: 78, wave: 'triangle', leadWave: 'sine', swing: 0.14, lp: 2400, kick: [0, 10], snare: [4, 12], hat: 2, prog: [0, 5, 3, 4], arp: [0, 2, 1, 3, 2, 0, 3, 1] },
  synthwave: { name: 'Synthwave', bpm: 108, wave: 'sawtooth', leadWave: 'square', swing: 0, lp: 3100, kick: [0, 4, 8, 12], snare: [4, 12], hat: 2, prog: [0, 5, 3, 4], arp: [0, 1, 2, 3, 2, 1, 2, 3] },
  hiphop: { name: 'Hip-Hop', bpm: 92, wave: 'triangle', leadWave: 'triangle', swing: 0.1, lp: 2600, kick: [0, 3, 10], snare: [4, 12], hat: 1, prog: [0, 3, 5, 4], arp: [0, 0, 2, 1, 0, 3, 2, 1] },
  cinematic: { name: 'Cinematic', bpm: 72, wave: 'sine', leadWave: 'triangle', swing: 0, lp: 3400, kick: [0, 8], snare: [], hat: 0, prog: [0, 4, 5, 3], arp: [0, 2, 3, 2, 1, 2, 3, 0] },
  funk: { name: 'Funk Groove', bpm: 114, wave: 'sawtooth', leadWave: 'triangle', swing: 0.08, lp: 3600, kick: [0, 6, 8, 14], snare: [4, 12], hat: 1, prog: [0, 3, 4, 3], arp: [0, 2, 3, 1, 2, 3, 1, 0] },
  ambient: { name: 'Ambient Pad', bpm: 64, wave: 'sine', leadWave: 'sine', swing: 0, lp: 2000, kick: [], snare: [], hat: 0, prog: [0, 5, 2, 4], arp: [0, 2, 1, 3] },
  esports: { name: 'Esports Hype', bpm: 138, wave: 'square', leadWave: 'sawtooth', swing: 0, lp: 4200, kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: 1, prog: [0, 5, 6, 4], arp: [0, 2, 3, 2, 0, 3, 2, 1] },
  podcast: { name: 'Podcast Intro', bpm: 102, wave: 'triangle', leadWave: 'sine', swing: 0.05, lp: 3000, kick: [0, 8, 10], snare: [4, 12], hat: 2, prog: [0, 3, 4, 0], arp: [0, 1, 2, 3, 2, 1, 0, 2] },
};

const KEYS = {
  cmin: { label: 'C minor', root: 48, scale: [0, 2, 3, 5, 7, 8, 10] },
  amin: { label: 'A minor', root: 45, scale: [0, 2, 3, 5, 7, 8, 10] },
  fmaj: { label: 'F major', root: 53, scale: [0, 2, 4, 5, 7, 9, 11] },
  gmaj: { label: 'G major', root: 55, scale: [0, 2, 4, 5, 7, 9, 11] },
  ddor: { label: 'D dorian', root: 50, scale: [0, 2, 3, 5, 7, 9, 10] },
  emin: { label: 'E minor', root: 52, scale: [0, 2, 3, 5, 7, 8, 10] },
};

const SONG_IDEAS = [
  { prompt: 'Warm midnight lo-fi beat with mellow electric keys for Q&A', genre: 'lofi', bpm: 78 },
  { prompt: 'Neon 80s synthwave driving pulse for countdown intro', genre: 'synthwave', bpm: 112 },
  { prompt: 'Crisp upbeat podcast bumper with clean groove and bass', genre: 'podcast', bpm: 104 },
  { prompt: 'High-energy esports tournament arena anthem', genre: 'esports', bpm: 140 },
  { prompt: 'Calm studio ambient synth pad for deep focus stream', genre: 'ambient', bpm: 64 },
];

const FX_PRESETS = [
  { id: 'flat', name: 'Flat', lowDb: 0, midDb: 0, highDb: 0, rate: 1, lofi: false, space: false },
  { id: 'radio', name: 'Warm Radio', lowDb: 4, midDb: 2, highDb: -2, rate: 1, lofi: false, space: false },
  { id: 'lofi', name: 'Lo-fi Tape', lowDb: 2, midDb: -2, highDb: -5, rate: 0.95, lofi: true, space: true },
  { id: 'bass', name: 'Club Bass', lowDb: 8, midDb: -1, highDb: 3, rate: 1.02, lofi: false, space: false },
  { id: 'vocal', name: 'Crisp Vocal', lowDb: -3, midDb: 4, highDb: 5, rate: 1, lofi: false, space: false },
  { id: 'hall', name: 'Space Hall', lowDb: 1, midDb: 0, highDb: 2, rate: 0.98, lofi: false, space: true },
];

const BUILTIN_SFX = [
  { id: 'whoosh', name: 'Whoosh', tone: '#38bdf8', key: '1' },
  { id: 'chime', name: 'Sparkle Chime', tone: '#a855f7', key: '2' },
  { id: 'applause', name: 'Applause', tone: '#10b981', key: '3' },
  { id: 'airhorn', name: 'Hype Horn', tone: '#f43f5e', key: '4' },
  { id: 'cash', name: 'Sale Ding', tone: '#f59e0b', key: '5' },
  { id: 'levelup', name: 'Level Up', tone: '#6366f1', key: '6' },
  { id: 'impact', name: 'Boom Hit', tone: '#ef4444', key: '' },
  { id: 'intro', name: 'Intro Jingle', tone: '#3b82f6', key: '' },
  { id: 'drumroll', name: 'Drumroll', tone: '#f97316', key: '' },
  { id: 'fanfare', name: 'Fanfare', tone: '#eab308', key: '' },
  { id: 'laser', name: 'Sci-Fi Laser', tone: '#06b6d4', key: '' },
  { id: 'glitch', name: 'Glitch Zap', tone: '#ec4899', key: '' },
];

const SFX_QUICK_PROMPTS = ['Sub bass drop', 'Notification ping', 'Victory fanfare', 'Drumroll tension', 'Glitch transition'];

const VO_PRESETS = [
  { id: 'intro', label: 'Show Intro', text: 'Welcome to the live show! Grab a seat, drop where you are tuning in from in chat, and let us dive right in.' },
  { id: 'back', label: 'Welcome Back', text: 'We are back from a quick break! Drop your questions in chat and we will pull the best ones up on stage.' },
  { id: 'sponsor', label: 'Sponsor Read', text: 'Today’s live stream is brought to you by our show partner. Check the pinned link in chat for an exclusive live discount.' },
  { id: 'cta', label: 'Follow CTA', text: 'If you are enjoying the show, hit follow and share the stream link with a friend who should be here live.' },
  { id: 'drop', label: 'Live Drop', text: 'Alert! Our limited live drop is officially unlocked in the shop tab right now. Grab yours before the timer hits zero.' },
];

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return out.buffer;
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function inferFromPrompt(prompt, genreId, bpm) {
  const p = String(prompt || '').toLowerCase();
  let g = genreId;
  if (!g || g === 'auto') {
    if (/synth|cyber|neon|80s|retro/.test(p)) g = 'synthwave';
    else if (/hip|trap|rap|boom|beat/.test(p)) g = 'hiphop';
    else if (/cinema|epic|orchestra|film|dramatic/.test(p)) g = 'cinematic';
    else if (/funk|disco|groove|party/.test(p)) g = 'funk';
    else if (/ambient|calm|sleep|study|meditat/.test(p)) g = 'ambient';
    else if (/game|hype|esport|action|boss|fast/.test(p)) g = 'esports';
    else if (/podcast|talk|news|intro/.test(p)) g = 'podcast';
    else g = 'lofi';
  }
  const base = GENRES[g] || GENRES.lofi;
  let finalBpm = Number(bpm) || base.bpm;
  if (/slow|chill|sleep|relax/.test(p) && !bpm) finalBpm = Math.max(64, base.bpm - 12);
  if (/fast|hype|energy|rush/.test(p) && !bpm) finalBpm = Math.min(156, base.bpm + 16);
  return { genre: g, cfg: base, bpm: finalBpm };
}

/** Synthesize a multi-stem stereo song/beat in the browser with OfflineAudioContext. */
export async function generateAiSong({ prompt = '', genre = 'lofi', key = 'cmin', bpm = 96, durSec = 24, energy = 0.7, stems = { drums: 1, bass: 1, chords: 1, lead: 0.8 } }) {
  const { cfg, bpm: useBpm } = inferFromPrompt(prompt, genre, bpm);
  const k = KEYS[key] || KEYS.cmin;
  const rand = hashSeed(`${prompt}|${genre}|${key}|${useBpm}`);
  const sr = 44100;
  const beat = 60 / Math.max(60, Math.min(165, useBpm));
  const bar = beat * 4;
  const bars = Math.max(4, Math.min(24, Math.round(durSec / bar)));
  const totalLen = bar * bars;

  const ctx = new OfflineAudioContext(2, Math.ceil(sr * totalLen), sr);
  const master = ctx.createGain();
  master.gain.value = 0.62;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cfg.lp + energy * 1400;
  lp.connect(master);
  master.connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, sr, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const scaleNote = (deg, oct = 0) => {
    const s = k.scale;
    const idx = ((deg % s.length) + s.length) % s.length;
    const oShift = Math.floor(deg / s.length) + oct;
    return k.root + s[idx] + oShift * 12;
  };

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const deg = cfg.prog[b % cfg.prog.length];
    const chord = [scaleNote(deg, 1), scaleNote(deg + 2, 1), scaleNote(deg + 4, 1), scaleNote(deg + 6, 1)];

    if (stems.chords > 0.02) {
      for (const note of chord) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = cfg.wave;
        o.frequency.value = midi(note);
        o.detune.value = (rand() - 0.5) * 10;
        const pk = (cfg.wave === 'sine' ? 0.11 : cfg.wave === 'triangle' ? 0.085 : 0.042) * stems.chords;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, pk), t0 + (cfg.hat ? 0.04 : 0.45));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + bar * 0.96);
        o.connect(g).connect(lp);
        o.start(t0);
        o.stop(t0 + bar);
      }
    }

    if (stems.bass > 0.02) {
      const steps = energy > 0.6 ? [0, 6, 8, 14] : [0, 8];
      for (const s of steps) {
        const t = t0 + s * (beat / 4);
        const bo = ctx.createOscillator(), bg = ctx.createGain();
        bo.type = genre === 'synthwave' || genre === 'esports' ? 'sawtooth' : 'sine';
        const bassNote = scaleNote(deg + (s === 14 ? 4 : 0), 0);
        bo.frequency.value = midi(bassNote);
        const bLp = ctx.createBiquadFilter(); bLp.type = 'lowpass'; bLp.frequency.value = 340;
        const pk = 0.26 * stems.bass;
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.exponentialRampToValueAtTime(Math.max(0.0002, pk), t + 0.02);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
        bo.connect(bLp).connect(bg).connect(master);
        bo.start(t);
        bo.stop(t + beat);
      }
    }

    if (stems.lead > 0.02) {
      const pattern = cfg.arp;
      for (let i = 0; i < pattern.length; i++) {
        if (rand() > 0.35 + energy * 0.55) continue;
        const t = t0 + i * (bar / pattern.length);
        const note = chord[pattern[i] % chord.length] + (rand() > 0.72 ? 12 : 0);
        const lo = ctx.createOscillator(), lg = ctx.createGain();
        lo.type = cfg.leadWave;
        lo.frequency.value = midi(note);
        const pk = 0.095 * stems.lead * (0.6 + energy * 0.4);
        lg.gain.setValueAtTime(0.0001, t);
        lg.gain.exponentialRampToValueAtTime(Math.max(0.0002, pk), t + 0.015);
        lg.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.55);
        lo.connect(lg).connect(lp);
        lo.start(t);
        lo.stop(t + beat * 0.6);
      }
    }

    if (stems.drums > 0.02 && (cfg.kick.length || cfg.snare.length)) {
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * (beat / 4) + (s % 2 ? cfg.swing * (beat / 4) : 0);
        if (cfg.kick.includes(s)) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.setValueAtTime(140, t);
          o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
          g.gain.setValueAtTime(0.68 * stems.drums, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          o.connect(g).connect(master);
          o.start(t);
          o.stop(t + 0.3);
        }
        const hit = (dur, vol, freq) => {
          const src = ctx.createBufferSource(); src.buffer = noiseBuf;
          const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
          const g = ctx.createGain();
          g.gain.setValueAtTime(vol * stems.drums, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          src.connect(f).connect(g).connect(master);
          src.start(t, rand() * 0.5);
          src.stop(t + dur + 0.02);
        };
        if (cfg.snare.includes(s)) hit(0.18, 0.28, 1500);
        if (cfg.hat && s % cfg.hat === 0 && (energy > 0.35 || s % 4 === 0)) hit(0.045, 0.075, 7200);
      }
    }
  }

  const buf = await ctx.startRendering();
  const safeTitle = (prompt.trim().slice(0, 26) || cfg.name).replace(/[^\w\s-]/g, '').trim() || 'AI Track';
  const file = new File([encodeWav(buf)], `${safeTitle} (${useBpm} bpm).wav`, { type: 'audio/wav' });
  return { file, buffer: buf, name: `${safeTitle} (${useBpm} bpm)` };
}

/** Synthesize instant broadcast SFX stinger (14 built-in + custom prompt inference). */
export async function renderSfxBuffer(kindOrPrompt, gainScale = 1) {
  const sr = 44100;
  const p = String(kindOrPrompt || 'chime').toLowerCase();
  const known = ['whoosh', 'chime', 'applause', 'airhorn', 'cash', 'levelup', 'impact', 'intro', 'drumroll', 'fanfare', 'laser', 'glitch', 'notification', 'subdrop'];
  const id = known.includes(p) ? p
    : /drum|roll|tension|snare/.test(p) ? 'drumroll'
    : /fanfare|victory|trumpet|win|celebrat/.test(p) ? 'fanfare'
    : /laser|zap|pew|sci|cyber|beam/.test(p) ? 'laser'
    : /glitch|static|error|buzz|retro/.test(p) ? 'glitch'
    : /notif|ping|bell|alert|pop/.test(p) ? 'notification'
    : /sub|bass|drop|808/.test(p) ? 'subdrop'
    : /whoosh|swoosh|wind|swipe|trans/.test(p) ? 'whoosh'
    : /horn|hype|air/.test(p) ? 'airhorn'
    : /clap|applause|cheer|crowd/.test(p) ? 'applause'
    : /cash|sale|coin|money|ding/.test(p) ? 'cash'
    : /level|game|power/.test(p) ? 'levelup'
    : /boom|hit|impact/.test(p) ? 'impact'
    : /intro|jingle|outro|logo/.test(p) ? 'intro'
    : 'chime';

  const dur = id === 'applause' || id === 'intro' || id === 'drumroll' || id === 'fanfare' ? 2.2
    : id === 'airhorn' || id === 'subdrop' ? 1.5
    : 1.1;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const master = ctx.createGain();
  master.gain.value = Math.max(0.1, Math.min(1.25, 0.72 * (Number(gainScale) || 1)));
  master.connect(ctx.destination);
  const noiseBuf = ctx.createBuffer(1, sr * 2, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  if (id === 'whoosh') {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.4;
    f.frequency.setValueAtTime(180, 0); f.frequency.exponentialRampToValueAtTime(2600, 0.35); f.frequency.exponentialRampToValueAtTime(240, 0.95);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.001, 0); g.gain.linearRampToValueAtTime(0.85, 0.32); g.gain.exponentialRampToValueAtTime(0.001, 1.0);
    src.connect(f).connect(g).connect(master); src.start(0); src.stop(1.05);
  } else if (id === 'airhorn') {
    for (const st of [0, 0.24, 0.48]) {
      const len = st === 0.48 ? 0.82 : 0.19;
      for (const freq of [466, 587, 698, 932]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.001, st); g.gain.linearRampToValueAtTime(0.14, st + 0.02); g.gain.setValueAtTime(0.14, st + len - 0.04); g.gain.exponentialRampToValueAtTime(0.001, st + len);
        o.connect(g).connect(master); o.start(st); o.stop(st + len + 0.02);
      }
    }
  } else if (id === 'applause') {
    for (let i = 0; i < 46; i++) {
      const t = (i / 46) * 1.7 + Math.random() * 0.14;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100 + Math.random() * 1400; f.Q.value = 1.6;
      const g = ctx.createGain(); const env = Math.sin((t / 2.1) * Math.PI);
      g.gain.setValueAtTime(0.18 * Math.max(0.2, env), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
      src.connect(f).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.1);
    }
  } else if (id === 'cash') {
    [[1318, 0], [1760, 0.1], [2637, 0.18]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.6);
    });
  } else if (id === 'levelup') {
    [523, 659, 784, 1046, 1318].forEach((f, idx) => {
      const t = idx * 0.095;
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(lp).connect(g).connect(master); o.start(t); o.stop(t + 0.25);
    });
  } else if (id === 'impact' || id === 'subdrop') {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(id === 'subdrop' ? 120 : 170, 0);
    o.frequency.exponentialRampToValueAtTime(id === 'subdrop' ? 28 : 34, id === 'subdrop' ? 1.1 : 0.55);
    g.gain.setValueAtTime(0.95, 0); g.gain.exponentialRampToValueAtTime(0.001, id === 'subdrop' ? 1.4 : 0.85);
    o.connect(g).connect(master); o.start(0); o.stop(id === 'subdrop' ? 1.45 : 0.9);
  } else if (id === 'drumroll') {
    for (let i = 0; i < 24; i++) {
      const t = i * 0.068;
      const ramp = 0.08 + (i / 24) * 0.34;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.setValueAtTime(ramp, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
      src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 0.5); src.stop(t + 0.085);
    }
    const cym = ctx.createBufferSource(); cym.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4600;
    const cg = ctx.createGain(); cg.gain.setValueAtTime(0.42, 1.65); cg.gain.exponentialRampToValueAtTime(0.001, 2.15);
    cym.connect(hp).connect(cg).connect(master); cym.start(1.65); cym.stop(2.18);
  } else if (id === 'fanfare') {
    [[523, 0, 0.2], [523, 0.22, 0.2], [523, 0.44, 0.2], [659, 0.66, 0.5], [784, 1.18, 0.9], [1046, 1.18, 0.9]].forEach(([f, t, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(lp).connect(g).connect(master); o.start(t); o.stop(t + d + 0.03);
    });
  } else if (id === 'laser') {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(2200, 0); o.frequency.exponentialRampToValueAtTime(140, 0.36);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
    g.gain.setValueAtTime(0.44, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.42);
    o.connect(lp).connect(g).connect(master); o.start(0); o.stop(0.45);
  } else if (id === 'glitch') {
    [0, 0.08, 0.15, 0.24, 0.34].forEach((t, idx) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = idx % 2 ? 'square' : 'sawtooth';
      o.frequency.value = 220 + ((idx * 379) % 1200);
      g.gain.setValueAtTime(0.26, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.075);
    });
  } else if (id === 'notification') {
    [[1046, 0], [1568, 0.11]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.36, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.46);
    });
  } else if (id === 'intro') {
    [[523, 0], [659, 0.18], [784, 0.36], [1046, 0.56], [784, 0.92], [1046, 1.15]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.28, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.7);
    });
  } else {
    [[880, 0], [1174, 0.09], [1568, 0.19]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g).connect(master); o.start(t); o.stop(t + 0.65);
    });
  }
  return ctx.startRendering();
}

/** Render an edited AudioBuffer & WAV File with Trim, Fade In/Out, Speed/Pitch, 3-Band EQ, and FX. */
async function renderEditedBuffer(srcBuf, opts = {}) {
  const sr = srcBuf.sampleRate;
  const trimStart = Math.max(0, Math.min(0.92, Number(opts.trimStart) || 0));
  const trimEnd = Math.max(trimStart + 0.05, Math.min(1, Number(opts.trimEnd) || 1));
  const rate = Math.max(0.75, Math.min(1.35, Number(opts.rate) || 1));
  const fadeIn = Math.max(0, Math.min(5, Number(opts.fadeIn) || 0));
  const fadeOut = Math.max(0, Math.min(5, Number(opts.fadeOut) || 0));
  const lowDb = Number(opts.lowDb) || 0;
  const midDb = Number(opts.midDb) || 0;
  const highDb = Number(opts.highDb) || 0;
  const lofi = !!opts.lofi;
  const space = !!opts.space;

  const startSec = trimStart * srcBuf.duration;
  const sliceDur = (trimEnd - trimStart) * srcBuf.duration;
  const outDur = Math.max(0.4, sliceDur / rate + (space ? 0.6 : 0));

  const ctx = new OfflineAudioContext(Math.min(2, srcBuf.numberOfChannels), Math.ceil(sr * outDur), sr);
  const src = ctx.createBufferSource();
  src.buffer = srcBuf;
  src.playbackRate.value = rate;

  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 180; low.gain.value = lowDb;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 1; mid.gain.value = midDb;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000; high.gain.value = highDb;

  let head = src;
  head.connect(low); low.connect(mid); mid.connect(high); head = high;

  if (lofi) {
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.7;
    head.connect(bp); head = bp;
  }

  const outGain = ctx.createGain();
  const playDur = sliceDur / rate;
  outGain.gain.setValueAtTime(fadeIn > 0.02 ? 0.0001 : 1, 0);
  if (fadeIn > 0.02) outGain.gain.linearRampToValueAtTime(1, Math.min(playDur * 0.45, fadeIn));
  if (fadeOut > 0.02) {
    const foStart = Math.max(0, playDur - Math.min(playDur * 0.45, fadeOut));
    outGain.gain.setValueAtTime(1, foStart);
    outGain.gain.linearRampToValueAtTime(0.0001, playDur);
  }
  head.connect(outGain);
  outGain.connect(ctx.destination);

  if (space) {
    const delay = ctx.createDelay(0.4); delay.delayTime.value = 0.16;
    const wet = ctx.createGain(); wet.gain.value = 0.24;
    const damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2600;
    outGain.connect(delay); delay.connect(damp); damp.connect(wet); wet.connect(ctx.destination);
  }

  src.start(0, startSec, sliceDur);
  return ctx.startRendering();
}

export async function renderEditedAudio(srcBuf, opts = {}) {
  const rendered = await renderEditedBuffer(srcBuf, opts);
  return new File([encodeWav(rendered)], 'edited-track.wav', { type: 'audio/wav' });
}

function drawWaveform(canvas, buf, trimStart, trimEnd, playFrac = -1) {
  if (!canvas || !buf) return;
  const ctx = canvas.getContext('2d');
  const dpr = devicePixelRatio || 1;
  const W = canvas.width = (canvas.clientWidth || 260) * dpr;
  const H = canvas.height = 78 * dpr;
  ctx.clearRect(0, 0, W, H);

  // Subtle masked regions outside trim bounds
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(0, 0, trimStart * W, H);
  ctx.fillRect(trimEnd * W, 0, (1 - trimEnd) * W, H);

  const ch = buf.getChannelData(0);
  const bars = 88;
  const step = Math.max(1, Math.floor(ch.length / bars));
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';

  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = 0; j < step; j += 8) {
      const v = Math.abs(ch[i * step + j] || 0);
      if (v > peak) peak = v;
    }
    const frac = i / bars;
    const inRange = frac >= trimStart && frac <= trimEnd;
    const bh = Math.max(4 * dpr, peak * (H * 0.8));
    const x = (i / bars) * W;
    const bw = Math.max(2, W / bars - 2);
    ctx.fillStyle = inRange ? accent : 'rgba(148, 163, 184, 0.26)';
    ctx.beginPath();
    ctx.roundRect(x, (H - bh) / 2, bw, bh, 2);
    ctx.fill();
  }

  // Trim handles
  const sx = Math.max(1, trimStart * W);
  const ex = Math.min(W - 3, trimEnd * W);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx, 0, 2.5 * dpr, H);
  ctx.fillRect(ex - 1.5 * dpr, 0, 2.5 * dpr, H);
  ctx.beginPath();
  ctx.roundRect(sx - 3 * dpr, 2 * dpr, 9 * dpr, 12 * dpr, 3 * dpr);
  ctx.roundRect(ex - 5 * dpr, 2 * dpr, 9 * dpr, 12 * dpr, 3 * dpr);
  ctx.fill();

  // Active preview playhead
  if (playFrac >= 0 && playFrac <= 1) {
    const px = (trimStart + playFrac * (trimEnd - trimStart)) * W;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(px, 0, 2 * dpr, H);
  }
}

/** Mount the upgraded Music & AI Audio Workstation inside the Music panel. */
export function initAudioStudio(api) {
  const host = $('#musicPanelBody') || $('#musicSec')?.closest('.panel-body');
  if (!host || $('#audioWorkstation')) return;

  const state = {
    currentBuffer: null,
    currentFile: null,
    stems: { drums: 1, bass: 1, chords: 1, lead: 0.8 },
    sfxGain: 0.85,
    lastSfx: { name: 'Sparkle Chime', prompt: 'chime' },
    edit: { trimStart: 0, trimEnd: 1, fadeIn: 0.4, fadeOut: 0.8, rate: 1, lowDb: 0, midDb: 0, highDb: 0, lofi: false, space: false },
  };

  let previewAudioCtx = null;
  let previewSrc = null;
  let previewRaf = 0;

  const stopPreviewAudio = () => {
    if (previewRaf) { cancelAnimationFrame(previewRaf); previewRaf = 0; }
    try { previewSrc?.stop?.(); } catch {}
    try { previewAudioCtx?.close?.(); } catch {}
    previewSrc = null;
    previewAudioCtx = null;
    const btn = $('#asPreviewEdit', wrap);
    if (btn) {
      btn.classList.remove('on');
      btn.textContent = 'Preview edit';
    }
    if (state.currentBuffer) drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd, -1);
  };

  const wrap = document.createElement('div');
  wrap.id = 'audioWorkstation';
  wrap.className = 'audio-ws form';
  wrap.innerHTML = `
    <details class="psec" data-sec="ai-song">
      <summary><b>AI Song &amp; Beat Maker</b><span class="hint">royalty-free · stems</span></summary>
      <div class="psec-body form">
        <div class="fld">
          <div class="row between">
            <span>Describe the vibe or track</span>
            <button type="button" class="btn sm ghost as-mini-link" id="aiSongIdea">Surprise vibe</button>
          </div>
          <textarea class="input sm" id="aiSongPrompt" rows="2" maxlength="220" placeholder="e.g. Warm midnight lo-fi beat with jazzy electric keys for Q&A"></textarea>
        </div>
        <div class="as-genre-grid" id="aiSongGenres">
          ${Object.entries(GENRES).map(([id, g], i) => `<button type="button" class="as-chip${i === 0 ? ' on' : ''}" data-genre="${id}">${g.name}</button>`).join('')}
        </div>
        <div class="row2">
          <label class="fld"><span>Key &amp; scale</span>
            <select class="input sm" id="aiSongKey">${Object.entries(KEYS).map(([id, k]) => `<option value="${id}">${k.label}</option>`).join('')}</select>
          </label>
          <label class="fld"><span>Length</span>
            <select class="input sm" id="aiSongDur"><option value="16">16 sec loop</option><option value="24" selected>24 sec loop</option><option value="48">48 sec track</option></select>
          </label>
        </div>
        <div class="row2">
          <label class="fld"><span>Tempo <em class="num" id="aiSongBpmVal">78 bpm</em></span><input type="range" id="aiSongBpm" min="64" max="156" step="2" value="78"></label>
          <label class="fld"><span>Energy <em class="num" id="aiSongEnergyVal">70%</em></span><input type="range" id="aiSongEnergy" min="0.2" max="1" step="0.05" value="0.7"></label>
        </div>
        <div class="as-stems">
          <small class="as-stems-h">Stems mixer</small>
          <div class="as-stem-grid">
            ${['drums', 'bass', 'chords', 'lead'].map((st) => `
              <label class="as-stem"><span>${st[0].toUpperCase() + st.slice(1)}</span><input type="range" data-stem="${st}" min="0" max="1" step="0.05" value="${state.stems[st]}"></label>
            `).join('')}
          </div>
        </div>
        <div class="row">
          <button type="button" class="btn sm primary grow" id="aiSongGen">
            <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-sparkles"/></svg>
            <span>Generate song &amp; load</span>
          </button>
          <button type="button" class="btn sm" id="aiSongDl" disabled data-tip="Download generated WAV">Export WAV</button>
        </div>
      </div>
    </details>

    <details class="psec" data-sec="audio-editor">
      <summary><b>Audio editor &amp; FX</b><span class="hint">trim · presets · EQ</span></summary>
      <div class="psec-body form">
        <div class="as-wave-box">
          <div class="as-wave-meta">
            <b id="asTrackLabel">No track loaded</b>
            <span class="num" id="asDurReadout">0.0s</span>
          </div>
          <canvas id="asWave" class="as-wave" title="Drag left or right handles to trim"></canvas>
          <p class="hint" id="asWaveHint">Load a track or generate an AI song to drag-trim waveform &amp; apply FX.</p>
        </div>
        <div class="fld">
          <span>Mastering &amp; FX presets</span>
          <div class="as-fx-presets" id="asFxPresets">
            ${FX_PRESETS.map((p, idx) => `<button type="button" class="as-preset-btn${idx === 0 ? ' on' : ''}" data-fxp="${p.id}">${p.name}</button>`).join('')}
          </div>
        </div>
        <div class="row2">
          <label class="fld"><span>Trim start <em class="num" id="asTrimSVal">0%</em></span><input type="range" id="asTrimS" min="0" max="0.85" step="0.01" value="0"></label>
          <label class="fld"><span>Trim end <em class="num" id="asTrimEVal">100%</em></span><input type="range" id="asTrimE" min="0.15" max="1" step="0.01" value="1"></label>
        </div>
        <div class="row2">
          <label class="fld"><span>Fade in <em class="num" id="asFadeInVal">0.4s</em></span><input type="range" id="asFadeIn" min="0" max="4" step="0.2" value="0.4"></label>
          <label class="fld"><span>Fade out <em class="num" id="asFadeOutVal">0.8s</em></span><input type="range" id="asFadeOut" min="0" max="4" step="0.2" value="0.8"></label>
        </div>
        <label class="fld"><span>Speed &amp; pitch <em class="num" id="asRateVal">1.00×</em></span><input type="range" id="asRate" min="0.75" max="1.35" step="0.05" value="1"></label>
        <div class="as-eq-grid">
          <label class="fld"><span>Bass <em class="num" id="asLowVal">0 dB</em></span><input type="range" id="asLow" min="-12" max="12" step="1" value="0"></label>
          <label class="fld"><span>Mid <em class="num" id="asMidVal">0 dB</em></span><input type="range" id="asMid" min="-12" max="12" step="1" value="0"></label>
          <label class="fld"><span>Air <em class="num" id="asHighVal">0 dB</em></span><input type="range" id="asHigh" min="-12" max="12" step="1" value="0"></label>
        </div>
        <div class="row between">
          <div class="row">
            <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="asLofi"><span>Lo-fi radio</span></label>
            <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="asSpace"><span>Studio reverb</span></label>
          </div>
          <button type="button" class="btn sm ghost" id="asResetEdit">Reset</button>
        </div>
        <div class="row">
          <button type="button" class="btn sm" id="asPreviewEdit">Preview edit</button>
          <button type="button" class="btn sm primary grow" id="asApplyEdit">Apply to stream</button>
          <button type="button" class="btn sm" id="asExportEdit" data-tip="Export edited WAV">WAV</button>
        </div>
      </div>
    </details>

    <details class="psec" data-sec="sfx-board">
      <summary><b>AI Soundboard &amp; SFX</b><span class="hint">12 stingers · live mix</span></summary>
      <div class="psec-body form">
        <div class="as-sfx-bar">
          <label class="as-sfx-vol">
            <span>SFX level <em class="num" id="asSfxVolVal">85%</em></span>
            <input type="range" id="asSfxVol" min="0.2" max="1.2" step="0.05" value="0.85">
          </label>
          <button type="button" class="btn sm ghost" id="asSfxSaveClip" data-tip="Save the last triggered SFX into your Audio Clips grid">+ Save to clips</button>
        </div>
        <div class="as-sfx-grid" id="asSfxGrid">
          ${BUILTIN_SFX.map((s) => `
            <button type="button" class="as-pad" data-sfx="${s.id}" style="--pad-tone:${s.tone}">
              <i class="as-pad-dot" aria-hidden="true"></i>
              <span class="as-pad-name">${s.name}</span>
              ${s.key ? `<kbd>${s.key}</kbd>` : ''}
            </button>
          `).join('')}
        </div>
        <div class="fld">
          <span>Custom AI sound effect</span>
          <div class="composer-row">
            <input class="input sm" id="asSfxPrompt" maxlength="80" placeholder="Describe SFX (e.g. sub bass drop, sci-fi laser)">
            <button type="button" class="btn sm primary" id="asSfxAdd">+ Create</button>
          </div>
          <div class="as-sfx-chips" id="asSfxChips">
            ${SFX_QUICK_PROMPTS.map((q) => `<button type="button" class="as-qchip" data-sq="${q}">${q}</button>`).join('')}
          </div>
        </div>
      </div>
    </details>

    <details class="psec" data-sec="ai-voiceover">
      <summary><b>AI Intro &amp; Voiceover</b><span class="hint">scripts · auto-duck</span></summary>
      <div class="psec-body form">
        <div class="as-vo-presets" id="asVoPresets">
          ${VO_PRESETS.map((v) => `<button type="button" class="as-qchip" data-vop="${v.id}">${v.label}</button>`).join('')}
        </div>
        <textarea class="input sm" id="asVoText" rows="3" maxlength="320" placeholder="Type a live intro, sponsor read, or call-to-action bumper…"></textarea>
        <div class="row2">
          <label class="fld"><span>Announcer style</span>
            <select class="input sm" id="asVoStyle">
              <option value="alloy">Broadcast host</option>
              <option value="onyx">Hype announcer</option>
              <option value="nova">Warm storyteller</option>
              <option value="shimmer">Crisp sponsor read</option>
            </select>
          </label>
          <label class="fld"><span>Browser voice</span>
            <select class="input sm" id="asVoVoice"><option value="">System default</option></select>
          </label>
        </div>
        <div class="row2">
          <label class="fld"><span>Pace <em class="num" id="asVoRateVal">1.00×</em></span><input type="range" id="asVoRate" min="0.75" max="1.35" step="0.05" value="1"></label>
          <label class="fld"><span>Pitch <em class="num" id="asVoPitchVal">1.00</em></span><input type="range" id="asVoPitch" min="0.75" max="1.25" step="0.05" value="1"></label>
        </div>
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="asVoDuck" checked><span>Auto-duck background music while speaking</span></label>
        <div class="row">
          <button type="button" class="btn sm" id="asVoPreview">Preview</button>
          <button type="button" class="btn sm primary grow" id="asVoPlay">
            <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-mic"/></svg>
            <span>Play on air</span>
          </button>
          <button type="button" class="btn sm ghost" id="asVoStop" hidden>Stop</button>
        </div>
      </div>
    </details>
  `;
  host.append(wrap);
  const audioClips = mountAudioClips(wrap, api, { renderSfxBuffer });

  // Populate real system voices when available
  const populateVoices = () => {
    const sel = $('#asVoVoice', wrap);
    if (!sel || !('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices?.() || [];
    if (!voices.length) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">System default</option>' + voices.slice(0, 24).map((v) =>
      `<option value="${v.name.replace(/"/g, '&quot;')}">${v.name} (${v.lang})</option>`
    ).join('');
    if (cur) sel.value = cur;
  };
  populateVoices();
  if ('speechSynthesis' in window) {
    speechSynthesis.addEventListener?.('voiceschanged', populateVoices);
  }

  // AI Song & Beat Maker wiring
  let selectedGenre = 'lofi';
  const selectGenre = (id, bpmOverride) => {
    selectedGenre = id;
    $$('#aiSongGenres .as-chip', wrap).forEach((x) => x.classList.toggle('on', x.dataset.genre === id));
    const g = GENRES[selectedGenre];
    const useBpm = bpmOverride || g?.bpm || 96;
    $('#aiSongBpm', wrap).value = String(useBpm);
    $('#aiSongBpmVal', wrap).textContent = `${useBpm} bpm`;
  };
  $$('#aiSongGenres .as-chip', wrap).forEach((b) => { b.onclick = () => selectGenre(b.dataset.genre); });
  let ideaIdx = 0;
  $('#aiSongIdea', wrap).onclick = () => {
    const idea = SONG_IDEAS[ideaIdx++ % SONG_IDEAS.length];
    $('#aiSongPrompt', wrap).value = idea.prompt;
    selectGenre(idea.genre, idea.bpm);
  };

  $('#aiSongBpm', wrap).oninput = (e) => { $('#aiSongBpmVal', wrap).textContent = `${e.target.value} bpm`; };
  $('#aiSongEnergy', wrap).oninput = (e) => { $('#aiSongEnergyVal', wrap).textContent = `${Math.round(Number(e.target.value) * 100)}%`; };
  $$('[data-stem]', wrap).forEach((r) => { r.oninput = (e) => { state.stems[r.dataset.stem] = Number(e.target.value); }; });

  const updateDurReadout = () => {
    const el = $('#asDurReadout', wrap);
    if (!el) return;
    if (!state.currentBuffer) { el.textContent = '0.0s'; return; }
    const orig = state.currentBuffer.duration;
    const trimmed = Math.max(0.2, ((state.edit.trimEnd - state.edit.trimStart) * orig) / state.edit.rate);
    el.textContent = `${orig.toFixed(1)}s → ${trimmed.toFixed(1)}s`;
  };

  async function loadBufferFromFile(file) {
    stopPreviewAudio();
    state.currentFile = file;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const arr = await file.arrayBuffer();
      state.currentBuffer = await ac.decodeAudioData(arr);
      ac.close?.();
      $('#asTrackLabel', wrap).textContent = (file.name || 'Loaded track').replace(/\.[^.]+$/, '');
      $('#asWaveHint', wrap).hidden = true;
      updateDurReadout();
      drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd);
    } catch {}
  }

  $('#musicFile')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadBufferFromFile(f);
  });

  $('#aiSongGen', wrap).onclick = async () => {
    const btn = $('#aiSongGen', wrap);
    const labelSpan = $('span', btn);
    btn.disabled = true;
    if (labelSpan) labelSpan.textContent = 'Composing…';
    try {
      const res = await generateAiSong({
        prompt: $('#aiSongPrompt', wrap).value,
        genre: selectedGenre,
        key: $('#aiSongKey', wrap).value,
        bpm: Number($('#aiSongBpm', wrap).value),
        durSec: Number($('#aiSongDur', wrap).value),
        energy: Number($('#aiSongEnergy', wrap).value),
        stems: { ...state.stems },
      });
      stopPreviewAudio();
      state.currentBuffer = res.buffer;
      state.currentFile = res.file;
      $('#aiSongDl', wrap).disabled = false;
      $('#asTrackLabel', wrap).textContent = res.name;
      $('#asWaveHint', wrap).hidden = true;
      updateDurReadout();
      drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd);
      await api.playMusicFile(res.file);
      api.toast(`AI track “${res.name}” loaded into the stream mix.`);
    } catch (e) {
      api.toast('Could not compose track: ' + (e.message || e), { err: true });
    } finally {
      btn.disabled = false;
      if (labelSpan) labelSpan.textContent = 'Generate song & load';
    }
  };

  function downloadFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name || 'gather-track.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  $('#aiSongDl', wrap).onclick = () => downloadFile(state.currentFile);

  // Audio Editor & FX bindings
  const syncEdit = () => {
    state.edit.trimStart = Number($('#asTrimS', wrap).value);
    state.edit.trimEnd = Math.max(state.edit.trimStart + 0.08, Number($('#asTrimE', wrap).value));
    $('#asTrimE', wrap).value = String(state.edit.trimEnd);
    state.edit.fadeIn = Number($('#asFadeIn', wrap).value);
    state.edit.fadeOut = Number($('#asFadeOut', wrap).value);
    state.edit.rate = Number($('#asRate', wrap).value);
    state.edit.lowDb = Number($('#asLow', wrap).value);
    state.edit.midDb = Number($('#asMid', wrap).value);
    state.edit.highDb = Number($('#asHigh', wrap).value);
    state.edit.lofi = $('#asLofi', wrap).checked;
    state.edit.space = $('#asSpace', wrap).checked;
    $('#asTrimSVal', wrap).textContent = `${Math.round(state.edit.trimStart * 100)}%`;
    $('#asTrimEVal', wrap).textContent = `${Math.round(state.edit.trimEnd * 100)}%`;
    $('#asFadeInVal', wrap).textContent = `${state.edit.fadeIn.toFixed(1)}s`;
    $('#asFadeOutVal', wrap).textContent = `${state.edit.fadeOut.toFixed(1)}s`;
    $('#asRateVal', wrap).textContent = `${state.edit.rate.toFixed(2)}×`;
    $('#asLowVal', wrap).textContent = `${state.edit.lowDb > 0 ? '+' : ''}${state.edit.lowDb} dB`;
    $('#asMidVal', wrap).textContent = `${state.edit.midDb > 0 ? '+' : ''}${state.edit.midDb} dB`;
    $('#asHighVal', wrap).textContent = `${state.edit.highDb > 0 ? '+' : ''}${state.edit.highDb} dB`;
    updateDurReadout();
    if (state.currentBuffer) drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd);
    api.setMusicRate?.(state.edit.rate);
  };
  ['#asTrimS', '#asTrimE', '#asFadeIn', '#asFadeOut', '#asRate', '#asLow', '#asMid', '#asHigh', '#asLofi', '#asSpace'].forEach((id) => {
    $(id, wrap)?.addEventListener('input', () => {
      $$('#asFxPresets .as-preset-btn', wrap).forEach((x) => x.classList.remove('on'));
      syncEdit();
    });
  });

  // Interactive click/drag trimming on waveform canvas
  const waveCv = $('#asWave', wrap);
  let dragHandle = null;
  const applyWavePointer = (e) => {
    if (!state.currentBuffer || !dragHandle) return;
    const r = waveCv.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    if (dragHandle === 'start') {
      const next = Math.min(state.edit.trimEnd - 0.08, Math.max(0, frac));
      $('#asTrimS', wrap).value = next.toFixed(2);
    } else {
      const next = Math.max(state.edit.trimStart + 0.08, Math.min(1, frac));
      $('#asTrimE', wrap).value = next.toFixed(2);
    }
    syncEdit();
  };
  waveCv?.addEventListener('pointerdown', (e) => {
    if (!state.currentBuffer) return;
    const r = waveCv.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    dragHandle = Math.abs(frac - state.edit.trimStart) <= Math.abs(frac - state.edit.trimEnd) ? 'start' : 'end';
    waveCv.setPointerCapture?.(e.pointerId);
    applyWavePointer(e);
  });
  waveCv?.addEventListener('pointermove', (e) => { if (dragHandle) applyWavePointer(e); });
  waveCv?.addEventListener('pointerup', () => { dragHandle = null; });
  waveCv?.addEventListener('pointercancel', () => { dragHandle = null; });

  // 6 one-click FX presets
  const applyPreset = (p) => {
    $('#asLow', wrap).value = String(p.lowDb);
    $('#asMid', wrap).value = String(p.midDb);
    $('#asHigh', wrap).value = String(p.highDb);
    $('#asRate', wrap).value = String(p.rate);
    $('#asLofi', wrap).checked = !!p.lofi;
    $('#asSpace', wrap).checked = !!p.space;
    $$('#asFxPresets .as-preset-btn', wrap).forEach((x) => x.classList.toggle('on', x.dataset.fxp === p.id));
    syncEdit();
  };
  $$('#asFxPresets .as-preset-btn', wrap).forEach((b) => {
    b.onclick = () => {
      const p = FX_PRESETS.find((x) => x.id === b.dataset.fxp);
      if (p) applyPreset(p);
    };
  });

  $('#asResetEdit', wrap).onclick = () => {
    $('#asTrimS', wrap).value = '0';
    $('#asTrimE', wrap).value = '1';
    $('#asFadeIn', wrap).value = '0.4';
    $('#asFadeOut', wrap).value = '0.8';
    applyPreset(FX_PRESETS[0]);
    stopPreviewAudio();
    api.toast('Audio editor reset to flat.');
  };

  // Preview edited audio locally (with animated playhead) before committing to stream
  $('#asPreviewEdit', wrap).onclick = async () => {
    if (previewSrc) { stopPreviewAudio(); return; }
    if (!state.currentBuffer) return api.toast('Generate or upload a track first.', { err: true });
    const btn = $('#asPreviewEdit', wrap);
    btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      const rendered = await renderEditedBuffer(state.currentBuffer, state.edit);
      const AC = window.AudioContext || window.webkitAudioContext;
      previewAudioCtx = new AC();
      previewSrc = previewAudioCtx.createBufferSource();
      previewSrc.buffer = rendered;
      previewSrc.connect(previewAudioCtx.destination);
      const startedAt = performance.now();
      const totalMs = Math.max(200, rendered.duration * 1000);
      previewSrc.onended = () => stopPreviewAudio();
      previewSrc.start(0);
      btn.disabled = false;
      btn.classList.add('on');
      btn.textContent = 'Stop preview';
      const step = () => {
        if (!previewSrc) return;
        const frac = Math.min(1, (performance.now() - startedAt) / totalMs);
        drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd, frac);
        if (frac < 1) previewRaf = requestAnimationFrame(step);
      };
      previewRaf = requestAnimationFrame(step);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Preview edit';
      api.toast('Preview failed: ' + (e.message || e), { err: true });
    }
  };

  $('#asApplyEdit', wrap).onclick = async () => {
    if (!state.currentBuffer) return api.toast('Generate or upload a track first.', { err: true });
    stopPreviewAudio();
    const btn = $('#asApplyEdit', wrap);
    btn.disabled = true; btn.textContent = 'Rendering…';
    try {
      const edited = await renderEditedAudio(state.currentBuffer, state.edit);
      state.currentFile = edited;
      await api.playMusicFile(edited);
      api.toast('Edited track loaded into your live stream mix.');
    } catch (e) {
      api.toast('Edit failed: ' + (e.message || e), { err: true });
    } finally {
      btn.disabled = false; btn.textContent = 'Apply to stream';
    }
  };

  $('#asExportEdit', wrap).onclick = async () => {
    if (!state.currentBuffer) return api.toast('Generate or upload a track first.', { err: true });
    const edited = await renderEditedAudio(state.currentBuffer, state.edit);
    downloadFile(edited);
  };

  // SFX Soundboard playback routed into live program mix
  $('#asSfxVol', wrap).oninput = (e) => {
    state.sfxGain = Number(e.target.value) || 0.85;
    $('#asSfxVolVal', wrap).textContent = `${Math.round(state.sfxGain * 100)}%`;
  };

  async function triggerSfx(kindOrPrompt, btnEl, displayName) {
    state.lastSfx = { prompt: kindOrPrompt, name: displayName || kindOrPrompt };
    btnEl?.classList.add('on');
    try {
      const buf = await renderSfxBuffer(kindOrPrompt, state.sfxGain);
      if (api.playStreamBuffer) {
        await api.playStreamBuffer(buf);
      } else {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const s = ac.createBufferSource(); s.buffer = buf; s.connect(ac.destination); s.start();
        s.onended = () => ac.close?.();
      }
    } finally {
      setTimeout(() => btnEl?.classList.remove('on'), 280);
    }
  }

  $$('#asSfxGrid .as-pad', wrap).forEach((b) => {
    b.onclick = () => triggerSfx(b.dataset.sfx, b, $('.as-pad-name', b)?.textContent);
  });

  const addCustomSfxPad = (promptText) => {
    const prompt = String(promptText || '').trim();
    if (!prompt) return api.toast('Describe the sound effect first.');
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'as-pad custom';
    pad.style.setProperty('--pad-tone', '#38bdf8');
    pad.innerHTML = '<i class="as-pad-dot" aria-hidden="true"></i><span class="as-pad-name"></span>';
    $('.as-pad-name', pad).textContent = prompt.slice(0, 18);
    pad.onclick = () => triggerSfx(prompt, pad, prompt.slice(0, 18));
    $('#asSfxGrid', wrap).append(pad);
    triggerSfx(prompt, pad, prompt.slice(0, 18));
    api.toast(`Added “${prompt.slice(0, 22)}” to your soundboard.`);
  };

  $('#asSfxAdd', wrap).onclick = () => {
    const val = $('#asSfxPrompt', wrap).value.trim();
    if (!val) return api.toast('Describe the sound effect first.');
    $('#asSfxPrompt', wrap).value = '';
    addCustomSfxPad(val);
  };
  $$('#asSfxChips .as-qchip', wrap).forEach((c) => {
    c.onclick = () => {
      $('#asSfxPrompt', wrap).value = c.dataset.sq;
      addCustomSfxPad(c.dataset.sq);
    };
  });

  // Save last played or typed SFX directly into the Audio Clips grid
  $('#asSfxSaveClip', wrap).onclick = async () => {
    const srcPrompt = $('#asSfxPrompt', wrap).value.trim() || state.lastSfx.prompt || 'chime';
    const label = ($('#asSfxPrompt', wrap).value.trim() || state.lastSfx.name || 'AI SFX').replace(/[^\w\s-]/g, '').trim() || 'AI SFX';
    try {
      const buf = await renderSfxBuffer(srcPrompt, state.sfxGain);
      const wavFile = new File([encodeWav(buf)], `${label}.wav`, { type: 'audio/wav' });
      if (audioClips?.importAudioFiles) {
        await audioClips.importAudioFiles([wavFile]);
      } else {
        downloadFile(wavFile);
      }
    } catch (e) {
      api.toast('Could not save SFX clip: ' + (e.message || e), { err: true });
    }
  };

  // AI Intro & Voiceover wiring
  $$('#asVoPresets .as-qchip', wrap).forEach((b) => {
    b.onclick = () => {
      const p = VO_PRESETS.find((x) => x.id === b.dataset.vop);
      if (p) $('#asVoText', wrap).value = p.text;
    };
  });
  $('#asVoRate', wrap).oninput = (e) => { $('#asVoRateVal', wrap).textContent = `${Number(e.target.value).toFixed(2)}×`; };
  $('#asVoPitch', wrap).oninput = (e) => { $('#asVoPitchVal', wrap).textContent = Number(e.target.value).toFixed(2); };

  const speakScript = async (onAir) => {
    const text = $('#asVoText', wrap).value.trim();
    if (!text) return api.toast('Type or pick a voiceover script first.');
    const voiceStyle = $('#asVoStyle', wrap).value;
    const voiceName = $('#asVoVoice', wrap).value;
    const rate = Number($('#asVoRate', wrap).value) || 1;
    const pitch = Number($('#asVoPitch', wrap).value) || 1;
    const duck = $('#asVoDuck', wrap).checked;

    const playBtn = $('#asVoPlay', wrap);
    const prevBtn = $('#asVoPreview', wrap);
    const stopBtn = $('#asVoStop', wrap);
    playBtn.disabled = true;
    prevBtn.disabled = true;
    stopBtn.hidden = false;
    const playLabel = $('span', playBtn);
    if (onAir && playLabel) playLabel.textContent = 'On air…';
    if (!onAir) prevBtn.textContent = 'Previewing…';

    try {
      if (onAir && duck) {
        const estMs = Math.max(2500, Math.min(15000, Math.round((text.split(/\s+/).length / 2.4) * 1000 / rate) + 800));
        api.duckMusicTemporarily?.(estMs);
      }
      if (onAir && api.speakOnAir && !voiceName && rate === 1 && pitch === 1) {
        await api.speakOnAir(text, voiceStyle);
      } else if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        await new Promise((res) => {
          const u = new SpeechSynthesisUtterance(text);
          const allVoices = speechSynthesis.getVoices?.() || [];
          if (voiceName) {
            const match = allVoices.find((v) => v.name === voiceName);
            if (match) u.voice = match;
          }
          const styleRate = voiceStyle === 'onyx' ? 1.06 : voiceStyle === 'nova' ? 0.94 : 1.0;
          const stylePitch = voiceStyle === 'onyx' ? 0.86 : voiceStyle === 'nova' ? 1.08 : 1.0;
          u.rate = Math.max(0.5, Math.min(2, rate * styleRate));
          u.pitch = Math.max(0.5, Math.min(2, pitch * stylePitch));
          u.onend = res;
          u.onerror = res;
          speechSynthesis.speak(u);
        });
      }
    } finally {
      playBtn.disabled = false;
      prevBtn.disabled = false;
      stopBtn.hidden = true;
      if (playLabel) playLabel.textContent = 'Play on air';
      prevBtn.textContent = 'Preview';
    }
  };

  $('#asVoPlay', wrap).onclick = () => speakScript(true);
  $('#asVoPreview', wrap).onclick = () => speakScript(false);
  $('#asVoStop', wrap).onclick = () => {
    try { window.speechSynthesis?.cancel(); } catch {}
    $('#asVoStop', wrap).hidden = true;
    $('#asVoPlay', wrap).disabled = false;
    $('#asVoPreview', wrap).disabled = false;
    const playLabel = $('span', $('#asVoPlay', wrap));
    if (playLabel) playLabel.textContent = 'Play on air';
    $('#asVoPreview', wrap).textContent = 'Preview';
  };

  return { loadBufferFromFile, audioClips };
}
