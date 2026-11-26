// Native lightweight SVG area sparklines for Live Chat Mood & Guest Mic Activity.
// Replaces the 640 KB React + Recharts bundle with ~4 KB of zero-dependency SVG.

const SVG_NS = 'http://www.w3.org/2000/svg';

const MOOD_COLORS = {
  idle: '#8a97ae',
  hype: '#34d399',
  warm: '#4fd1a5',
  steady: '#7fa8ff',
  mixed: '#f59e0b',
  tense: '#ff6b7a',
};

const stateMap = new WeakMap();

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  return node;
}

/** Build a smooth monotone cubic spline SVG path (Fritsch-Carlson) matching Recharts monotone curves. */
function monotonePath(coords) {
  const n = coords.length;
  if (!n) return '';
  if (n === 1) return `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
  if (n === 2) {
    return `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}L${coords[1].x.toFixed(2)},${coords[1].y.toFixed(2)}`;
  }

  const dx = new Array(n - 1);
  const dy = new Array(n - 1);
  const m = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = coords[i + 1].x - coords[i].x || 1;
    dy[i] = coords[i + 1].y - coords[i].y;
    m[i] = dy[i] / dx[i];
  }

  const c1 = new Array(n);
  c1[0] = m[0];
  c1[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      c1[i] = 0;
    } else {
      const common = dx[i - 1] + dx[i];
      c1[i] = (3 * common) / ((common + dx[i]) / m[i - 1] + (common + dx[i - 1]) / m[i]);
    }
  }

  let d = `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const step = dx[i] / 3;
    const x1 = coords[i].x + step;
    const y1 = coords[i].y + c1[i] * step;
    const x2 = coords[i + 1].x - step;
    const y2 = coords[i + 1].y - c1[i + 1] * step;
    d += `C${x1.toFixed(2)},${y1.toFixed(2)},${x2.toFixed(2)},${y2.toFixed(2)},${coords[i + 1].x.toFixed(2)},${coords[i + 1].y.toFixed(2)}`;
  }
  return d;
}

function ensureHost(container) {
  let st = stateMap.get(container);
  if (st && st.wrap.isConnected && st.wrap.parentElement === container) return st;

  container.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'gspark-wrap';
  wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:visible;user-select:none;';

  const svg = el('svg', {
    class: 'gspark-svg',
    preserveAspectRatio: 'none',
    style: 'display:block;width:100%;height:100%;overflow:visible;',
  });

  const tip = document.createElement('div');
  tip.className = 'gspark-tip';
  tip.style.cssText = [
    'position:absolute',
    'pointer-events:none',
    'z-index:20',
    'display:none',
    'background:rgba(13,19,34,0.94)',
    'border:1px solid rgba(255,255,255,0.14)',
    'border-radius:8px',
    'padding:4px 8px',
    'font-size:11px',
    'line-height:1.35',
    'color:#e8edf6',
    'font-family:Inter,system-ui,sans-serif',
    'box-shadow:0 8px 20px rgba(0,0,0,0.45)',
    'white-space:nowrap',
    'transform:translate(-50%,-100%)',
    'margin-top:-8px',
  ].join(';');

  wrap.append(svg, tip);
  container.append(wrap);

  st = { wrap, svg, tip, lastCfg: null, activeIdx: -1 };
  stateMap.set(container, st);

  const hideTip = () => {
    st.activeIdx = -1;
    st.tip.style.display = 'none';
    if (st.cursorLine) st.cursorLine.style.display = 'none';
    if (st.activeDot) st.activeDot.style.display = 'none';
  };

  wrap.addEventListener('pointermove', (ev) => {
    const cfg = st.lastCfg;
    if (!cfg || !cfg.coords.length) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const rx = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
    const vx = (rx / rect.width) * cfg.vbW;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < cfg.coords.length; i++) {
      const dist = Math.abs(cfg.coords[i].x - vx);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    const pt = cfg.data[best];
    const coord = cfg.coords[best];
    if (!pt || !coord) return;

    if (st.cursorLine) {
      st.cursorLine.setAttribute('x1', coord.x.toFixed(2));
      st.cursorLine.setAttribute('x2', coord.x.toFixed(2));
      st.cursorLine.style.display = '';
    }
    if (st.activeDot) {
      st.activeDot.setAttribute('cx', coord.x.toFixed(2));
      st.activeDot.setAttribute('cy', coord.y.toFixed(2));
      st.activeDot.style.display = '';
    }

    const pxX = (coord.x / cfg.vbW) * rect.width;
    const pxY = (coord.y / cfg.vbH) * rect.height;
    const clampedX = Math.max(54, Math.min(rect.width - 54, pxX));
    st.tip.style.left = `${clampedX}px`;
    st.tip.style.top = `${Math.max(12, pxY)}px`;
    st.tip.style.display = 'block';

    if (st.activeIdx !== best) {
      st.activeIdx = best;
      const lines = cfg.formatTooltip(pt);
      st.tip.textContent = '';
      const row1 = document.createElement('div');
      row1.style.cssText = 'font-weight:700;font-variant-numeric:tabular-nums;';
      row1.textContent = lines[0] || '';
      const row2 = document.createElement('div');
      row2.style.cssText = 'color:#8a97ae;font-variant-numeric:tabular-nums;font-size:10px;';
      row2.textContent = lines[1] || '';
      st.tip.append(row1, row2);
    }
  });

  wrap.addEventListener('pointerleave', hideTip);
  wrap.addEventListener('pointercancel', hideTip);
  return st;
}

