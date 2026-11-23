// Stream stats HUD: bitrate, resolution/FPS, latency, loss and uptime.
// Created by watch.js through createStatsHud(app): `app` carries the watch page state and helpers this part uses.
export function createStatsHud(app) {
  const { $, code, W, creds, clockText, toggleKeysPop } = app;
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
    if (app.sess && W.direct.pc) navigator.sendBeacon?.('/api/studio?action=wrtcLeave', new Blob([JSON.stringify({ studio: code, ...creds() })], { type: 'application/json' }));
  });

  return { toggleStatsPop, updateHudUptime, syncHudShell };
}
