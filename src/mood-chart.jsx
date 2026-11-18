import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from 'recharts';

const roots = new WeakMap();

const MOOD_COLORS = {
  idle: '#8a97ae',
  hype: '#34d399',
  warm: '#4fd1a5',
  steady: '#7fa8ff',
  mixed: '#f59e0b',
  tense: '#ff6b7a',
};

function MoodTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;
  return (
    <div
      style={{
        background: 'rgba(13, 19, 34, 0.94)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 8,
        padding: '5px 8px',
        fontSize: 11,
        lineHeight: 1.35,
        color: '#e8edf6',
        fontFamily: 'Inter, system-ui, sans-serif',
        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.45)',
      }}
    >
      <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {pt.pct}% · {pt.label || 'Steady'}
      </div>
      <div style={{ color: '#8a97ae', fontVariantNumeric: 'tabular-nums' }}>
        {pt.timeLabel}
        {pt.count ? ` · ${pt.count} msg${pt.count === 1 ? '' : 's'}` : ''}
      </div>
    </div>
  );
}

function MoodTrendChart({ points = [], moodState = 'idle' }) {
  const stroke = MOOD_COLORS[moodState] || MOOD_COLORS.steady;
  if (!points.length) {
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 10.5,
          color: 'var(--ink-3)',
          letterSpacing: '0.01em',
        }}
      >
        Sentiment trend builds as viewers chat
      </div>
    );
  }

  const data =
    points.length === 1
      ? [
          { ...points[0], timeLabel: points[0].timeLabel || 'Start' },
          { ...points[0], timeLabel: 'Now' },
        ]
      : points;

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 2 }}>
        <defs>
          <linearGradient id="gatherMoodFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.34} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="timeLabel" hide />
        <YAxis domain={[0, 100]} hide />
        <ReferenceLine
          y={50}
          stroke="rgba(255, 255, 255, 0.14)"
          strokeDasharray="3 3"
          ifOverflow="extendDomain"
        />
        <Tooltip
          content={<MoodTooltip />}
          cursor={{ stroke: 'rgba(255, 255, 255, 0.22)', strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="pct"
          stroke={stroke}
          strokeWidth={2}
          fill="url(#gatherMoodFill)"
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3.5, fill: stroke, stroke: '#0f1524', strokeWidth: 1.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function renderMoodTrendChart(container, points, moodState) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<MoodTrendChart points={points} moodState={moodState} />);
}

if (typeof window !== 'undefined') {
  window.gatherMoodChart = { render: renderMoodTrendChart };
}
