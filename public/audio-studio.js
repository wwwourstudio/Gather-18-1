// Upgraded Music & AI Audio Workstation for gather studio:
// 1. AI Song & Beat Maker (prompt + 8 genres + key/scale + BPM + duration + 4-stem mixer + WAV export)
// 2. AI Soundboard & SFX Creator (10 instant broadcast stingers + custom prompt SFX synth)
// 3. AI Voiceover / Intro Announcer (text-to-speech bumper generator with auto music ducking)
// 4. Interactive Waveform Audio Editor (Trim In/Out, Fade In/Out, Speed/Pitch, 3-Band EQ, Lo-fi/Space/Tape FX, Export WAV)

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const GENRES = {
  lofi: { name: 'Lo-fi Chill', bpm: 78, wave: 'triangle', leadWave: 'sine', swing: 0.14, lp: 2400, kick: [0, 10], snare: [4, 12], hat: 2, prog: [0, 5, 3, 4], arp: [0, 2, 1, 3, 2, 0, 3, 1] },
  synthwave: { name: 'Synthwave', bpm: 108, wave: 'sawtooth', leadWave: 'square', swing: 0, lp: 3100, kick: [0, 4, 8, 12], snare: [4, 12], hat: 2, prog: [0, 5, 3, 4], arp: [0, 1, 2, 3, 2, 1, 2, 3] },
  hiphop: { name: 'Hip-Hop Beat', bpm: 92, wave: 'triangle', leadWave: 'triangle', swing: 0.1, lp: 2600, kick: [0, 3, 10], snare: [4, 12], hat: 1, prog: [0, 3, 5, 4], arp: [0, 0, 2, 1, 0, 3, 2, 1] },
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

const BUILTIN_SFX = [
  { id: 'whoosh', name: 'Whoosh', icon: '💨', key: '1' },
  { id: 'chime', name: 'Sparkle Chime', icon: '✨', key: '2' },
  { id: 'applause', name: 'Applause', icon: '👏', key: '3' },
  { id: 'airhorn', name: 'Hype Horn', icon: '📣', key: '4' },
  { id: 'cash', name: 'Sale Ding', icon: '💰', key: '5' },
  { id: 'levelup', name: 'Level Up', icon: '🎮', key: '6' },
  { id: 'impact', name: 'Boom Hit', icon: '💥', key: '' },
  { id: 'intro', name: 'Intro Jingle', icon: '🎬', key: '' },
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

    // 1. Chords / Pad stem
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

    // 2. Bass stem
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

    // 3. Lead melody / arpeggio stem
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

    // 4. Drums stem
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

/** Synthesize instant broadcast SFX stinger (or prompt-described custom SFX). */
export async function renderSfxBuffer(kindOrPrompt) {
  const sr = 44100;
  const p = String(kindOrPrompt || 'chime').toLowerCase();
  const id = BUILTIN_SFX.some((x) => x.id === p) ? p
    : /whoosh|swoosh|wind|swipe/.test(p) ? 'whoosh'
    : /horn|hype|air/.test(p) ? 'airhorn'
    : /clap|applause|cheer|crowd/.test(p) ? 'applause'
    : /cash|sale|coin|money|ding/.test(p) ? 'cash'
    : /level|game|win|power|laser|sci/.test(p) ? 'levelup'
    : /boom|hit|drop|impact|drum/.test(p) ? 'impact'
    : /intro|jingle|outro|logo/.test(p) ? 'intro'
    : 'chime';

  const dur = id === 'applause' || id === 'intro' ? 2.2 : id === 'airhorn' ? 1.5 : 1.1;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const master = ctx.createGain(); master.gain.value = 0.72; master.connect(ctx.destination);
  const noiseBuf = ctx.createBuffer(1, sr * 2, sr);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

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
    for (let i = 0; i < 42; i++) {
      const t = (i / 42) * 1.7 + Math.random() * 0.14;
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
  } else if (id === 'impact') {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(160, 0); o.frequency.exponentialRampToValueAtTime(34, 0.55);
    g.gain.setValueAtTime(0.95, 0); g.gain.exponentialRampToValueAtTime(0.001, 0.85);
    o.connect(g).connect(master); o.start(0); o.stop(0.9);
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

/** Render an edited WAV from an AudioBuffer with Trim, Fade In/Out, Speed/Pitch, 3-Band EQ, and FX. */
export async function renderEditedAudio(srcBuf, opts = {}) {
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
  const rendered = await ctx.startRendering();
  return new File([encodeWav(rendered)], 'edited-track.wav', { type: 'audio/wav' });
}

function drawWaveform(canvas, buf, trimStart, trimEnd) {
  if (!canvas || !buf) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.clientWidth * (devicePixelRatio || 1) || 520;
  const H = canvas.height = 72 * (devicePixelRatio || 1);
  ctx.clearRect(0, 0, W, H);
  const ch = buf.getChannelData(0);
  const bars = 96;
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
    const bh = Math.max(4, peak * (H * 0.84));
    const x = (i / bars) * W;
    const bw = Math.max(2, W / bars - 2);
    ctx.fillStyle = inRange ? accent : 'rgba(148,163,184,0.28)';
    ctx.beginPath();
    ctx.roundRect(x, (H - bh) / 2, bw, bh, 2);
    ctx.fill();
  }
  // Trim bracket lines
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(trimStart * W, 0, 2, H);
  ctx.fillRect(trimEnd * W - 2, 0, 2, H);
}

/** Mount the upgraded Music & AI Audio Workstation inside the Music panel. */
export function initAudioStudio(api) {
  const host = $('#musicPanelBody') || $('#musicSec')?.closest('.panel-body');
  if (!host || $('#audioWorkstation')) return;

  const state = {
    currentBuffer: null,
    currentFile: null,
    stems: { drums: 1, bass: 1, chords: 1, lead: 0.8 },
    customSfx: [],
    edit: { trimStart: 0, trimEnd: 1, fadeIn: 0.4, fadeOut: 0.8, rate: 1, lowDb: 0, midDb: 0, highDb: 0, lofi: false, space: false },
  };

  const wrap = document.createElement('div');
  wrap.id = 'audioWorkstation';
  wrap.className = 'audio-ws form';
  wrap.innerHTML = `
    <details class="psec" data-sec="ai-song" open>
      <summary><b>AI Song &amp; Beat Maker</b><span class="hint">royalty-free · stems</span></summary>
      <div class="psec-body form">
        <div class="fld">
          <span>Describe the vibe or track</span>
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
          <label class="fld"><span>Tempo <em id="aiSongBpmVal">96 bpm</em></span><input type="range" id="aiSongBpm" min="64" max="156" step="2" value="96"></label>
          <label class="fld"><span>Energy <em id="aiSongEnergyVal">70%</em></span><input type="range" id="aiSongEnergy" min="0.2" max="1" step="0.05" value="0.7"></label>
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
          <button type="button" class="btn sm primary grow" id="aiSongGen">✨ Generate song &amp; load</button>
          <button type="button" class="btn sm" id="aiSongDl" disabled title="Download generated WAV">Export WAV</button>
        </div>
      </div>
    </details>

    <details class="psec" data-sec="audio-editor">
      <summary><b>Audio editor &amp; FX</b><span class="hint">trim · fade · EQ</span></summary>
      <div class="psec-body form">
        <div class="as-wave-box">
          <canvas id="asWave" class="as-wave"></canvas>
          <p class="hint" id="asWaveHint">Load a track or generate an AI song to edit waveform, trim &amp; EQ.</p>
        </div>
        <div class="row2">
          <label class="fld"><span>Trim start <em id="asTrimSVal">0%</em></span><input type="range" id="asTrimS" min="0" max="0.85" step="0.01" value="0"></label>
          <label class="fld"><span>Trim end <em id="asTrimEVal">100%</em></span><input type="range" id="asTrimE" min="0.15" max="1" step="0.01" value="1"></label>
        </div>
        <div class="row2">
          <label class="fld"><span>Fade in <em id="asFadeInVal">0.4s</em></span><input type="range" id="asFadeIn" min="0" max="4" step="0.2" value="0.4"></label>
          <label class="fld"><span>Fade out <em id="asFadeOutVal">0.8s</em></span><input type="range" id="asFadeOut" min="0" max="4" step="0.2" value="0.8"></label>
        </div>
        <label class="fld"><span>Speed &amp; pitch <em id="asRateVal">1.00×</em></span><input type="range" id="asRate" min="0.75" max="1.35" step="0.05" value="1"></label>
        <div class="as-eq-grid">
          <label class="fld"><span>Bass <em id="asLowVal">0 dB</em></span><input type="range" id="asLow" min="-12" max="12" step="1" value="0"></label>
          <label class="fld"><span>Mid <em id="asMidVal">0 dB</em></span><input type="range" id="asMid" min="-12" max="12" step="1" value="0"></label>
          <label class="fld"><span>Air <em id="asHighVal">0 dB</em></span><input type="range" id="asHigh" min="-12" max="12" step="1" value="0"></label>
        </div>
        <div class="row">
          <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="asLofi"><span>Lo-fi radio</span></label>
          <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="asSpace"><span>Studio reverb</span></label>
        </div>
        <div class="row">
          <button type="button" class="btn sm primary grow" id="asApplyEdit">Apply edit to player</button>
          <button type="button" class="btn sm" id="asExportEdit">Save WAV</button>
        </div>
      </div>
    </details>

    <details class="psec" data-sec="sfx-board">
      <summary><b>AI Soundboard &amp; SFX</b><span class="hint">plays into stream</span></summary>
      <div class="psec-body form">
        <div class="as-sfx-grid" id="asSfxGrid">
          ${BUILTIN_SFX.map((s) => `<button type="button" class="as-pad" data-sfx="${s.id}"><b>${s.icon}</b><span>${s.name}</span>${s.key ? `<kbd>${s.key}</kbd>` : ''}</button>`).join('')}
        </div>
        <div class="composer-row">
          <input class="input sm" id="asSfxPrompt" maxlength="80" placeholder="Create custom SFX (e.g. sci-fi power up, dramatic boom)">
          <button type="button" class="btn sm primary" id="asSfxAdd">+ Create</button>
        </div>
      </div>
    </details>

    <details class="psec" data-sec="ai-voiceover">
      <summary><b>AI Intro &amp; Voiceover</b><span class="hint">ducks music automatically</span></summary>
      <div class="psec-body form">
        <textarea class="input sm" id="asVoText" rows="2" maxlength="260" placeholder="Welcome back to the stream! Drop your questions in chat now."></textarea>
        <div class="row2">
          <select class="input sm" id="asVoStyle">
            <option value="alloy">Broadcast host</option>
            <option value="onyx">Hype announcer</option>
            <option value="nova">Warm storyteller</option>
            <option value="shimmer">Crisp sponsor read</option>
          </select>
          <button type="button" class="btn sm primary" id="asVoPlay">🎙 Play on air</button>
        </div>
      </div>
    </details>
  `;
  host.append(wrap);

  let selectedGenre = 'lofi';
  $$('#aiSongGenres .as-chip', wrap).forEach((b) => {
    b.onclick = () => {
      selectedGenre = b.dataset.genre;
      $$('#aiSongGenres .as-chip', wrap).forEach((x) => x.classList.toggle('on', x === b));
      const g = GENRES[selectedGenre];
      if (g) {
        $('#aiSongBpm', wrap).value = String(g.bpm);
        $('#aiSongBpmVal', wrap).textContent = `${g.bpm} bpm`;
      }
    };
  });

  $('#aiSongBpm', wrap).oninput = (e) => { $('#aiSongBpmVal', wrap).textContent = `${e.target.value} bpm`; };
  $('#aiSongEnergy', wrap).oninput = (e) => { $('#aiSongEnergyVal', wrap).textContent = `${Math.round(Number(e.target.value) * 100)}%`; };
  $$('[data-stem]', wrap).forEach((r) => { r.oninput = (e) => { state.stems[r.dataset.stem] = Number(e.target.value); }; });

  async function loadBufferFromFile(file) {
    state.currentFile = file;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const arr = await file.arrayBuffer();
      state.currentBuffer = await ac.decodeAudioData(arr);
      ac.close?.();
      $('#asWaveHint', wrap).hidden = true;
      drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd);
    } catch {}
  }

  // Listen when user loads any local track via #musicFile
  $('#musicFile')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) loadBufferFromFile(f);
  });

  $('#aiSongGen', wrap).onclick = async () => {
    const btn = $('#aiSongGen', wrap);
    btn.disabled = true;
    btn.textContent = 'Composing…';
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
      state.currentBuffer = res.buffer;
      state.currentFile = res.file;
      $('#aiSongDl', wrap).disabled = false;
      $('#asWaveHint', wrap).hidden = true;
      drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd);
      await api.playMusicFile(res.file);
      api.toast(`AI track “${res.name}” loaded into the stream mix.`);
    } catch (e) {
      api.toast('Could not compose track: ' + (e.message || e), { err: true });
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Generate song & load';
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

  // Audio Editor bindings
  const syncEdit = () => {
    state.edit.trimStart = Number($('#asTrimS', wrap).value);
    state.edit.trimEnd = Math.max(state.edit.trimStart + 0.08, Number($('#asTrimE', wrap).value));
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
    if (state.currentBuffer) drawWaveform($('#asWave', wrap), state.currentBuffer, state.edit.trimStart, state.edit.trimEnd);
    api.setMusicRate?.(state.edit.rate);
  };
  ['#asTrimS', '#asTrimE', '#asFadeIn', '#asFadeOut', '#asRate', '#asLow', '#asMid', '#asHigh', '#asLofi', '#asSpace'].forEach((id) => {
    $(id, wrap)?.addEventListener('input', syncEdit);
  });

  $('#asApplyEdit', wrap).onclick = async () => {
    if (!state.currentBuffer) return api.toast('Generate or upload a track first.', { err: true });
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
      btn.disabled = false; btn.textContent = 'Apply edit to player';
    }
  };
  $('#asExportEdit', wrap).onclick = async () => {
    if (!state.currentBuffer) return api.toast('Generate or upload a track first.', { err: true });
    const edited = await renderEditedAudio(state.currentBuffer, state.edit);
    downloadFile(edited);
  };

  // SFX Soundboard playback routed into live program mix
  async function triggerSfx(kindOrPrompt, btnEl) {
    btnEl?.classList.add('on');
    try {
      const buf = await renderSfxBuffer(kindOrPrompt);
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
    b.onclick = () => triggerSfx(b.dataset.sfx, b);
  });

  $('#asSfxAdd', wrap).onclick = () => {
    const prompt = $('#asSfxPrompt', wrap).value.trim();
    if (!prompt) return api.toast('Describe the sound effect first.');
    $('#asSfxPrompt', wrap).value = '';
    const pad = document.createElement('button');
    pad.type = 'button';
    pad.className = 'as-pad custom';
    pad.innerHTML = '<b>✨</b><span></span>';
    $('span', pad).textContent = prompt.slice(0, 18);
    pad.onclick = () => triggerSfx(prompt, pad);
    $('#asSfxGrid', wrap).append(pad);
    triggerSfx(prompt, pad);
    api.toast(`Added “${prompt.slice(0, 22)}” to your soundboard.`);
  };

  // AI Voiceover / Intro Bumper
  $('#asVoPlay', wrap).onclick = async () => {
    const text = $('#asVoText', wrap).value.trim();
    if (!text) return api.toast('Type an intro or bumper script first.');
    const voice = $('#asVoStyle', wrap).value;
    const btn = $('#asVoPlay', wrap);
    btn.disabled = true; btn.textContent = 'Speaking…';
    try {
      api.duckMusicTemporarily?.(4500);
      if (api.speakOnAir) {
        await api.speakOnAir(text, voice);
      } else if ('speechSynthesis' in window) {
        await new Promise((res) => {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = voice === 'onyx' ? 1.08 : 0.96;
          u.pitch = voice === 'onyx' ? 0.85 : voice === 'nova' ? 1.08 : 1.0;
          u.onend = res; u.onerror = res;
          speechSynthesis.speak(u);
        });
      }
    } finally {
      btn.disabled = false; btn.textContent = '🎙 Play on air';
    }
  };

  return { loadBufferFromFile };
}
