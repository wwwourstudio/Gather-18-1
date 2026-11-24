// Themeable stage graphics, motion presets, alert styles, overlay packs, countdown starting screen,
// purchase alerts, live stock badge, community goal effects, and voice super chat waveform renderer.

export const MOTION_PRESETS = {
  cinematic: {
    label: 'Cinematic',
    desc: 'Slow weighted glide with soft opacity reveal',
    inMs: 650,
    outMs: 480,
    ease: (t) => 1 - Math.pow(1 - t, 3),
    offset: (p, h) => ({ x: 0, y: (1 - p) * Math.min(36, h * 0.25), scale: 0.96 + 0.04 * p, alpha: p }),
  },
  playful: {
    label: 'Playful',
    desc: 'Bouncy spring pop with cheerful overshoot',
    inMs: 520,
    outMs: 320,
    ease: (t) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    offset: (p) => ({ x: 0, y: (1 - p) * 28, scale: 0.82 + 0.18 * p, alpha: Math.min(1, p * 1.4) }),
  },
  esports: {
    label: 'Esports',
    desc: 'Snappy high-velocity horizontal slam',
    inMs: 280,
    outMs: 220,
    ease: (t) => 1 - Math.pow(1 - t, 4),
    offset: (p, _h, w) => ({ x: -(1 - p) * Math.min(140, (w || 600) * 0.22), y: 0, scale: 1, alpha: Math.min(1, p * 1.6) }),
  },
  luxury: {
    label: 'Luxury',
    desc: 'Editorial curtain fade with refined micro-lift',
    inMs: 780,
    outMs: 600,
    ease: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    offset: (p) => ({ x: 0, y: (1 - p) * 10, scale: 0.99 + 0.01 * p, alpha: p }),
  },
};

export const ALERT_STYLES = {
  broadcast: { label: 'Broadcast', desc: 'Crisp studio bar with accent rail' },
  glass: { label: 'Frosted glass', desc: 'Translucent brand-tinted glass card' },
  neon: { label: 'Neon glow', desc: 'High-contrast edge glow for gaming' },
  minimal: { label: 'Minimal', desc: 'Clean editorial card with thin rule' },
};

export const OVERLAY_PACKS = {
  talk: {
    name: 'Talk show',
    tag: 'Editorial studio',
    desc: 'Clean lower thirds, warm glass panels & Starting Soon screen',
    brand: { tag: 'glass', bannerStyle: 'glass', frame: 'none', motion: 'cinematic', alertStyle: 'broadcast', panel: 'glass' },
    countdown: { title: 'Live talk starting soon', subtitle: 'Grab a seat and drop your questions in chat', mode: 'starting' },
    ticker: 'Live Q&A open · Drop your questions in chat to be featured on stage',
  },
  shopping: {
    name: 'Live shopping',
    tag: 'Drop ready',
    desc: 'Bold price tags, high-energy alerts & live drop countdown',
    brand: { tag: 'solid', bannerStyle: 'bold', frame: 'none', motion: 'playful', alertStyle: 'broadcast', panel: 'glass' },
    countdown: { title: 'Drop goes live in', subtitle: 'Limited stock — check out right on this page', mode: 'starting' },
    ticker: 'Live drop in progress · Tap Buy Now under the video without leaving the stream',
  },
  gaming: {
    name: 'Gaming & Esports',
    tag: 'High contrast',
    desc: 'Corner brackets, neon alerts & crisp scoreboard frame',
    brand: { tag: 'solid', bannerStyle: 'bold', frame: 'none', motion: 'esports', alertStyle: 'neon', panel: 'solid' },
    countdown: { title: 'Match loading…', subtitle: 'Lock in your XP predictions before the round starts', mode: 'starting' },
    ticker: 'Predictions open · Stake XP on the round · Play-with-me queue active',
  },
  church: {
    name: 'Church & Community',
    tag: 'Warm & clear',
    desc: 'Gentle transitions, minimal cards & welcoming countdown',
    brand: { tag: 'minimal', bannerStyle: 'minimal', frame: 'vignette', motion: 'luxury', alertStyle: 'minimal', panel: 'glass' },
    countdown: { title: 'Service begins shortly', subtitle: 'Say hello in chat and share where you’re tuning in from', mode: 'starting' },
    ticker: 'Welcome! Share a prayer request or say hello in the live chat',
  },
  education: {
    name: 'Education & Workshop',
    tag: 'Slide friendly',
    desc: 'Structured glass cards, crisp captions & clear headings',
    brand: { tag: 'outline', bannerStyle: 'classic', frame: 'none', motion: 'cinematic', alertStyle: 'glass', panel: 'glass' },
    countdown: { title: 'Workshop starts soon', subtitle: 'Slides and resources appear below the video', mode: 'starting' },
    ticker: 'Follow along with live captions · Ask questions anytime in chat',
  },
  podcast: {
    name: 'Podcast',
    tag: 'Audio-first',
    desc: 'Refined editorial frames, sleek name tags & chapter banners',
    brand: { tag: 'glass', bannerStyle: 'minimal', frame: 'none', motion: 'luxury', alertStyle: 'glass', panel: 'glass' },
    countdown: { title: 'New episode starting soon', subtitle: 'Send a voice note or super chat to join the conversation', mode: 'starting' },
    ticker: 'Live recording · Voice questions open on the watch page',
  },
};

