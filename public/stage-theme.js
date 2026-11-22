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

  const bg = style === 'neon'
    ? 'rgba(7, 10, 18, 0.92)'
    : style === 'minimal'
      ? (lightSurface ? 'rgba(255, 255, 255, 0.94)' : 'rgba(12, 16, 26, 0.92)')
      : brand.panel === 'solid'
        ? `rgba(${sr}, ${sg}, ${sb}, 0.95)`
        : lightSurface
          ? 'rgba(255, 255, 255, 0.88)'
          : `rgba(${Math.round(sr * 0.72 + ar * 0.12)}, ${Math.round(sg * 0.72 + ag * 0.12)}, ${Math.round(sb * 0.72 + ab * 0.12)}, 0.86)`;

  const ink = lightSurface ? '#0f172a' : '#f8fafc';
  const muted = lightSurface ? 'rgba(15, 23, 42, 0.68)' : 'rgba(248, 250, 252, 0.72)';
  const border = style === 'neon'
    ? `rgba(${ar}, ${ag}, ${ab}, 0.9)`
    : lightSurface
      ? 'rgba(15, 23, 42, 0.12)'
      : `rgba(${ar}, ${ag}, ${ab}, 0.34)`;

  return { accent, ar, ag, ab, bg, ink, muted, border, style, lightSurface };
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

/** Full themed Countdown Starting / Intermission / BRB / Ending Screen with live chat preview. */
export function drawCountdownScreen(g, W, H, cd, brand, font, recentChat, now) {
  if (!cd || !cd.on) return;
  const c = resolveCardColors(brand);
  const [ar, ag, ab] = hexRgb(c.accent);
  g.save();

  // Rich atmospheric themed backdrop
  const grad = g.createLinearGradient(0, 0, W, H);
  if (brand.bg === 'paper') {
    grad.addColorStop(0, '#f4f2ec');
    grad.addColorStop(1, `rgba(${ar},${ag},${ab},0.18)`);
  } else {
    grad.addColorStop(0, '#070a12');
    grad.addColorStop(0.55, `rgba(${Math.round(ar * 0.25)},${Math.round(ag * 0.25)},${Math.round(ab * 0.28)},1)`);
    grad.addColorStop(1, '#090d18');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // Subtle animated ambient orb
  const pulse = 0.5 + 0.5 * Math.sin(now / 1400);
  const rg = g.createRadialGradient(W * 0.28, H * 0.44, 10, W * 0.28, H * 0.44, W * 0.42);
  rg.addColorStop(0, `rgba(${ar},${ag},${ab},${0.22 + pulse * 0.1})`);
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);

  const leftW = cd.showChat ? W * 0.6 : W * 0.84;
  const lx = Math.round(W * 0.065);
  const cy = Math.round(H * 0.48);

  // Mode eyebrow
  const modeLabel = { starting: 'STARTING SOON', intermission: 'INTERMISSION', brb: 'BE RIGHT BACK', ending: 'THANKS FOR WATCHING' }[cd.mode] || 'STARTING SOON';
  g.fillStyle = c.accent;
  g.font = `700 ${Math.round(W * 0.015)}px ${font}`;
  g.textBaseline = 'top';
  g.fillText(modeLabel, lx, cy - Math.round(H * 0.22));

  // Main headline
  g.fillStyle = brand.bg === 'paper' ? '#0f172a' : '#ffffff';
  g.font = `800 ${Math.round(W * 0.046)}px ${font}`;
  const titleLines = wrapLines(g, cd.title || 'Starting soon', leftW, 2);
  titleLines.forEach((ln, i) => g.fillText(ln, lx, cy - Math.round(H * 0.16) + i * Math.round(W * 0.052)));

  // Big tabular countdown digits
  if (cd.target && cd.mode !== 'ending') {
    const rem = Math.max(0, Math.ceil((cd.target - now) / 1000));
    const mm = String(Math.floor(rem / 60)).padStart(2, '0');
    const ss = String(rem % 60).padStart(2, '0');
    g.font = `800 ${Math.round(W * 0.095)}px "JetBrains Mono", ${font}`;
    g.fillStyle = c.accent;
    g.fillText(`${mm}:${ss}`, lx, cy + Math.round(H * 0.01));
  }

  // Subtitle
  if (cd.subtitle) {
    g.font = `500 ${Math.round(W * 0.018)}px ${font}`;
    g.fillStyle = brand.bg === 'paper' ? 'rgba(15,23,42,0.72)' : 'rgba(248,250,252,0.76)';
    g.fillText(cd.subtitle, lx, cy + Math.round(H * 0.21));
  }

  // Chat preview card on the right
  if (cd.showChat) {
    const cx = Math.round(W * 0.67);
    const cw = Math.round(W * 0.27);
    const ch = Math.round(H * 0.62);
    const cardY = Math.round(H * 0.19);
    g.fillStyle = c.bg;
    rrect(g, cx, cardY, cw, ch, 18);
    g.fill();
    g.strokeStyle = c.border;
    g.lineWidth = 1.5;
    rrect(g, cx, cardY, cw, ch, 18);
    g.stroke();

    g.font = `700 ${Math.round(W * 0.013)}px ${font}`;
    g.fillStyle = c.accent;
    g.fillText('LIVE CHAT PREVIEW', cx + 20, cardY + 18);

    const msgs = (recentChat || []).slice(-6);
    let my = cardY + 52;
    g.font = `500 ${Math.round(W * 0.013)}px ${font}`;
    if (!msgs.length) {
      g.fillStyle = c.muted;
      g.fillText('Say hello in chat while we get ready…', cx + 20, my);
    } else {
      for (const m of msgs) {
        g.fillStyle = c.accent;
        g.fillText(m.name || 'Viewer', cx + 20, my);
        g.fillStyle = c.ink;
        const txt = String(m.text || '').slice(0, 44);
        g.fillText(txt, cx + 20, my + 20);
        my += 52;
        if (my > cardY + ch - 36) break;
      }
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