function renderAreaSparkline(container, opts) {
  const {
    data,
    valueKey,
    stroke,
    strokeWidth = 2,
    fillTopOpacity = 0.34,
    fillBotOpacity = 0.02,
    refY = 50,
    refStroke = 'rgba(255,255,255,0.14)',
    refDash = '3 3',
    gradId,
    dotRadius = 3.5,
    padX = 4,
    padTop = 5,
    padBot = 3,
    formatTooltip,
  } = opts;

  const st = ensureHost(container);
  const rect = container.getBoundingClientRect();
  const vbW = Math.max(120, Math.round(rect.width || 240));
  const vbH = Math.max(36, Math.round(rect.height || 64));

  const svg = st.svg;
  svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
  svg.textContent = '';

  const plotW = Math.max(10, vbW - padX * 2);
  const plotH = Math.max(10, vbH - padTop - padBot);
  const toY = (val) => {
    const clamped = Math.max(0, Math.min(100, Number(val) || 0));
    return padTop + plotH * (1 - clamped / 100);
  };

  const count = data.length;
  const coords = data.map((d, i) => ({
    x: count <= 1 ? padX + plotW / 2 : padX + (i / (count - 1)) * plotW,
    y: toY(d[valueKey]),
  }));

  const defs = el('defs');
  const grad = el('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(
    el('stop', { offset: '0%', 'stop-color': stroke, 'stop-opacity': fillTopOpacity }),
    el('stop', { offset: '100%', 'stop-color': stroke, 'stop-opacity': fillBotOpacity }),
  );
  defs.append(grad);
  svg.append(defs);

  // Reference baseline
  const ry = toY(refY);
  svg.append(el('line', {
    x1: padX,
    y1: ry.toFixed(2),
    x2: vbW - padX,
    y2: ry.toFixed(2),
    stroke: refStroke,
    'stroke-width': 1,
    'stroke-dasharray': refDash,
  }));

  const lineD = monotonePath(coords);
  const baseY = (padTop + plotH).toFixed(2);
  const areaD = `${lineD}L${coords[coords.length - 1].x.toFixed(2)},${baseY}L${coords[0].x.toFixed(2)},${baseY}Z`;

  svg.append(
    el('path', { d: areaD, fill: `url(#${gradId})`, stroke: 'none' }),
    el('path', {
      d: lineD,
      fill: 'none',
      stroke,
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );

  const cursorLine = el('line', {
    x1: 0,
    y1: padTop,
    x2: 0,
    y2: padTop + plotH,
    stroke: 'rgba(255,255,255,0.22)',
    'stroke-width': 1,
    style: 'display:none;',
  });
  const activeDot = el('circle', {
    cx: 0,
    cy: 0,
    r: dotRadius,
    fill: stroke,
    stroke: '#0f1524',
    'stroke-width': 1.5,
    style: 'display:none;',
  });
  svg.append(cursorLine, activeDot);

  st.cursorLine = cursorLine;
  st.activeDot = activeDot;
  st.activeIdx = -1;
  st.tip.style.display = 'none';
  st.lastCfg = { vbW, vbH, data, coords, formatTooltip };
}

export function renderMoodTrendChart(container, points = [], moodState = 'idle') {
  if (!container) return;
  if (!Array.isArray(points) || !points.length) {
    stateMap.delete(container);
    container.textContent = '';
    const empty = document.createElement('div');
    empty.style.cssText = 'height:100%;display:grid;place-items:center;font-size:10.5px;color:var(--ink-3);letter-spacing:0.01em;';
    empty.textContent = 'Sentiment trend builds as viewers chat';
    container.append(empty);
    return;
  }

  const stroke = MOOD_COLORS[moodState] || MOOD_COLORS.steady;
  const data = points.length === 1
    ? [{ ...points[0], timeLabel: points[0].timeLabel || 'Start' }, { ...points[0], timeLabel: 'Now' }]
    : points;

  renderAreaSparkline(container, {
    data,
    valueKey: 'pct',
    stroke,
    strokeWidth: 2,
    fillTopOpacity: 0.34,
    fillBotOpacity: 0.02,
    refY: 50,
    refStroke: 'rgba(255,255,255,0.14)',
    refDash: '3 3',
    gradId: 'gatherMoodFill',
    dotRadius: 3.5,
    formatTooltip: (pt) => [
      `${pt.pct}% · ${pt.label || 'Steady'}`,
      `${pt.timeLabel || ''}${pt.count ? ` · ${pt.count} msg${pt.count === 1 ? '' : 's'}` : ''}`,
    ],
  });
}

export function renderGuestMicChart(container, samples = [], silentAlert = false, key = 'g') {
  if (!container) return;
  const stroke = silentAlert ? '#f59e0b' : '#34d399';
  const list = Array.isArray(samples) ? samples : [];
  const data = list.length <= 1
    ? [
        { timeLabel: '-10m', level: list[0]?.level ?? 0 },
        { timeLabel: 'Now', level: list[0]?.level ?? 0 },
      ]
    : list;

  const safeId = 'gmGrad_' + String(key || 'g').replace(/[^a-zA-Z0-9_-]/g, '');
  renderAreaSparkline(container, {
    data,
    valueKey: 'level',
    stroke,
    strokeWidth: 1.8,
    fillTopOpacity: 0.38,
    fillBotOpacity: 0.03,
    refY: 15,
    refStroke: 'rgba(148,163,184,0.24)',
    refDash: '2 2',
    gradId: safeId,
    dotRadius: 3,
    padX: 2,
    padTop: 4,
    padBot: 2,
    formatTooltip: (pt) => [
      `${Math.round(pt.level || 0)}% mic activity`,
      pt.timeLabel || '',
    ],
  });
}

if (typeof window !== 'undefined') {
  window.gatherMoodChart = {
    render: renderMoodTrendChart,
    renderGuest: renderGuestMicChart,
  };
}