export function hexRgb(hex = '#3b82f6') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = parseInt(m ? m[1] : '3b82f6', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isLightHex(hex = '#0f172a') {
  const [r, g, b] = hexRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
}

export function motionTransform(presetId, elapsedMs, totalMs, w, h) {
  const m = MOTION_PRESETS[presetId] || MOTION_PRESETS.cinematic;
  let p = 1;
  if (elapsedMs < m.inMs) p = m.ease(Math.max(0, Math.min(1, elapsedMs / m.inMs)));
  else if (totalMs && elapsedMs > totalMs - m.outMs) {
    const rem = Math.max(0, (totalMs - elapsedMs) / m.outMs);
    p = m.ease(Math.min(1, rem));
  }
  return m.offset(p, h || 120, w || 600);
}

/** Resolve card surface & ink colours from the active brand kit (never hardcoded white). */
export function resolveCardColors(brand = {}, styleOverride) {
  const accent = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : '#3b82f6';
  const [ar, ag, ab] = hexRgb(accent);
  const style = styleOverride || brand.alertStyle || 'broadcast';
  const isPaper = brand.bg === 'paper';
  const solidBg = brand.panelColor || (isPaper ? '#f8fafc' : '#0f172a');
  const [sr, sg, sb] = hexRgb(solidBg);
  const lightSurface = (brand.panel === 'solid' ? isLightHex(solidBg) : isPaper) && style !== 'neon';
  const opRaw = Number(brand.panelOpacity);
  const alpha = Number.isFinite(opRaw) && opRaw >= 0.35 && opRaw <= 1 ? opRaw : (brand.panel === 'solid' ? 0.95 : 0.86);
  const radRaw = Number(brand.panelRadius);
  const radius = Number.isFinite(radRaw) && radRaw >= 4 && radRaw <= 24 ? radRaw : 14;

  const bg = style === 'neon'
    ? `rgba(7, 10, 18, ${Math.max(0.84, alpha)})`
    : style === 'minimal'
      ? (lightSurface ? `rgba(255, 255, 255, ${Math.max(0.88, alpha)})` : `rgba(12, 16, 26, ${Math.max(0.86, alpha)})`)
      : brand.panel === 'solid'
        ? `rgba(${sr}, ${sg}, ${sb}, ${alpha})`
        : lightSurface
          ? `rgba(255, 255, 255, ${alpha})`
          : `rgba(${Math.round(sr * 0.72 + ar * 0.12)}, ${Math.round(sg * 0.72 + ag * 0.12)}, ${Math.round(sb * 0.72 + ab * 0.12)}, ${alpha})`;

  const ink = lightSurface ? '#0f172a' : '#f8fafc';
  const muted = lightSurface ? 'rgba(15, 23, 42, 0.68)' : 'rgba(248, 250, 252, 0.72)';
  const border = style === 'neon'
    ? `rgba(${ar}, ${ag}, ${ab}, 0.9)`
    : lightSurface
      ? 'rgba(15, 23, 42, 0.12)'
      : `rgba(${ar}, ${ag}, ${ab}, 0.34)`;

  return { accent, ar, ag, ab, bg, ink, muted, border, style, lightSurface, radius, alpha };
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function wrapLines(g, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (g.measureText(test).width <= maxW) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

/** Themeable featured chat message card on stage (replaces hardcoded white card). */
export function drawThemedFeatured(g, W, H, f, brand, font, elapsedMs, rect) {
  if (!f) return;
  const c = resolveCardColors(brand);
  const pad = Math.round(W * 0.022);
  const bw = rect ? rect.w : Math.min(Math.round(W * 0.54), 680);
  const fs = Math.round(Math.max(18, Math.min(26, bw * 0.042)));
  g.save();
  g.font = `600 ${fs}px ${font}`;
  const lines = wrapLines(g, f.text, bw - 48, 3);
  const bh = rect ? rect.h : Math.max(96, 48 + lines.length * (fs + 8) + 18);
  const x = rect ? rect.x : pad;
  const y = rect ? rect.y : H - bh - Math.round(H * 0.06);

  const tr = motionTransform(brand.motion, elapsedMs, 0, bw, bh);
  g.globalAlpha = Math.max(0, Math.min(1, tr.alpha));
  g.translate(x + bw / 2 + tr.x, y + bh / 2 + tr.y);
  g.scale(tr.scale, tr.scale);
  g.translate(-bw / 2, -bh / 2);

  g.shadowColor = c.style === 'neon' ? `rgba(${c.ar},${c.ag},${c.ab},0.48)` : 'rgba(0,0,0,0.42)';
  g.shadowBlur = c.style === 'neon' ? 28 : 24;
  g.shadowOffsetY = c.style === 'neon' ? 0 : 10;
  g.fillStyle = c.bg;
  rrect(g, 0, 0, bw, bh, c.style === 'minimal' ? 10 : 16);
  g.fill();
  g.shadowColor = 'transparent';

  g.strokeStyle = c.border;
  g.lineWidth = c.style === 'neon' ? 2 : 1.25;
  rrect(g, 0.5, 0.5, bw - 1, bh - 1, c.style === 'minimal' ? 10 : 16);
  g.stroke();

  // Accent rail (broadcast & neon)
  if (c.style !== 'minimal') {
    g.fillStyle = c.accent;
    rrect(g, 0, 0, 6, bh, [16, 0, 0, 16]);
    g.fill();
  } else {
    g.fillStyle = c.accent;
    g.fillRect(18, 0, 48, 3);
  }

  // Author header + paid badge
  g.font = `700 ${Math.round(fs * 0.68)}px ${font}`;
  g.fillStyle = c.accent;
  g.textBaseline = 'top';
  g.fillText(f.name || 'Viewer', 22, 16);
  if (f.paid) {
    const nw = g.measureText(f.name || 'Viewer').width;
    const pw = g.measureText(f.paid).width + 18;
    g.fillStyle = `rgba(${c.ar},${c.ag},${c.ab},0.22)`;
    rrect(g, 22 + nw + 10, 12, pw, Math.round(fs * 0.95), 999);
    g.fill();
    g.fillStyle = c.ink;
    g.fillText(f.paid, 22 + nw + 19, 15);
  }

  g.font = `600 ${fs}px ${font}`;
  g.fillStyle = c.ink;
  lines.forEach((ln, i) => g.fillText(ln, 22, 42 + i * (fs + 7)));
  g.restore();
}

/** Themeable live purchase alert ("Riley just bought the hoodie"). */
export function drawPurchaseAlert(g, W, H, alert, brand, font, now = Date.now()) {
  if (!alert || !alert.ts) return;
  const elapsed = now - alert.ts;
  const dur = 6800;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > dur) return;
  const c = resolveCardColors(brand);
  const bw = Math.min(480, Math.round(W * 0.42));
  const bh = 78;
  const x = W - bw - Math.round(W * 0.025);
  const y = Math.round(H * 0.05);
  const tr = motionTransform(brand.motion, elapsed, dur, bw, bh);

  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, tr.alpha));
  g.translate(x + bw / 2 + tr.x, y + bh / 2 + tr.y);
  g.scale(tr.scale, tr.scale);
  g.translate(-bw / 2, -bh / 2);

  g.shadowColor = c.style === 'neon' ? `rgba(${c.ar},${c.ag},${c.ab},0.55)` : 'rgba(0,0,0,0.45)';
  g.shadowBlur = 24;
  g.fillStyle = c.bg;
  rrect(g, 0, 0, bw, bh, 16);
  g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = c.border;
  g.lineWidth = 1.5;
  rrect(g, 0.5, 0.5, bw - 1, bh - 1, 16);
  g.stroke();

  // Bag badge
  g.fillStyle = c.accent;
  rrect(g, 14, 15, 48, 48, 12);
  g.fill();
  g.font = `700 22px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = isLightHex(c.accent) ? '#0b0e14' : '#ffffff';
  g.fillText('🛍', 38, 40);

  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.font = `700 13px ${font}`;
  g.fillStyle = c.accent;
  g.fillText('LIVE PURCHASE' + (alert.price ? ` · ${alert.price}` : ''), 74, 16);
  g.font = `700 19px ${font}`;
  g.fillStyle = c.ink;
  const msg = `${alert.buyer || 'A viewer'} just bought ${alert.title}`;
  g.fillText(msg.length > 36 ? msg.slice(0, 35) + '…' : msg, 74, 37);
  g.restore();
}

/** Live shopping stock counter & drop timer badge on stage ("12 left!"). */
export function drawShopDropBadge(g, W, H, shop, brand, font, now = Date.now()) {
  if (!shop || !shop.pinned) return;
  const item = (shop.items || []).find((x) => x.id === shop.pinned);
  if (!item) return;
  const hasStock = item.stock != null;
  const hasDrop = shop.dropUntil && shop.dropUntil > now;
  if (!hasStock && !hasDrop) return;

  const c = resolveCardColors(brand);
  const remSec = hasDrop ? Math.max(0, Math.ceil((shop.dropUntil - now) / 1000)) : 0;
  const mm = String(Math.floor(remSec / 60)).padStart(2, '0');
  const ss = String(remSec % 60).padStart(2, '0');
  const label = [
    item.title.slice(0, 22),
    item.price || '',
    hasStock ? (item.stock > 0 ? `${item.stock} left!` : 'SOLD OUT') : '',
    hasDrop ? `⏱ ${mm}:${ss}` : '',
  ].filter(Boolean).join(' · ');

  g.save();
  g.font = `700 15px ${font}`;
  const tw = g.measureText(label).width;
  const bw = Math.min(W - 40, tw + 44);
  const bh = 40;
  const x = Math.round(W * 0.025);
  const y = Math.round(H * 0.045);

  g.fillStyle = c.bg;
  rrect(g, x, y, bw, bh, 12);
  g.fill();
  g.strokeStyle = c.border;
  g.lineWidth = 1.5;
  rrect(g, x, y, bw, bh, 12);
  g.stroke();

  g.fillStyle = item.stock === 0 ? '#ef4444' : c.accent;
  g.beginPath();
  g.arc(x + 18, y + bh / 2, 5, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = c.ink;
  g.textBaseline = 'middle';
  g.fillText(label, x + 31, y + bh / 2 + 1);
  g.restore();
}

/** Voice super chat on air: animated waveform & viewer's name while music ducks. */
export function drawVoiceOnAir(g, W, H, voice, brand, font, now = Date.now()) {
  if (!voice || !voice.ts) return;
  const elapsed = now - voice.ts;
  const dur = (voice.dur || 8) * 1000;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > dur + 800) return;
  const c = resolveCardColors(brand);
  const bw = Math.min(440, Math.round(W * 0.38));
  const bh = 82;
  const x = Math.round((W - bw) / 2);
  const y = H - bh - Math.round(H * 0.14);

  g.save();
  g.fillStyle = c.bg;
  g.shadowColor = `rgba(${c.ar},${c.ag},${c.ab},0.45)`;
  g.shadowBlur = 26;
  rrect(g, x, y, bw, bh, 18);
  g.fill();
  g.shadowColor = 'transparent';
  g.strokeStyle = c.accent;
  g.lineWidth = 2;
  rrect(g, x, y, bw, bh, 18);
  g.stroke();

  g.textBaseline = 'top';
  g.font = `700 13px ${font}`;
  g.fillStyle = c.accent;
  const amt = voice.amount ? ` · $${voice.amount}` : '';
  g.fillText(`VOICE SUPER CHAT ON AIR${amt}`, x + 18, y + 12);
  g.font = `700 17px ${font}`;
  g.fillStyle = c.ink;
  g.fillText(voice.name || 'Viewer', x + 18, y + 32);

  // Animated 18-bar waveform on the right
  const bars = 18;
  const wx = x + bw - bars * 8 - 18;
  for (let i = 0; i < bars; i++) {
    const wave = 0.28 + 0.72 * Math.abs(Math.sin(now / 120 + i * 0.62) * Math.cos(now / 210 - i * 0.31));
    const h = Math.round(8 + wave * 34);
    g.fillStyle = i % 3 === 0 ? c.ink : c.accent;
    rrect(g, wx + i * 8, y + bh / 2 - h / 2 + 4, 4.5, h, 3);
    g.fill();
  }
  g.restore();
}

/** Community goal confetti overlay when a milestone unlocks confetti mode. */
export function drawGoalConfetti(g, W, H, now, accent = '#3b82f6') {
  const palette = [accent, '#f59e0b', '#ec4899', '#10b981', '#ffffff'];
  g.save();
  for (let i = 0; i < 42; i++) {
    const speed = 0.06 + (i % 7) * 0.015;
    const x = ((i * 137.5 + Math.sin(now / 600 + i) * 32) % W + W) % W;
    const y = ((now * speed + i * 73) % (H + 40)) - 20;
    const rot = (now / 300 + i) % (Math.PI * 2);
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = palette[i % palette.length];
    g.globalAlpha = 0.82;
    g.fillRect(-5, -3, 10, 6);
    g.restore();
  }
  g.restore();
}

/** Render a procedural animated AI countdown video backdrop onto any 2D canvas. */
export function renderAiCountdownBg(g, W, H, cfg = {}, brand = {}, now = performance.now()) {
  const style = cfg.style || 'aurora';
  const accent = /^#[0-9a-f]{6}$/i.test(cfg.color || '') ? cfg.color : (/^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : '#3b82f6');
  const secondary = /^#[0-9a-f]{6}$/i.test(cfg.color2 || '') ? cfg.color2 : '#8b5cf6';
  const [ar, ag, ab] = hexRgb(accent);
  const [br, bg2, bb] = hexRgb(secondary);
  const speed = Math.max(0.3, Math.min(2.5, Number(cfg.speed) || 1));
  const t = (now / 1000) * speed;

  g.save();
  // Deep base canvas
  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, '#050814');
  base.addColorStop(0.55, `rgb(${Math.round(8 + ar * 0.08)}, ${Math.round(11 + ag * 0.08)}, ${Math.round(22 + ab * 0.12)})`);
  base.addColorStop(1, '#070b18');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  if (style === 'neon-grid') {
    // Horizon glow
    const hy = H * 0.56;
    const sun = g.createRadialGradient(W * 0.5, hy, 12, W * 0.5, hy, W * 0.45);
    sun.addColorStop(0, `rgba(${ar},${ag},${ab},0.48)`);
    sun.addColorStop(0.45, `rgba(${br},${bg2},${bb},0.22)`);
    sun.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, W, H);

    // Perspective receding neon floor grid
    g.strokeStyle = `rgba(${ar},${ag},${ab},0.44)`;
    g.lineWidth = Math.max(1, W * 0.0014);
    for (let i = -10; i <= 10; i++) {
      g.beginPath();
      g.moveTo(W * 0.5 + i * W * 0.035, hy);
      g.lineTo(W * 0.5 + i * W * 0.19, H);
      g.stroke();
    }
    const scroll = (t * 0.55) % 1;
    for (let j = 0; j < 14; j++) {
      const f = Math.pow((j + scroll) / 14, 2.1);
      const y = hy + f * (H - hy);
      g.strokeStyle = `rgba(${ar},${ag},${ab},${0.14 + f * 0.46})`;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    // Floating digital dust above horizon
    for (let k = 0; k < 28; k++) {
      const x = ((k * 197.3 + t * (14 + (k % 5) * 6)) % W + W) % W;
      const y = ((k * 73.1) % (hy * 0.92));
      const a = 0.25 + 0.35 * Math.sin(t * 2 + k);
      g.fillStyle = `rgba(${ar},${ag},${ab},${a})`;
      g.beginPath();
      g.arc(x, y, 1.5 + (k % 3), 0, Math.PI * 2);
      g.fill();
    }
  } else if (style === 'starfield') {
    const neb = g.createRadialGradient(W * 0.65, H * 0.38, 10, W * 0.5, H * 0.5, W * 0.6);
    neb.addColorStop(0, `rgba(${br},${bg2},${bb},0.32)`);
    neb.addColorStop(0.5, `rgba(${ar},${ag},${ab},0.16)`);
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = neb;
    g.fillRect(0, 0, W, H);

    const cx = W * 0.5, cy = H * 0.5;
    for (let i = 0; i < 90; i++) {
      const ang = (i * 2.39996) % (Math.PI * 2);
      const z = ((i * 0.13 + t * 0.28) % 1);
      const r0 = Math.pow(z, 2.2) * W * 0.62;
      const r1 = Math.pow(Math.min(1, z + 0.045), 2.2) * W * 0.62;
      g.strokeStyle = i % 4 === 0 ? `rgba(${ar},${ag},${ab},${z * 0.85})` : `rgba(241,245,249,${z * 0.75})`;
      g.lineWidth = 0.8 + z * 2.2;
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      g.stroke();
    }
  } else if (style === 'liquid' || style === 'bokeh') {
    const count = style === 'bokeh' ? 18 : 6;
    for (let i = 0; i < count; i++) {
      const px = W * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(t * (0.28 + (i % 4) * 0.08) + i * 1.7)));
      const py = H * (0.15 + 0.7 * (0.5 + 0.5 * Math.cos(t * (0.22 + (i % 3) * 0.09) + i * 2.3)));
      const rad = style === 'bokeh' ? W * (0.035 + (i % 5) * 0.018) : W * (0.24 + (i % 3) * 0.08);
      const useSecond = i % 2 === 1;
      const rr = useSecond ? br : ar, rg2 = useSecond ? bg2 : ag, rb = useSecond ? bb : ab;
      const og = g.createRadialGradient(px, py, 2, px, py, rad);
      og.addColorStop(0, `rgba(${rr},${rg2},${rb},${style === 'bokeh' ? 0.28 : 0.34})`);
      og.addColorStop(0.65, `rgba(${rr},${rg2},${rb},${style === 'bokeh' ? 0.10 : 0.12})`);
      og.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = og;
      g.beginPath();
      g.arc(px, py, rad, 0, Math.PI * 2);
      g.fill();
    }
  } else if (style === 'esports') {
    // High-contrast kinetic diagonal slashes & pulsing HUD chevrons
    for (let i = -3; i < 8; i++) {
      const shift = ((t * 90 + i * 210) % (W + 420)) - 210;
      const slash = g.createLinearGradient(shift, 0, shift + 160, H);
      slash.addColorStop(0, `rgba(${ar},${ag},${ab},0)`);
      slash.addColorStop(0.5, `rgba(${ar},${ag},${ab},${i % 2 === 0 ? 0.18 : 0.09})`);
      slash.addColorStop(1, `rgba(${br},${bg2},${bb},0)`);
      g.fillStyle = slash;
      g.beginPath();
      g.moveTo(shift, 0);
      g.lineTo(shift + 90, 0);
      g.lineTo(shift - 130, H);
      g.lineTo(shift - 220, H);
      g.closePath();
      g.fill();
    }
    // Tactical subtle grid dots
    g.fillStyle = `rgba(${ar},${ag},${ab},0.16)`;
    const step = Math.max(36, Math.round(W / 24));
    for (let x = step; x < W; x += step) {
      for (let y = step; y < H; y += step) {
        g.fillRect(x, y, 2, 2);
      }
    }
  } else {
    // Aurora waves (default)
    for (let w = 0; w < 4; w++) {
      g.beginPath();
      const baseY = H * (0.28 + w * 0.16);
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += Math.max(24, W / 36)) {
        const y = baseY + Math.sin(x * 0.0045 + t * (0.65 + w * 0.18) + w * 1.4) * H * 0.11
          + Math.cos(x * 0.009 - t * 0.4 + w) * H * 0.04;
        g.lineTo(x, y);
      }
      g.lineTo(W, H);
      g.closePath();
      const wg = g.createLinearGradient(0, baseY - H * 0.15, 0, H);
      const isAlt = w % 2 === 1;
      wg.addColorStop(0, `rgba(${isAlt ? br : ar},${isAlt ? bg2 : ag},${isAlt ? bb : ab},${0.26 - w * 0.04})`);
      wg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = wg;
      g.fill();
    }
  }
  g.restore();
}

function drawCoverMedia(g, media, W, H) {
  const mw = media.videoWidth || media.naturalWidth || media.width || 0;
  const mh = media.videoHeight || media.naturalHeight || media.height || 0;
  if (!mw || !mh) return false;
  const scale = Math.max(W / mw, H / mh);
  const dw = mw * scale, dh = mh * scale;
  g.drawImage(media, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return true;
}

/** Full themed Countdown Starting / Intermission / BRB / Ending Screen with video/AI backgrounds & legible chat card. */
export function drawCountdownScreen(g, W, H, cd, brand, font, recentChat, now) {
  if (!cd || !cd.on) return;
  const c = resolveCardColors(brand);
  const cdAccent = /^#[0-9a-f]{6}$/i.test(cd.accent || '') ? cd.accent : c.accent;
  const [ar, ag, ab] = hexRgb(cdAccent);
  const layout = cd.layout || 'split';
  const dim = Number.isFinite(Number(cd.dim)) ? Math.max(0, Math.min(0.88, Number(cd.dim))) : 0.42;
  const isLightPaper = brand.bg === 'paper' && !cd.bgType;

  g.save();

  // 1. Backdrop: Custom uploaded video -> AI generated video -> Atmospheric brand gradient
  let drewVideo = false;
  if (cd.bgType === 'video' && typeof window !== 'undefined' && window.__gatherCdVideo) {
    const v = window.__gatherCdVideo;
    if (v.readyState >= 2) {
      try { drewVideo = drawCoverMedia(g, v, W, H); } catch {}
    }
  }
  if (!drewVideo && cd.bgType === 'ai' && cd.aiBg) {
    renderAiCountdownBg(g, W, H, cd.aiBg, { ...brand, color: cdAccent }, now);
    drewVideo = true;
  }
  if (!drewVideo) {
    const grad = g.createLinearGradient(0, 0, W, H);
    if (isLightPaper) {
      grad.addColorStop(0, '#f4f2ec');
      grad.addColorStop(1, `rgba(${ar},${ag},${ab},0.18)`);
    } else {
      grad.addColorStop(0, '#070a14');
      grad.addColorStop(0.55, `rgba(${Math.round(ar * 0.22)},${Math.round(ag * 0.22)},${Math.round(ab * 0.28)},1)`);
      grad.addColorStop(1, '#090d1a');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const pulse = 0.5 + 0.5 * Math.sin(now / 1400);
    const rg = g.createRadialGradient(W * 0.28, H * 0.44, 10, W * 0.28, H * 0.44, W * 0.45);
    rg.addColorStop(0, `rgba(${ar},${ag},${ab},${0.20 + pulse * 0.08})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
  } else if (dim > 0.01) {
    // Scrim over video/AI backdrop for crisp broadcast legibility
    g.fillStyle = `rgba(5, 8, 18, ${dim})`;
    g.fillRect(0, 0, W, H);
  }

  // Compute remaining time & progress fraction
  const totalSec = Math.max(1, Number(cd.totalSec) || 300);
  const remMs = cd.target ? Math.max(0, cd.target - now) : 0;
  const rem = Math.ceil(remMs / 1000);
  const mm = String(Math.floor(rem / 60)).padStart(2, '0');
  const ss = String(rem % 60).padStart(2, '0');
  const timerStr = `${mm}:${ss}`;
  const showTimer = !!(cd.target && cd.mode !== 'ending');
  const progFrac = showTimer ? Math.max(0, Math.min(1, 1 - remMs / (totalSec * 1000))) : 1;
  const modeLabel = { starting: 'STARTING SOON', intermission: 'INTERMISSION', brb: 'BE RIGHT BACK', ending: 'THANKS FOR WATCHING' }[cd.mode] || 'STARTING SOON';

  const inkMain = isLightPaper ? '#0f172a' : '#f8fafc';
  const inkSub = isLightPaper ? 'rgba(15, 23, 42, 0.72)' : 'rgba(241, 245, 249, 0.80)';

  const drawChatCard = (cx, cardY, cw, ch) => {
    g.save();
    // Always render high-contrast frosted glass chat surface (never clashes with solid bright panelColor)
    g.fillStyle = isLightPaper ? 'rgba(255, 255, 255, 0.88)' : 'rgba(10, 15, 28, 0.76)';
    rrect(g, cx, cardY, cw, ch, 16);
    g.fill();
    g.strokeStyle = isLightPaper ? 'rgba(15, 23, 42, 0.12)' : `rgba(${ar},${ag},${ab},0.35)`;
    g.lineWidth = 1.5;
    rrect(g, cx, cardY, cw, ch, 16);
    g.stroke();

    // Header bar
    const padX = Math.round(cw * 0.065);
    const headY = cardY + 22;
    g.fillStyle = cdAccent;
    g.beginPath();
    g.arc(cx + padX + 4, headY + 6, 4.5, 0, Math.PI * 2);
    g.fill();

    g.font = `700 ${Math.round(W * 0.0115)}px ${font}`;
    g.fillStyle = isLightPaper ? '#0f172a' : '#f8fafc';
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillText('LIVE CHAT', cx + padX + 16, headY);

    // Hairline divider
    g.fillStyle = isLightPaper ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.10)';
    g.fillRect(cx + padX, cardY + 48, cw - padX * 2, 1);

    const msgs = (recentChat || []).slice(-5);
    let my = cardY + 64;
    const bodyFs = Math.max(13, Math.round(W * 0.012));
    if (!msgs.length) {
      g.font = `500 ${bodyFs}px ${font}`;
      g.fillStyle = isLightPaper ? 'rgba(15, 23, 42, 0.62)' : 'rgba(226, 232, 240, 0.68)';
      const emptyLines = wrapLines(g, 'Say hello in chat while we get ready…', cw - padX * 2, 3);
      emptyLines.forEach((ln, i) => g.fillText(ln, cx + padX, my + i * (bodyFs + 6)));
    } else {
      for (const m of msgs) {
        g.font = `700 ${bodyFs}px ${font}`;
        g.fillStyle = cdAccent;
        g.fillText(String(m.name || 'Viewer').slice(0, 22), cx + padX, my);
        g.font = `500 ${bodyFs}px ${font}`;
        g.fillStyle = isLightPaper ? '#1e293b' : '#f1f5f9';
        const lines = wrapLines(g, String(m.text || ''), cw - padX * 2, 2);
        lines.forEach((ln, i) => g.fillText(ln, cx + padX, my + bodyFs + 5 + i * (bodyFs + 4)));
        my += bodyFs * (lines.length + 1) + 22;
        if (my > cardY + ch - 36) break;
      }
    }
    g.restore();
  };

  if (layout === 'center') {
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const cx = W * 0.5;
    // Eyebrow pill-free uppercase label
    g.font = `700 ${Math.round(W * 0.014)}px ${font}`;
    g.fillStyle = cdAccent;
    g.fillText(modeLabel, cx, Math.round(H * 0.15));

    // Main title
    g.font = `800 ${Math.round(W * 0.044)}px ${font}`;
    g.fillStyle = inkMain;
    g.fillText(String(cd.title || 'Starting soon').slice(0, 46), cx, Math.round(H * 0.21));

    // Center timer + optional circular ring
    const ringCy = Math.round(H * 0.54);
    if (showTimer) {
      if (cd.showProgress !== false) {
        const rr2 = Math.round(H * 0.19);
        g.lineWidth = Math.max(5, Math.round(W * 0.005));
        g.strokeStyle = isLightPaper ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.12)';
        g.beginPath(); g.arc(cx, ringCy, rr2, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = cdAccent;
        g.lineCap = 'round';
        g.beginPath(); g.arc(cx, ringCy, rr2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progFrac); g.stroke();
      }
      g.textBaseline = 'middle';
      g.font = `800 ${Math.round(W * 0.072)}px "JetBrains Mono", ${font}`;
      g.fillStyle = inkMain;
      g.fillText(timerStr, cx, ringCy + 2);
      g.textBaseline = 'top';
    }

    if (cd.subtitle) {
      g.font = `500 ${Math.round(W * 0.017)}px ${font}`;
      g.fillStyle = inkSub;
      g.fillText(String(cd.subtitle).slice(0, 80), cx, Math.round(H * 0.80));
    }
  } else if (layout === 'cinema') {
    // Full-bleed video showcase with sleek frosted lower-third countdown bar
    const barH = Math.round(H * 0.21);
    const barY = H - barH - Math.round(H * 0.055);
    const barX = Math.round(W * 0.045);
    const barW = W - barX * 2;
    g.fillStyle = isLightPaper ? 'rgba(255,255,255,0.9)' : 'rgba(8, 12, 24, 0.82)';
    rrect(g, barX, barY, barW, barH, 16);
    g.fill();
    g.strokeStyle = `rgba(${ar},${ag},${ab},0.42)`;
    g.lineWidth = 1.5;
    rrect(g, barX, barY, barW, barH, 16);
    g.stroke();

    // Accent rail on left of bar
    g.fillStyle = cdAccent;
    rrect(g, barX + 14, barY + 18, 5, barH - 36, 3);
    g.fill();

    g.textAlign = 'left';
    g.textBaseline = 'top';
    const tx = barX + 34;
    g.font = `700 ${Math.round(W * 0.012)}px ${font}`;
    g.fillStyle = cdAccent;
    g.fillText(modeLabel, tx, barY + 18);

    g.font = `800 ${Math.round(W * 0.032)}px ${font}`;
    g.fillStyle = inkMain;
    g.fillText(String(cd.title || 'Starting soon').slice(0, 42), tx, barY + Math.round(barH * 0.28));

    if (cd.subtitle) {
      g.font = `500 ${Math.round(W * 0.0145)}px ${font}`;
      g.fillStyle = inkSub;
      g.fillText(String(cd.subtitle).slice(0, 72), tx, barY + Math.round(barH * 0.68));
    }

    if (showTimer) {
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.font = `800 ${Math.round(W * 0.062)}px "JetBrains Mono", ${font}`;
      g.fillStyle = cdAccent;
      g.fillText(timerStr, barX + barW - 28, barY + barH * 0.48);
    }

    if (cd.showProgress !== false && showTimer) {
      const py = barY + barH - 6;
      g.fillStyle = isLightPaper ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.12)';
      rrect(g, barX + 18, py, barW - 36, 4, 2); g.fill();
      g.fillStyle = cdAccent;
      rrect(g, barX + 18, py, Math.max(8, (barW - 36) * progFrac), 4, 2); g.fill();
    }
    if (cd.showChat) {
      drawChatCard(Math.round(W * 0.69), Math.round(H * 0.07), Math.round(W * 0.265), Math.round(H * 0.58));
    }
  } else {
    // 'split' (default Broadcast Split) or 'esports' (bold HUD accents)
    const isEsports = layout === 'esports';
    const leftW = cd.showChat ? W * 0.56 : W * 0.84;
    const lx = Math.round(W * 0.065);
    const cy = Math.round(H * 0.46);

    if (isEsports) {
      // Tactical corner brackets
      const m = Math.round(W * 0.025), bLen = Math.round(W * 0.032);
      g.strokeStyle = cdAccent;
      g.lineWidth = 3;
      for (const [x0, y0, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
        g.beginPath(); g.moveTo(x0, y0 + dy * bLen); g.lineTo(x0, y0); g.lineTo(x0 + dx * bLen, y0); g.stroke();
      }
    }

    g.textAlign = 'left';
    g.textBaseline = 'top';

    // Mode eyebrow
    g.fillStyle = cdAccent;
    g.font = `700 ${Math.round(W * 0.0145)}px ${font}`;
    g.fillText(modeLabel, lx, cy - Math.round(H * 0.24));

    // Main headline
    g.fillStyle = inkMain;
    g.font = `800 ${Math.round(W * (isEsports ? 0.05 : 0.045))}px ${font}`;
    const titleLines = wrapLines(g, cd.title || 'Starting soon', leftW, 2);
    titleLines.forEach((ln, i) => g.fillText(ln, lx, cy - Math.round(H * 0.18) + i * Math.round(W * 0.050)));

    // Big tabular countdown digits
    const timerY = cy + Math.round(H * (titleLines.length > 1 ? 0.04 : -0.01));
    if (showTimer) {
      g.font = `800 ${Math.round(W * 0.095)}px "JetBrains Mono", ${font}`;
      g.fillStyle = isEsports ? '#ffffff' : cdAccent;
      if (isEsports) { g.shadowColor = `rgba(${ar},${ag},${ab},0.75)`; g.shadowBlur = 24; }
      g.fillText(timerStr, lx, timerY);
      g.shadowBlur = 0;

      if (cd.showProgress !== false) {
        const pW = Math.min(Math.round(leftW * 0.82), Math.round(W * 0.42));
        const pY = timerY + Math.round(W * 0.108);
        g.fillStyle = isLightPaper ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.14)';
        rrect(g, lx, pY, pW, 6, 3); g.fill();
        g.fillStyle = cdAccent;
        rrect(g, lx, pY, Math.max(10, pW * progFrac), 6, 3); g.fill();
      }
    }

    // Subtitle
    if (cd.subtitle) {
      g.font = `500 ${Math.round(W * 0.0175)}px ${font}`;
      g.fillStyle = inkSub;
      const subY = showTimer ? timerY + Math.round(W * 0.13) : cy + Math.round(H * 0.06);
      const subLines = wrapLines(g, cd.subtitle, leftW, 2);
      subLines.forEach((ln, i) => g.fillText(ln, lx, subY + i * Math.round(W * 0.024)));
    }

    if (cd.showChat) {
      drawChatCard(Math.round(W * 0.66), Math.round(H * 0.16), Math.round(W * 0.28), Math.round(H * 0.68));
    }
  }
  g.restore();
}

/** Draw sponsor card overlay on stage when a sponsor slot is active. */
export function drawSponsorCard(g, W, H, sponsor, brand, font) {
  if (!sponsor) return;
  const c = resolveCardColors(brand);
  const bw = Math.min(360, Math.round(W * 0.3));
  const bh = 96;
  const x = W - bw - Math.round(W * 0.025);
  const y = H - bh - Math.round(H * 0.055);
  g.save();
  g.fillStyle = c.bg;
  rrect(g, x, y, bw, bh, 14);
  g.fill();
  g.strokeStyle = c.border;
  g.lineWidth = 1.5;
  rrect(g, x, y, bw, bh, 14);
  g.stroke();
  g.fillStyle = c.accent;
  rrect(g, x, y, 5, bh, [14, 0, 0, 14]);
  g.fill();
  g.textBaseline = 'top';
  g.font = `700 11px ${font}`;
  g.fillStyle = c.accent;
  g.fillText('SPONSORED BY ' + String(sponsor.brand || '').toUpperCase(), x + 16, y + 12);
  g.font = `700 16px ${font}`;
  g.fillStyle = c.ink;
  g.fillText(String(sponsor.headline || sponsor.brand || '').slice(0, 34), x + 16, y + 32);
  if (sponsor.code) {
    g.font = `600 13px "JetBrains Mono", ${font}`;
    g.fillStyle = c.muted;
    g.fillText(`Code: ${sponsor.code}`, x + 16, y + 58);
  }
  g.restore();
}
