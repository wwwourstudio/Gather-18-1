// Smart Highlights Playlist Editor (Drag-and-drop sequencer, combined preview, .webm export & live stream overlay with mixBus audio routing)
// Extracted into a standalone module from studio-tools.js.
import { replaceKids } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('gather:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gather:' + k, JSON.stringify(v)); } catch {} },
};

export function initSmartHighlightsPlaylist(api) {
  const panel = $('#highlightsPanel');
  const headerMeta = $('#hlHeaderMeta');
  const tabBadge = $('#hlTabBadge');
  const previewCanvas = $('#hlPreviewCanvas');
  const previewEmpty = $('#hlPreviewEmpty');
  const monitorHud = $('#hlMonitorHud');
  const hudClip = $('#hlHudClip');
  const hudIdx = $('#hlHudIdx');
  const timeline = $('#hlTimeline');
  const timelineSegs = $('#hlTimelineSegs');
  const playhead = $('#hlPlayhead');
  const prevBtn = $('#hlPrevBtn');
  const playBtn = $('#hlPlayBtn');
  const playLbl = $('#hlPlayLbl');
  const nextBtn = $('#hlNextBtn');
  const loopBtn = $('#hlLoopBtn');
  const muteBtn = $('#hlMuteBtn');
  const timecodeEl = $('#hlTimecode');

  const dropzone = $('#hlDropzone');
  const seqList = $('#hlSeqList');
  const seqEmpty = $('#hlSeqEmpty');
  const seqMeta = $('#hlSeqMeta');
  const addAllBtn = $('#hlAddAllBtn');
  const clearSeqBtn = $('#hlClearSeqBtn');
  const transitionSel = $('#hlTransitionSel');
  const showTitlesChk = $('#hlShowTitlesChk');

  const binList = $('#hlBinList');
  const binCount = $('#hlBinCount');
  const binEmpty = $('#hlBinEmpty');
  const capture30Btn = $('#hlCapture30Btn');
  const importBtn = $('#hlImportBtn');
  const importFile = $('#hlImportFile');

  const overlayModeSel = $('#hlOverlayModeSel');
  const overlayLoopChk = $('#hlOverlayLoopChk');
  const overlayBtn = $('#hlOverlayBtn');
  const overlayStatus = $('#hlOverlayStatus');
  const exportVideoBtn = $('#hlExportVideoBtn');
  const exportJsonBtn = $('#hlExportJsonBtn');
  const exportProg = $('#hlExportProg');
  const exportProgText = $('#hlExportProgText');
  const exportProgBar = $('#hlExportProgBar');
  const exportCancelBtn = $('#hlExportCancelBtn');

  if (!panel || !previewCanvas || !seqList || !binList) return;
  const pCtx = previewCanvas.getContext('2d');

  // Persisted editor settings
  const savedCfg = store.get('hlPlaylistCfg', {});
  const cfg = {
    transition: ['crossfade', 'cut', 'fade'].includes(savedCfg?.transition) ? savedCfg.transition : 'crossfade',
    showTitles: savedCfg?.showTitles !== false,
    overlayMode: ['pip-br', 'pip-bl', 'pip-tr', 'full'].includes(savedCfg?.overlayMode) ? savedCfg.overlayMode : 'pip-br',
    overlayLoop: savedCfg?.overlayLoop !== false,
    loopPreview: !!savedCfg?.loopPreview,
    muted: !!savedCfg?.muted,
  };
  const saveCfg = () => store.set('hlPlaylistCfg', cfg);

  if (transitionSel) transitionSel.value = cfg.transition;
  if (showTitlesChk) showTitlesChk.checked = cfg.showTitles;
  if (overlayModeSel) overlayModeSel.value = cfg.overlayMode;
  if (overlayLoopChk) overlayLoopChk.checked = cfg.overlayLoop;
  if (loopBtn) {
    loopBtn.classList.toggle('on', cfg.loopPreview);
    loopBtn.setAttribute('aria-pressed', String(cfg.loopPreview));
  }
  if (muteBtn) {
    muteBtn.classList.toggle('on', cfg.muted);
    muteBtn.setAttribute('aria-pressed', String(cfg.muted));
  }

  // Local editor clips (captured or imported in this session)
  const localEditorClips = [];
  // Unified available clips map: id -> normalized clip object
  let clipPool = new Map();
  // Ordered playlist sequence: array of { uid, clipId }
  let sequence = [];
  // Cached object URLs and poster thumbnails per clipId
  const blobUrlCache = new Map();
  const thumbCache = new Map();
  const thumbPending = new Set();

  // Restore saved sequence IDs (resolved lazily once clipPool populates)
  const savedSeqIds = Array.isArray(store.get('hlPlaylistSeq', [])) ? store.get('hlPlaylistSeq', []) : [];
  let seqRestored = false;

  const TRANSITION_SEC = 0.4;
  const fmtMMSS = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  };
  const nextUid = () => `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  function getClipObjectUrl(clip) {
    if (!clip?.blob) return '';
    const existing = blobUrlCache.get(clip.id);
    if (existing && existing.blob === clip.blob) return existing.url;
    if (existing?.url) { try { URL.revokeObjectURL(existing.url); } catch {} }
    const url = URL.createObjectURL(clip.blob);
    blobUrlCache.set(clip.id, { blob: clip.blob, url });
    return url;
  }

  function generateThumb(clip) {
    if (!clip || thumbCache.has(clip.id) || thumbPending.has(clip.id)) return;
    if (!clip.blob || !String(clip.blob.type || '').startsWith('video/')) return;
    thumbPending.add(clip.id);
    const url = getClipObjectUrl(clip);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.src = url;
    const cleanup = () => {
      thumbPending.delete(clip.id);
      v.removeAttribute('src');
      v.load();
    };
    const grab = () => {
      try {
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 90;
          const cx = c.getContext('2d');
          const scale = Math.max(160 / v.videoWidth, 90 / v.videoHeight);
          const dw = v.videoWidth * scale;
          const dh = v.videoHeight * scale;
          cx.drawImage(v, (160 - dw) / 2, (90 - dh) / 2, dw, dh);
          thumbCache.set(clip.id, c.toDataURL('image/jpeg', 0.72));
          if (Number.isFinite(v.duration) && v.duration > 0.4 && v.duration < 3600) {
            clip.actualDurationSec = Math.round(v.duration * 10) / 10;
          }
          renderAll();
        }
      } catch {}
      cleanup();
    };
    v.onloadeddata = () => {
      if (v.readyState >= 2) {
        try {
          if (Number.isFinite(v.duration) && v.duration > 0.6) {
            v.currentTime = Math.min(0.4, v.duration * 0.15);
            v.onseeked = grab;
            setTimeout(() => { if (thumbPending.has(clip.id)) grab(); }, 500);
          } else {
            grab();
          }
        } catch { grab(); }
      } else {
        cleanup();
      }
    };
    v.onerror = cleanup;
    setTimeout(() => { if (thumbPending.has(clip.id)) cleanup(); }, 2500);
  }

  /** Collect all generated 30-second clips from rolling buffer, Cloud Clips, Smart Highlights, and local imports. */
  function refreshClipPool() {
    const next = new Map();
    const upsert = (raw) => {
      if (!raw || !raw.id) return;
      const prev = next.get(raw.id);
      const merged = {
        id: String(raw.id),
        title: String(raw.title || prev?.title || '30s Highlight').trim().slice(0, 72),
        speaker: String(raw.speaker || prev?.speaker || '').trim().slice(0, 48),
        snippet: String(raw.snippet || prev?.snippet || '').trim().slice(0, 140),
        source: String(raw.source || prev?.source || '30s Clip'),
        durationSec: Math.max(1, Number(raw.durationSec || prev?.durationSec || 30)),
        actualDurationSec: raw.actualDurationSec || prev?.actualDurationSec || null,
        capturedAt: Number(raw.capturedAt || prev?.capturedAt || Date.now()),
        blob: raw.blob || prev?.blob || null,
        accent: raw.accent || prev?.accent || '',
      };
      next.set(merged.id, merged);
    };

    // 1. Rolling-buffer 30s Mark Clips (clips.js)
    const moments = Array.isArray(window.__gatherClips?.moments) ? window.__gatherClips.moments : [];
    for (const m of moments) {
      if (!m || m.state !== 'ready') continue;
      let blob = null;
      if (Array.isArray(m.blobs) && m.blobs.length) {
        blob = new Blob(m.blobs, { type: m.blobs[0]?.type || 'video/webm' });
      }
      upsert({
        id: `clip_${m.id}`,
        title: m.label || '30s Mark Clip',
        speaker: api.getMyName?.() || 'Stage',
        snippet: 'Captured from the rolling 30-second live studio buffer.',
        source: m.kind === 'ai-agent' ? 'AI Highlight' : 'Mark clip',
        durationSec: m.dur || 30,
        capturedAt: m.ts || Date.now(),
        blob,
      });
    }

    // 2. Cloud Clips (IndexedDB + Drive synced 30s captures)
    const cloud = typeof window.__gatherGetCloudClips === 'function' ? window.__gatherGetCloudClips() : [];
    for (const c of cloud) {
      if (!c?.id) continue;
      upsert({
        id: c.id,
        title: c.label || c.fileName || '30s Cloud Clip',
        speaker: api.getMyName?.() || 'Studio',
        snippet: c.syncStatus === 'synced' ? 'Synced to Google Drive · Cloud Clips.' : 'Saved 30-second highlight clip.',
        source: c.syncStatus === 'synced' ? 'Cloud Clip' : '30s Clip',
        durationSec: c.durationSec || 30,
        capturedAt: c.capturedAt || Date.now(),
        blob: c.blob || null,
      });
    }

    // 3. AI Smart Highlights
    const smart = typeof window.__gatherGetSmartHighlights === 'function' ? window.__gatherGetSmartHighlights() : [];
    for (const h of smart) {
      if (!h?.id || h.clipState === 'capturing') continue;
      const cid = h.clipId ? `clip_${h.clipId}` : h.id;
      upsert({
        id: cid,
        title: h.title || h.speaker || 'Smart Highlight',
        speaker: h.speaker || 'Speaker',
        snippet: h.snippet || 'AI-detected high-engagement moment.',
        source: h.fromAgent ? 'AI Highlight' : 'Highlight',
        durationSec: h.durationSec || 30,
        capturedAt: h.ts || Date.now(),
        blob: h.clipBlob || null,
      });
    }

    // 4. Local editor clips (captured directly here or imported files)
    for (const lc of localEditorClips) upsert(lc);

    clipPool = next;

    // One-time restore of persisted sequence IDs once clips appear
    if (!seqRestored && savedSeqIds.length && clipPool.size) {
      const matched = savedSeqIds
        .filter((id) => clipPool.has(id))
        .map((clipId) => ({ uid: nextUid(), clipId }));
      if (matched.length) sequence = matched;
      seqRestored = true;
    } else if (sequence.length) {
      sequence = sequence.filter((item) => clipPool.has(item.clipId));
    }

    for (const clip of clipPool.values()) generateThumb(clip);
    renderAll();
  }

  function getSequenceClips() {
    return sequence
      .map((item, idx) => {
        const clip = clipPool.get(item.clipId);
        if (!clip) return null;
        return { ...clip, uid: item.uid, seqIndex: idx };
      })
      .filter(Boolean);
  }

  function persistSequence() {
    store.set('hlPlaylistSeq', sequence.map((x) => x.clipId));
  }

  function clipPlaybackDuration(clip) {
    if (!clip) return 5;
    if (Number.isFinite(clip.actualDurationSec) && clip.actualDurationSec > 0.5) return clip.actualDurationSec;
    if (clip.blob) return Math.min(60, Math.max(2, Number(clip.durationSec) || 30));
    // Synthetic broadcast highlight card preview duration (paced cleanly while displaying 30s badge)
    return Math.min(8, Math.max(4, Math.round((Number(clip.durationSec) || 30) / 5)));
  }

  function totalReportedDuration(items) {
    return items.reduce((sum, c) => sum + (Number(c.durationSec) || 30), 0);
  }

  function totalTimelineDuration(items) {
    return items.reduce((sum, c) => sum + clipPlaybackDuration(c), 0);
  }

  // ---- Shared Broadcast Frame Renderer (used by Preview Monitor, WebM Export, and Live Stream Overlay)
  function drawHighlightCardFrame(ctx, w, h, clip, localSec, clipDur, opts = {}) {
    const brandColor = opts.brandColor || api.getBrand?.()?.color || '#3b82f6';
    const font = opts.font || 'Plus Jakarta Sans, system-ui, -apple-system, sans-serif';
    const prog = Math.max(0, Math.min(1, clipDur > 0 ? localSec / clipDur : 0));

    // Rich dark studio gradient backdrop with subtle animated light drift
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0a1020');
    bg.addColorStop(0.55, '#0f172a');
    bg.addColorStop(1, '#131d35');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle radial spotlight tied to brand color & playback progress
    const rx = w * (0.25 + 0.5 * prog);
    const ry = h * 0.28;
    const rad = ctx.createRadialGradient(rx, ry, 10, rx, ry, w * 0.62);
    rad.addColorStop(0, `${brandColor}38`);
    rad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, w, h);

    // Subtle top hairline bar
    ctx.fillStyle = brandColor;
    ctx.fillRect(0, 0, w * prog, Math.max(3, Math.round(h * 0.008)));

    const padX = Math.round(w * 0.075);
    const topY = Math.round(h * 0.22);

    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 ${Math.max(11, Math.round(h * 0.042))}px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const metaStr = `${clip.source || '30s Highlight'}  ·  ${clip.durationSec || 30}s`;
    ctx.fillText(metaStr, padX, topY);

    ctx.fillStyle = '#f8fafc';
    ctx.font = `700 ${Math.max(18, Math.round(h * 0.088))}px ${font}`;
    const title = String(clip.title || 'Smart Highlight').slice(0, 44);
    ctx.fillText(title, padX, topY + Math.round(h * 0.08));

    if (clip.snippet) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = `400 ${Math.max(12, Math.round(h * 0.048))}px ${font}`;
      const words = String(clip.snippet).split(/\s+/);
      let line = '';
      let y = topY + Math.round(h * 0.23);
      const maxW = w - padX * 2;
      const lh = Math.round(h * 0.072);
      for (const word of words) {
        const cand = line ? `${line} ${word}` : word;
        if (ctx.measureText(cand).width > maxW && line) {
          ctx.fillText(line, padX, y);
          line = word;
          y += lh;
          if (y > h * 0.72) break;
        } else {
          line = cand;
        }
      }
      if (line && y <= h * 0.72) ctx.fillText(line, padX, y);
    }

    if (clip.speaker) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `600 ${Math.max(11, Math.round(h * 0.042))}px ${font}`;
      ctx.fillText(clip.speaker, padX, Math.round(h * 0.79));
    }
  }

  function drawVideoCover(ctx, video, x, y, w, h) {
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function drawTitleLowerThird(ctx, x, y, w, h, clip, seqIdx, totalCount, localSec, clipDur, opts = {}) {
    const brandColor = opts.brandColor || api.getBrand?.()?.color || '#3b82f6';
    const font = opts.font || 'Plus Jakarta Sans, system-ui, -apple-system, sans-serif';
    const scrimH = Math.round(h * 0.34);
    const grad = ctx.createLinearGradient(0, y + h - scrimH, 0, y + h);
    grad.addColorStop(0, 'rgba(2, 6, 23, 0)');
    grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.72)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0.92)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + h - scrimH, w, scrimH);

    const padX = Math.max(10, Math.round(w * 0.035));
    const padB = Math.max(12, Math.round(h * 0.065));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    const titleSz = Math.max(12, Math.round(h * 0.056));
    const metaSz = Math.max(10, Math.round(h * 0.038));

    ctx.fillStyle = '#94a3b8';
    ctx.font = `600 ${metaSz}px ${font}`;
    const idxLabel = `HIGHLIGHT ${seqIdx + 1}/${totalCount}  ·  ${clip.durationSec || 30}s`;
    ctx.fillText(idxLabel, x + padX, y + h - padB - titleSz - 4);

    ctx.fillStyle = '#f8fafc';
    ctx.font = `700 ${titleSz}px ${font}`;
    let title = String(clip.title || 'Highlight');
    const maxW = w - padX * 2;
    while (title.length > 4 && ctx.measureText(title).width > maxW) title = title.slice(0, -2) + '…';
    ctx.fillText(title, x + padX, y + h - padB);

    // Slim progress bar at very bottom
    const barH = Math.max(3, Math.round(h * 0.012));
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(x, y + h - barH, w, barH);
    const prog = Math.max(0, Math.min(1, clipDur > 0 ? localSec / clipDur : 0));
    ctx.fillStyle = brandColor;
    ctx.fillRect(x, y + h - barH, w * prog, barH);
  }

  // ---- Combined Preview Playback State
  const previewVideo = document.createElement('video');
  previewVideo.playsInline = true;
  previewVideo.preload = 'auto';
  previewVideo.muted = cfg.muted;

  const prevSnapCanvas = document.createElement('canvas');
  prevSnapCanvas.width = 640;
  prevSnapCanvas.height = 360;
  const prevSnapCtx = prevSnapCanvas.getContext('2d');

  const preview = {
    playing: false,
    clipIdx: 0,
    localSec: 0,
    lastFrameMs: 0,
    transitionAlpha: 0,
    transitionType: 'cut',
    hasVideoSrc: false,
    loadedClipId: '',
    rafId: 0,
  };

  function capturePrevSnap() {
    try {
      prevSnapCtx.clearRect(0, 0, 640, 360);
      prevSnapCtx.drawImage(previewCanvas, 0, 0, 640, 360);
    } catch {}
  }

  function loadPreviewClip(idx, startOffset = 0, withTransition = false) {
    const items = getSequenceClips();
    if (!items.length) {
      stopPreview();
      drawIdlePreview();
      return;
    }
    const clampedIdx = Math.max(0, Math.min(items.length - 1, idx));
    const clip = items[clampedIdx];
    if (withTransition && cfg.transition !== 'cut') {
      capturePrevSnap();
      preview.transitionAlpha = 1;
      preview.transitionType = cfg.transition;
    } else {
      preview.transitionAlpha = 0;
    }

    preview.clipIdx = clampedIdx;
    preview.localSec = Math.max(0, startOffset);
    preview.lastFrameMs = performance.now();
    preview.loadedClipId = clip.id;

    if (clip.blob && String(clip.blob.type || '').startsWith('video/')) {
      const url = getClipObjectUrl(clip);
      if (previewVideo.src !== url) {
        previewVideo.src = url;
        previewVideo.load();
      }
      preview.hasVideoSrc = true;
      previewVideo.muted = cfg.muted;
      try { previewVideo.currentTime = Math.max(0, startOffset); } catch {}
      if (preview.playing) {
        previewVideo.play().catch(() => {});
      }
    } else {
      preview.hasVideoSrc = false;
      previewVideo.pause();
      previewVideo.removeAttribute('src');
    }

    syncPreviewChrome();
    drawPreviewFrame();
  }

  function drawIdlePreview() {
    pCtx.fillStyle = '#090f1d';
    pCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    if (previewEmpty) previewEmpty.hidden = false;
    if (monitorHud) monitorHud.hidden = true;
    if (playhead) playhead.style.left = '0%';
    if (timecodeEl) timecodeEl.textContent = '00:00 / 00:00';
  }

  function drawPreviewFrame() {
    const items = getSequenceClips();
    if (!items.length) return drawIdlePreview();
    const clip = items[preview.clipIdx] || items[0];
    if (!clip) return drawIdlePreview();

    if (previewEmpty) previewEmpty.hidden = true;
    const w = previewCanvas.width;
    const h = previewCanvas.height;
    const clipDur = clipPlaybackDuration(clip);

    pCtx.save();
    if (preview.hasVideoSrc && previewVideo.readyState >= 2 && previewVideo.videoWidth > 0) {
      pCtx.fillStyle = '#050812';
      pCtx.fillRect(0, 0, w, h);
      drawVideoCover(pCtx, previewVideo, 0, 0, w, h);
    } else {
      drawHighlightCardFrame(pCtx, w, h, clip, preview.localSec, clipDur);
    }

    // Apply transition between clips
    if (preview.transitionAlpha > 0.005) {
      if (preview.transitionType === 'crossfade') {
        pCtx.save();
        pCtx.globalAlpha = preview.transitionAlpha;
        pCtx.drawImage(prevSnapCanvas, 0, 0, w, h);
        pCtx.restore();
      } else if (preview.transitionType === 'fade') {
        pCtx.save();
        pCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, preview.transitionAlpha * 1.15)})`;
        pCtx.fillRect(0, 0, w, h);
        pCtx.restore();
      }
    }

    if (cfg.showTitles) {
      drawTitleLowerThird(pCtx, 0, 0, w, h, clip, preview.clipIdx, items.length, preview.localSec, clipDur);
    }
    pCtx.restore();

    if (monitorHud && hudClip && hudIdx) {
      monitorHud.hidden = false;
      hudClip.textContent = clip.title;
      hudIdx.textContent = `${preview.clipIdx + 1} / ${items.length}`;
    }

    // Update timeline playhead & timecode
    const totalDur = totalTimelineDuration(items);
    let elapsed = preview.localSec;
    for (let i = 0; i < preview.clipIdx; i++) elapsed += clipPlaybackDuration(items[i]);
    const pct = totalDur > 0 ? Math.max(0, Math.min(100, (elapsed / totalDur) * 100)) : 0;
    if (playhead) playhead.style.left = `${pct}%`;
    if (timeline) timeline.setAttribute('aria-valuenow', String(Math.round(pct)));
    if (timecodeEl) timecodeEl.textContent = `${fmtMMSS(elapsed)} / ${fmtMMSS(totalDur)}`;

    // Highlight active segment & sequence row
    $$('.hl-tl-seg', timelineSegs).forEach((seg, i) => seg.classList.toggle('is-active', i === preview.clipIdx));
    $$('.hl-seq-item', seqList).forEach((row, i) => row.classList.toggle('is-playing', i === preview.clipIdx && preview.playing));
  }

  function tickPreview(now) {
    if (!preview.playing) return;
    const items = getSequenceClips();
    if (!items.length) {
      stopPreview();
      return;
    }
    const dt = Math.min(0.12, Math.max(0, (now - preview.lastFrameMs) / 1000));
    preview.lastFrameMs = now;

    if (preview.transitionAlpha > 0) {
      preview.transitionAlpha = Math.max(0, preview.transitionAlpha - dt / TRANSITION_SEC);
    }

    const clip = items[preview.clipIdx];
    const clipDur = clipPlaybackDuration(clip);

    if (preview.hasVideoSrc && previewVideo.readyState >= 2 && !previewVideo.paused) {
      preview.localSec = previewVideo.currentTime || (preview.localSec + dt);
      if (Number.isFinite(previewVideo.duration) && previewVideo.duration > 0.5) {
        clip.actualDurationSec = Math.round(previewVideo.duration * 10) / 10;
      }
    } else {
      preview.localSec += dt;
    }

    const reachedEnd = (preview.hasVideoSrc && previewVideo.ended) || preview.localSec >= clipDur;
    if (reachedEnd) {
      if (preview.clipIdx + 1 < items.length) {
        loadPreviewClip(preview.clipIdx + 1, 0, true);
      } else if (cfg.loopPreview) {
        loadPreviewClip(0, 0, true);
      } else {
        preview.playing = false;
        preview.localSec = clipDur;
        previewVideo.pause();
        syncPreviewChrome();
        drawPreviewFrame();
        return;
      }
    } else {
      drawPreviewFrame();
    }

    preview.rafId = requestAnimationFrame(tickPreview);
  }

  function startPreview(fromIdx = null) {
    const items = getSequenceClips();
    if (!items.length) return;
    if (fromIdx !== null) {
      preview.playing = true;
      loadPreviewClip(fromIdx, 0, false);
    } else {
      const curClip = items[preview.clipIdx];
      const atEnd = preview.clipIdx >= items.length - 1 && preview.localSec >= clipPlaybackDuration(curClip) - 0.08;
      preview.playing = true;
      if (atEnd || preview.loadedClipId !== curClip?.id) {
        loadPreviewClip(atEnd ? 0 : preview.clipIdx, atEnd ? 0 : preview.localSec, false);
      } else if (preview.hasVideoSrc) {
        previewVideo.muted = cfg.muted;
        previewVideo.play().catch(() => {});
      }
    }
    preview.lastFrameMs = performance.now();
    syncPreviewChrome();
    cancelAnimationFrame(preview.rafId);
    preview.rafId = requestAnimationFrame(tickPreview);
  }

  function stopPreview() {
    preview.playing = false;
    cancelAnimationFrame(preview.rafId);
    previewVideo.pause();
    syncPreviewChrome();
    drawPreviewFrame();
  }

  function syncPreviewChrome() {
    const hasClips = getSequenceClips().length > 0;
    if (playBtn) playBtn.disabled = !hasClips;
    if (prevBtn) prevBtn.disabled = !hasClips;
    if (nextBtn) nextBtn.disabled = !hasClips;
    if (playLbl) playLbl.textContent = preview.playing ? 'Pause' : 'Preview';
    const playIcon = playBtn?.querySelector('use');
    if (playIcon) playIcon.setAttribute('href', preview.playing ? '/icons.svg#i-pause' : '/icons.svg#i-play');
    const muteIcon = muteBtn?.querySelector('use');
    if (muteIcon) muteIcon.setAttribute('href', cfg.muted ? '/icons.svg#i-volume-x' : '/icons.svg#i-volume-2');
  }

  function seekTimelineNormalized(norm) {
    const items = getSequenceClips();
    if (!items.length) return;
    const total = totalTimelineDuration(items);
    const target = Math.max(0, Math.min(total, norm * total));
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      const dur = clipPlaybackDuration(items[i]);
      if (target <= acc + dur || i === items.length - 1) {
        loadPreviewClip(i, Math.max(0, target - acc), false);
        break;
      }
      acc += dur;
    }
  }

  // ---- Sequence Mutations
  function insertClipAt(clipId, index = sequence.length) {
    if (!clipPool.has(clipId)) return false;
    const pos = Math.max(0, Math.min(sequence.length, index));
    sequence.splice(pos, 0, { uid: nextUid(), clipId });
    persistSequence();
    renderAll();
    if (sequence.length === 1) loadPreviewClip(0, 0, false);
    return true;
  }

  function reorderSequence(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= sequence.length) return false;
    let target = Math.max(0, Math.min(sequence.length, toIdx));
    if (fromIdx === target || fromIdx + 1 === target) return false;
    const [moved] = sequence.splice(fromIdx, 1);
    if (fromIdx < target) target--;
    sequence.splice(target, 0, moved);
    persistSequence();
    renderAll();
    if (!preview.playing) loadPreviewClip(Math.min(preview.clipIdx, sequence.length - 1), 0, false);
    return true;
  }

  function removeSequenceAt(idx) {
    if (idx < 0 || idx >= sequence.length) return;
    sequence.splice(idx, 1);
    persistSequence();
    if (!sequence.length) {
      stopPreview();
      if (overlayRun.active) stopStreamOverlay();
    } else if (preview.clipIdx >= sequence.length) {
      preview.clipIdx = sequence.length - 1;
    }
    renderAll();
    if (sequence.length && !preview.playing) loadPreviewClip(preview.clipIdx, 0, false);
  }

  // ---- Drag & Drop State
  let dragState = null; // { kind: 'bin' | 'seq', clipId?, fromIdx? }

  function clearDropIndicators() {
    dropzone?.classList.remove('is-dragover');
    $$('.hl-seq-item', seqList).forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  function computeDropIndex(clientY) {
    const rows = [...seqList.querySelectorAll('.hl-seq-item')];
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return { index: i, row: rows[i], pos: 'before' };
    }
    return { index: rows.length, row: rows[rows.length - 1] || null, pos: 'after' };
  }

  function handleDropzoneDragOver(e) {
    const types = e.dataTransfer?.types || [];
    if (!dragState && !types.includes('text/x-gather-clip') && !types.includes('text/plain')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = dragState?.kind === 'seq' ? 'move' : 'copy';
    clearDropIndicators();
    dropzone?.classList.add('is-dragover');
    const hit = computeDropIndex(e.clientY);
    if (hit.row) hit.row.classList.add(hit.pos === 'before' ? 'drop-before' : 'drop-after');
  }

  function handleDropzoneDrop(e) {
    e.preventDefault();
    const hit = computeDropIndex(e.clientY);
    let state = dragState;
    if (!state && e.dataTransfer) {
      const raw = e.dataTransfer.getData('text/x-gather-clip') || e.dataTransfer.getData('text/plain');
      if (raw) {
        try { state = JSON.parse(raw); } catch { state = { kind: 'bin', clipId: raw }; }
      }
    }
    clearDropIndicators();
    dragState = null;
    if (!state) return;

    if (state.kind === 'seq' && Number.isInteger(state.fromIdx)) {
      reorderSequence(state.fromIdx, hit.index);
    } else if (state.clipId && clipPool.has(state.clipId)) {
      insertClipAt(state.clipId, hit.index);
      const clip = clipPool.get(state.clipId);
      api.toast?.(`Added “${clip?.title || 'Clip'}” to Smart Highlights playlist.`, { ms: 2200 });
    }
  }

  dropzone?.addEventListener('dragover', handleDropzoneDragOver);
  dropzone?.addEventListener('dragleave', (e) => {
    if (!dropzone.contains(e.relatedTarget)) clearDropIndicators();
  });
  dropzone?.addEventListener('drop', handleDropzoneDrop);

  // ---- Live Stream Overlay Compositor (renders sequenced playlist onto Gather's live stage canvas
  //      and routes clip audio into the studio's WebRTC mixBus + recording bus)
  const overlayVideo = document.createElement('video');
  overlayVideo.playsInline = true;
  overlayVideo.muted = false;
  overlayVideo.preload = 'auto';
  overlayVideo.crossOrigin = 'anonymous';
  let overlayAudioHandle = null;

  function ensureOverlayAudioMix() {
    if (overlayAudioHandle?.isRouted?.()) return overlayAudioHandle;
    if (typeof api.connectMediaElementAudio === 'function') {
      overlayAudioHandle = api.connectMediaElementAudio(overlayVideo, { duck: false, monitor: true, volume: 1 });
    }
    return overlayAudioHandle;
  }

  function releaseOverlayAudioMix() {
    if (!overlayAudioHandle) return;
    try { overlayAudioHandle.dispose(); } catch {}
    overlayAudioHandle = null;
  }

  const overlaySnap = document.createElement('canvas');
  overlaySnap.width = 640;
  overlaySnap.height = 360;
  const overlaySnapCtx = overlaySnap.getContext('2d');

  const overlayRun = {
    active: false,
    clipIdx: 0,
    localSec: 0,
    lastWallMs: 0,
    transitionAlpha: 0,
    hasVideoSrc: false,
    audioRouted: false,
    clips: [],
  };

  function loadOverlayClip(idx, withTransition = false) {
    if (!overlayRun.clips.length) {
      stopStreamOverlay();
      return;
    }
    const clamped = Math.max(0, Math.min(overlayRun.clips.length - 1, idx));
    const clip = overlayRun.clips[clamped];
    if (withTransition && cfg.transition !== 'cut') {
      overlayRun.transitionAlpha = 1;
    } else {
      overlayRun.transitionAlpha = 0;
    }
    overlayRun.clipIdx = clamped;
    overlayRun.localSec = 0;
    overlayRun.lastWallMs = Date.now();

    if (clip.blob && String(clip.blob.type || '').startsWith('video/')) {
      const url = getClipObjectUrl(clip);
      const handle = ensureOverlayAudioMix();
      overlayRun.audioRouted = !!handle?.isRouted?.();
      overlayVideo.src = url;
      overlayVideo.currentTime = 0;
      overlayVideo.muted = false;
      overlayRun.hasVideoSrc = true;
      overlayVideo.play().catch(() => {
        overlayVideo.muted = true;
        overlayVideo.play().catch(() => {});
      });
    } else {
      overlayRun.hasVideoSrc = false;
      overlayVideo.pause();
      overlayVideo.removeAttribute('src');
    }
  }

  function startStreamOverlay() {
    const items = getSequenceClips();
    if (!items.length) {
      api.toast?.('Add at least one clip to the playlist before sending to stream overlay.', { err: true });
      return false;
    }
    overlayRun.clips = items.slice();
    overlayRun.active = true;
    const handle = ensureOverlayAudioMix();
    overlayRun.audioRouted = !!handle?.isRouted?.();
    loadOverlayClip(0, false);
    renderOverlayChrome();
    api.requestStageRender?.();
    api.toast?.(`Smart Highlights reel live on stream overlay (${items.length} clip${items.length === 1 ? '' : 's'}).`);
    return true;
  }

  function stopStreamOverlay(silent = false) {
    overlayRun.active = false;
    overlayRun.clips = [];
    overlayRun.audioRouted = false;
    overlayVideo.pause();
    overlayVideo.removeAttribute('src');
    releaseOverlayAudioMix();
    renderOverlayChrome();
    api.requestStageRender?.();
    if (!silent) api.toast?.('Smart Highlights stream overlay stopped.');
  }

  function renderOverlayChrome() {
    const hasClips = getSequenceClips().length > 0;
    if (overlayBtn) {
      overlayBtn.disabled = !hasClips && !overlayRun.active;
      overlayBtn.textContent = overlayRun.active ? 'Stop stream overlay' : 'Send to stream overlay';
      overlayBtn.classList.toggle('danger', overlayRun.active);
      overlayBtn.classList.toggle('primary', !overlayRun.active);
    }
    if (overlayStatus) {
      if (overlayRun.active) {
        const idx = Math.min(overlayRun.clipIdx + 1, overlayRun.clips.length || 1);
        overlayStatus.dataset.state = 'live';
        overlayStatus.textContent = `On stream · Clip ${idx}/${overlayRun.clips.length}`;
      } else {
        overlayStatus.dataset.state = 'idle';
        overlayStatus.textContent = hasClips ? 'Ready' : 'Add clips';
      }
    }
  }

  window.__gatherDrawHighlightOverlay = (g, W, H, brand, font, wall) => {
    if (!overlayRun.active || !overlayRun.clips.length) return;
    const now = wall || Date.now();
    const dt = Math.min(0.12, Math.max(0, (now - (overlayRun.lastWallMs || now)) / 1000));
    overlayRun.lastWallMs = now;

    if (overlayRun.transitionAlpha > 0) {
      overlayRun.transitionAlpha = Math.max(0, overlayRun.transitionAlpha - dt / TRANSITION_SEC);
    }

    const clip = overlayRun.clips[overlayRun.clipIdx];
    if (!clip) { stopStreamOverlay(true); return; }
    const clipDur = clipPlaybackDuration(clip);

    if (overlayRun.hasVideoSrc && overlayVideo.readyState >= 2 && !overlayVideo.paused) {
      overlayRun.localSec = overlayVideo.currentTime || (overlayRun.localSec + dt);
    } else {
      overlayRun.localSec += dt;
    }

    const done = (overlayRun.hasVideoSrc && overlayVideo.ended) || overlayRun.localSec >= clipDur;
    if (done) {
      if (overlayRun.clipIdx + 1 < overlayRun.clips.length) {
        loadOverlayClip(overlayRun.clipIdx + 1, true);
        renderOverlayChrome();
      } else if (cfg.overlayLoop) {
        loadOverlayClip(0, true);
        renderOverlayChrome();
      } else {
        stopStreamOverlay(true);
        api.toast?.('Smart Highlights stream overlay finished.');
        return;
      }
    }

    const activeClip = overlayRun.clips[overlayRun.clipIdx] || clip;
    const activeDur = clipPlaybackDuration(activeClip);

    // Compute overlay frame rect on the live program canvas
    let rx = 0, ry = 0, rw = W, rh = H, radius = 0;
    if (cfg.overlayMode !== 'full') {
      rw = Math.round(W * 0.34);
      rh = Math.round(rw * (9 / 16));
      const pad = Math.round(W * 0.025);
      radius = 12;
      if (cfg.overlayMode === 'pip-bl') { rx = pad; ry = H - rh - pad; }
      else if (cfg.overlayMode === 'pip-tr') { rx = W - rw - pad; ry = pad; }
      else { rx = W - rw - pad; ry = H - rh - pad; }
    }

    g.save();
    if (radius > 0) {
      g.shadowColor = 'rgba(0, 0, 0, 0.55)';
      g.shadowBlur = 24;
      g.shadowOffsetY = 8;
      g.beginPath();
      g.roundRect(rx, ry, rw, rh, radius);
      g.fillStyle = '#070b14';
      g.fill();
      g.shadowColor = 'transparent';
      g.clip();
    }

    if (overlayRun.hasVideoSrc && overlayVideo.readyState >= 2 && overlayVideo.videoWidth > 0) {
      drawVideoCover(g, overlayVideo, rx, ry, rw, rh);
    } else {
      g.save();
      g.translate(rx, ry);
      drawHighlightCardFrame(g, rw, rh, activeClip, overlayRun.localSec, activeDur, { brandColor: brand?.color, font });
      g.restore();
    }

    if (overlayRun.transitionAlpha > 0.01 && cfg.transition === 'fade') {
      g.fillStyle = `rgba(0, 0, 0, ${Math.min(1, overlayRun.transitionAlpha)})`;
      g.fillRect(rx, ry, rw, rh);
    }

    if (cfg.showTitles) {
      drawTitleLowerThird(g, rx, ry, rw, rh, activeClip, overlayRun.clipIdx, overlayRun.clips.length, overlayRun.localSec, activeDur, { brandColor: brand?.color, font });
    }
    g.restore();

    if (radius > 0) {
      g.save();
      g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(rx + 0.75, ry + 0.75, rw - 1.5, rh - 1.5, radius);
      g.stroke();
      g.restore();
    }
  };

  // ---- Export Combined Playlist to File (.webm video & .json manifest)
  let exportCancelled = false;
  let exporting = false;

  function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }

  function exportPlaylistJson() {
    const items = getSequenceClips();
    if (!items.length) return null;
    const payload = {
      type: 'gather-smart-highlights-playlist',
      version: 1,
      exportedAt: new Date().toISOString(),
      transition: cfg.transition,
      showTitles: cfg.showTitles,
      overlayMode: cfg.overlayMode,
      totalDurationSec: totalReportedDuration(items),
      clips: items.map((c, idx) => ({
        order: idx + 1,
        id: c.id,
        title: c.title,
        speaker: c.speaker,
        snippet: c.snippet,
        source: c.source,
        durationSec: c.durationSec,
        capturedAt: c.capturedAt,
      })),
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `smart-highlights-playlist-${stamp}.json`);
    api.toast?.(`Exported Smart Highlights playlist JSON (${items.length} clips).`);
    return payload;
  }

  async function exportPlaylistWebm({ maxCardSec = 2.4 } = {}) {
    const items = getSequenceClips();
    if (!items.length || exporting) return null;
    if (!window.MediaRecorder) {
      api.toast?.('Video export requires MediaRecorder support in this browser.', { err: true });
      return null;
    }

    const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      api.toast?.('No supported WebM encoder found in this browser.', { err: true });
      return null;
    }

    exporting = true;
    exportCancelled = false;
    if (exportProg) exportProg.hidden = false;
    if (exportProgBar) exportProgBar.style.width = '0%';
    if (exportVideoBtn) exportVideoBtn.disabled = true;

    const exCanvas = document.createElement('canvas');
    exCanvas.width = 1280;
    exCanvas.height = 720;
    const exCtx = exCanvas.getContext('2d');

    const exSnap = document.createElement('canvas');
    exSnap.width = 1280;
    exSnap.height = 720;
    const exSnapCtx = exSnap.getContext('2d');

    const exVideo = document.createElement('video');
    exVideo.playsInline = true;
    exVideo.muted = true;
    exVideo.preload = 'auto';

    let ac = null;
    let stream = null;
    try {
      const videoStream = exCanvas.captureStream(30);
      const tracks = [...videoStream.getVideoTracks()];
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          ac = new AC();
          const dest = ac.createMediaStreamDestination();
          const srcNode = ac.createMediaElementSource(exVideo);
          srcNode.connect(dest);
          exVideo.muted = false;
          tracks.push(...dest.stream.getAudioTracks());
        }
      } catch {
        exVideo.muted = true;
      }
      stream = new MediaStream(tracks);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_800_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const stopped = new Promise((resolve) => { rec.onstop = resolve; });
      rec.start(250);

      const perClipDur = items.map((c) => {
        if (c.blob && String(c.blob.type || '').startsWith('video/')) {
          return Math.min(35, Math.max(1.2, clipPlaybackDuration(c)));
        }
        return maxCardSec;
      });
      const totalRenderSec = perClipDur.reduce((a, b) => a + b, 0) || 1;
      let completedSec = 0;

      for (let i = 0; i < items.length; i++) {
        if (exportCancelled) break;
        const clip = items[i];
        const targetDur = perClipDur[i];
        let hasVid = false;

        if (i > 0 && cfg.transition !== 'cut') {
          exSnapCtx.clearRect(0, 0, 1280, 720);
          exSnapCtx.drawImage(exCanvas, 0, 0, 1280, 720);
        }

        if (clip.blob && String(clip.blob.type || '').startsWith('video/')) {
          const url = getClipObjectUrl(clip);
          exVideo.src = url;
          exVideo.currentTime = 0;
          hasVid = await new Promise((resolve) => {
            const done = (ok) => { exVideo.onloadeddata = null; exVideo.onerror = null; resolve(ok); };
            exVideo.onloadeddata = () => done(true);
            exVideo.onerror = () => done(false);
            setTimeout(() => done(exVideo.readyState >= 2), 1800);
          });
          if (hasVid) {
            await exVideo.play().catch(() => { exVideo.muted = true; return exVideo.play().catch(() => {}); });
          }
        }

        const clipStart = performance.now();
        await new Promise((resolve) => {
          function step(now) {
            if (exportCancelled) { resolve(); return; }
            const elapsed = hasVid && exVideo.readyState >= 2 && !exVideo.paused
              ? (exVideo.currentTime || (now - clipStart) / 1000)
              : (now - clipStart) / 1000;

            if (hasVid && exVideo.readyState >= 2 && exVideo.videoWidth > 0) {
              exCtx.fillStyle = '#050812';
              exCtx.fillRect(0, 0, 1280, 720);
              drawVideoCover(exCtx, exVideo, 0, 0, 1280, 720);
            } else {
              drawHighlightCardFrame(exCtx, 1280, 720, clip, elapsed, targetDur);
            }

            if (i > 0 && cfg.transition !== 'cut' && elapsed < TRANSITION_SEC) {
              const a = Math.max(0, 1 - elapsed / TRANSITION_SEC);
              if (cfg.transition === 'crossfade') {
                exCtx.save();
                exCtx.globalAlpha = a;
                exCtx.drawImage(exSnap, 0, 0, 1280, 720);
                exCtx.restore();
              } else if (cfg.transition === 'fade') {
                exCtx.fillStyle = `rgba(0, 0, 0, ${a})`;
                exCtx.fillRect(0, 0, 1280, 720);
              }
            }

            if (cfg.showTitles) {
              drawTitleLowerThird(exCtx, 0, 0, 1280, 720, clip, i, items.length, elapsed, targetDur);
            }

            const pct = Math.min(99, Math.round(((completedSec + Math.min(elapsed, targetDur)) / totalRenderSec) * 100));
            if (exportProgBar) exportProgBar.style.width = `${pct}%`;
            if (exportProgText) exportProgText.textContent = `Rendering clip ${i + 1} of ${items.length} · ${pct}%`;

            if ((hasVid && exVideo.ended) || elapsed >= targetDur) {
              resolve();
            } else {
              requestAnimationFrame(step);
            }
          }
          requestAnimationFrame(step);
        });

        exVideo.pause();
        completedSec += targetDur;
      }

      if (rec.state !== 'inactive') rec.stop();
      await stopped;

      if (exportCancelled) {
        api.toast?.('Playlist video export cancelled.');
        return null;
      }

      const outBlob = new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
      if (exportProgBar) exportProgBar.style.width = '100%';
      if (exportProgText) exportProgText.textContent = 'Export complete';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      triggerDownload(outBlob, `smart-highlights-reel-${stamp}.webm`);
      api.toast?.(`Exported Smart Highlights reel (${items.length} clip${items.length === 1 ? '' : 's'}).`);
      return outBlob;
    } catch (err) {
      api.toast?.(err?.message || 'Could not export combined highlight video.', { err: true });
      return null;
    } finally {
      exVideo.pause();
      exVideo.removeAttribute('src');
      stream?.getTracks().forEach((t) => t.stop());
      if (ac) ac.close().catch(() => {});
      exporting = false;
      setTimeout(() => { if (exportProg && !exporting) exportProg.hidden = true; }, 900);
      renderAll();
    }
  }

  // ---- UI Rendering
  function renderAll() {
    const seqClips = getSequenceClips();
    const binClips = [...clipPool.values()].sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    const totalSec = totalReportedDuration(seqClips);

    if (headerMeta) headerMeta.textContent = `${seqClips.length} clip${seqClips.length === 1 ? '' : 's'} · ${fmtMMSS(totalSec)}`;
    if (tabBadge) {
      const n = seqClips.length || binClips.length;
      tabBadge.textContent = String(n);
      tabBadge.hidden = n === 0;
    }
    if (seqMeta) {
      seqMeta.textContent = seqClips.length
        ? `${seqClips.length} in reel · ${fmtMMSS(totalSec)}`
        : 'Drag to reorder';
    }
    if (seqEmpty) seqEmpty.hidden = seqClips.length > 0;
    if (clearSeqBtn) clearSeqBtn.disabled = seqClips.length === 0;
    if (addAllBtn) addAllBtn.disabled = binClips.length === 0;
    if (exportVideoBtn) exportVideoBtn.disabled = seqClips.length === 0 || exporting;
    if (exportJsonBtn) exportJsonBtn.disabled = seqClips.length === 0;

    // Proportional timeline segments
    if (timelineSegs) {
      const tlTotal = totalTimelineDuration(seqClips) || 1;
      replaceKids(timelineSegs, ...seqClips.map((c, idx) => {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'hl-tl-seg' + (idx === preview.clipIdx ? ' is-active' : '');
        seg.style.flexGrow = String(Math.max(1, clipPlaybackDuration(c)));
        seg.title = `${idx + 1}. ${c.title} (${c.durationSec}s)`;
        seg.setAttribute('aria-label', `Jump to clip ${idx + 1}: ${c.title}`);
        seg.onclick = (ev) => {
          ev.stopPropagation();
          loadPreviewClip(idx, 0, false);
        };
        return seg;
      }));
    }

    // Playlist sequence list
    replaceKids(seqList, ...seqClips.map((c, idx) => {
      const li = document.createElement('li');
      li.className = 'hl-seq-item' + (idx === preview.clipIdx && preview.playing ? ' is-playing' : '');
      li.draggable = true;
      li.dataset.seqIdx = String(idx);
      li.dataset.clipId = c.id;

      const thumbUrl = thumbCache.get(c.id);
      li.innerHTML = `
        <span class="hl-grip" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
        <span class="hl-seq-num num"></span>
        <div class="hl-thumb"></div>
        <button type="button" class="hl-seq-info">
          <b class="hl-item-title"></b>
          <span class="hl-item-meta num"></span>
        </button>
        <div class="hl-seq-acts">
          <button type="button" class="icon-btn sm hl-mv-up" aria-label="Move clip up"><svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-arrow-up"/></svg></button>
          <button type="button" class="icon-btn sm hl-mv-dn" aria-label="Move clip down"><svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-arrow-down"/></svg></button>
          <button type="button" class="icon-btn sm hl-rm" aria-label="Remove from playlist"><svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-x"/></svg></button>
        </div>
      `;

      $('.hl-seq-num', li).textContent = String(idx + 1).padStart(2, '0');
      const thumbEl = $('.hl-thumb', li);
      if (thumbUrl) {
        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = '';
        thumbEl.append(img);
      } else {
        thumbEl.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-video"/></svg>';
      }
      $('.hl-item-title', li).textContent = c.title;
      $('.hl-item-meta', li).textContent = `${c.durationSec}s · ${c.source}`;

      $('.hl-seq-info', li).onclick = () => startPreview(idx);
      const upBtn = $('.hl-mv-up', li);
      const dnBtn = $('.hl-mv-dn', li);
      upBtn.disabled = idx === 0;
      dnBtn.disabled = idx === seqClips.length - 1;
      upBtn.onclick = () => reorderSequence(idx, idx - 1);
      dnBtn.onclick = () => reorderSequence(idx, idx + 2);
      $('.hl-rm', li).onclick = () => removeSequenceAt(idx);

      li.addEventListener('dragstart', (e) => {
        dragState = { kind: 'seq', fromIdx: idx, clipId: c.id };
        li.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/x-gather-clip', JSON.stringify(dragState));
          e.dataTransfer.setData('text/plain', JSON.stringify(dragState));
        }
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('is-dragging');
        clearDropIndicators();
        dragState = null;
      });
      return li;
    }));

    // Generated 30s clips bin
    if (binCount) binCount.textContent = `${binClips.length} available`;
    if (binEmpty) binEmpty.hidden = binClips.length > 0;
    const seqCounts = new Map();
    for (const s of sequence) seqCounts.set(s.clipId, (seqCounts.get(s.clipId) || 0) + 1);

    replaceKids(binList, ...binClips.map((c) => {
      const li = document.createElement('li');
      li.className = 'hl-bin-item';
      li.draggable = true;
      li.dataset.clipId = c.id;
      const inCount = seqCounts.get(c.id) || 0;
      const when = new Date(c.capturedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const thumbUrl = thumbCache.get(c.id);

      li.innerHTML = `
        <span class="hl-grip" aria-hidden="true" title="Drag into playlist">⋮⋮</span>
        <div class="hl-thumb"></div>
        <div class="hl-bin-info">
          <b class="hl-item-title"></b>
          <span class="hl-item-meta num"></span>
        </div>
        <button type="button" class="btn sm hl-bin-add"></button>
      `;

      const thumbEl = $('.hl-thumb', li);
      if (thumbUrl) {
        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = '';
        thumbEl.append(img);
      } else {
        thumbEl.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-scissors"/></svg>';
      }
      $('.hl-item-title', li).textContent = c.title;
      $('.hl-item-meta', li).textContent = `${c.durationSec}s · ${when} · ${c.source}${inCount ? ` · In reel (${inCount})` : ''}`;

      const addBtn = $('.hl-bin-add', li);
      addBtn.textContent = inCount ? '+ Again' : '+ Add';
      addBtn.onclick = () => {
        insertClipAt(c.id);
        api.toast?.(`Added “${c.title}” to Smart Highlights playlist.`, { ms: 2000 });
      };

      li.addEventListener('dragstart', (e) => {
        dragState = { kind: 'bin', clipId: c.id };
        li.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/x-gather-clip', JSON.stringify(dragState));
          e.dataTransfer.setData('text/plain', JSON.stringify(dragState));
        }
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('is-dragging');
        clearDropIndicators();
        dragState = null;
      });
      return li;
    }));

    syncPreviewChrome();
    renderOverlayChrome();
    if (!preview.playing) {
      if (seqClips.length) {
        if (preview.clipIdx >= seqClips.length) preview.clipIdx = 0;
        drawPreviewFrame();
      } else {
        drawIdlePreview();
      }
    }
  }

  // ---- Controls Wiring
  playBtn?.addEventListener('click', () => {
    if (preview.playing) stopPreview();
    else startPreview();
  });
  prevBtn?.addEventListener('click', () => {
    const items = getSequenceClips();
    if (!items.length) return;
    loadPreviewClip(Math.max(0, preview.clipIdx - 1), 0, false);
  });
  nextBtn?.addEventListener('click', () => {
    const items = getSequenceClips();
    if (!items.length) return;
    loadPreviewClip(Math.min(items.length - 1, preview.clipIdx + 1), 0, false);
  });
  loopBtn?.addEventListener('click', () => {
    cfg.loopPreview = !cfg.loopPreview;
    saveCfg();
    loopBtn.classList.toggle('on', cfg.loopPreview);
    loopBtn.setAttribute('aria-pressed', String(cfg.loopPreview));
  });
  muteBtn?.addEventListener('click', () => {
    cfg.muted = !cfg.muted;
    saveCfg();
    previewVideo.muted = cfg.muted;
    muteBtn.classList.toggle('on', cfg.muted);
    muteBtn.setAttribute('aria-pressed', String(cfg.muted));
    syncPreviewChrome();
  });

  if (timeline) {
    let scrubbing = false;
    const seekFromPointer = (ev) => {
      const rect = timeline.getBoundingClientRect();
      if (!rect.width) return;
      const norm = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      seekTimelineNormalized(norm);
    };
    timeline.addEventListener('pointerdown', (ev) => {
      scrubbing = true;
      timeline.setPointerCapture?.(ev.pointerId);
      seekFromPointer(ev);
    });
    timeline.addEventListener('pointermove', (ev) => {
      if (scrubbing) seekFromPointer(ev);
    });
    timeline.addEventListener('pointerup', () => { scrubbing = false; });
    timeline.addEventListener('keydown', (ev) => {
      const items = getSequenceClips();
      if (!items.length) return;
      const total = totalTimelineDuration(items) || 1;
      let cur = preview.localSec;
      for (let i = 0; i < preview.clipIdx; i++) cur += clipPlaybackDuration(items[i]);
      if (ev.key === 'ArrowRight') { ev.preventDefault(); seekTimelineNormalized((cur + 2) / total); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); seekTimelineNormalized((cur - 2) / total); }
    });
  }

  addAllBtn?.addEventListener('click', () => {
    const binClips = [...clipPool.values()].sort((a, b) => (a.capturedAt || 0) - (b.capturedAt || 0));
    const existing = new Set(sequence.map((s) => s.clipId));
    let added = 0;
    for (const c of binClips) {
      if (!existing.has(c.id)) {
        sequence.push({ uid: nextUid(), clipId: c.id });
        added++;
      }
    }
    if (!added && binClips.length) {
      api.toast?.('All available 30-second clips are already in the playlist.');
      return;
    }
    persistSequence();
    renderAll();
    if (sequence.length && !preview.playing) loadPreviewClip(0, 0, false);
    if (added) api.toast?.(`Added ${added} clip${added === 1 ? '' : 's'} to Smart Highlights playlist.`);
  });

  clearSeqBtn?.addEventListener('click', () => {
    sequence = [];
    persistSequence();
    stopPreview();
    if (overlayRun.active) stopStreamOverlay(true);
    renderAll();
    api.toast?.('Cleared Smart Highlights playlist.');
  });

  transitionSel?.addEventListener('change', () => {
    cfg.transition = transitionSel.value;
    saveCfg();
  });
  showTitlesChk?.addEventListener('change', () => {
    cfg.showTitles = !!showTitlesChk.checked;
    saveCfg();
    drawPreviewFrame();
  });
  overlayModeSel?.addEventListener('change', () => {
    cfg.overlayMode = overlayModeSel.value;
    saveCfg();
  });
  overlayLoopChk?.addEventListener('change', () => {
    cfg.overlayLoop = !!overlayLoopChk.checked;
    saveCfg();
  });

  capture30Btn?.addEventListener('click', async () => {
    capture30Btn.disabled = true;
    const orig = capture30Btn.textContent;
    capture30Btn.textContent = 'Capturing…';
    try {
      if (window.__gatherHighlightAgent?.generate30sSmartHighlight) {
        const lastLine = (api.getTranscript?.() || []).slice(-1)[0];
        await window.__gatherHighlightAgent.generate30sSmartHighlight({
          speaker: lastLine?.speaker || api.getMyName?.() || 'Host',
          title: `Highlight #${clipPool.size + 1}`,
          snippet: lastLine?.text ? `“${lastLine.text.slice(0, 110)}”` : '30-second studio highlight captured for playlist.',
          reason: 'Playlist capture',
          peak: 0.95,
          fromAgent: false,
          forceSaveToLib: false,
        });
      } else {
        localEditorClips.unshift({
          id: `clip_local_${Date.now().toString(36)}`,
          title: `Highlight #${clipPool.size + 1}`,
          speaker: api.getMyName?.() || 'Host',
          snippet: '30-second studio highlight clip.',
          source: '30s Clip',
          durationSec: 30,
          capturedAt: Date.now(),
          blob: null,
        });
      }
      refreshClipPool();
    } finally {
      capture30Btn.disabled = false;
      capture30Btn.textContent = orig;
    }
  });

  importBtn?.addEventListener('click', () => importFile?.click());
  importFile?.addEventListener('change', () => {
    const files = [...(importFile.files || [])];
    if (!files.length) return;
    for (const file of files) {
      const cleanName = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Imported 30s Clip';
      localEditorClips.unshift({
        id: `clip_imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        title: cleanName,
        speaker: api.getMyName?.() || 'Imported',
        snippet: `Imported clip (${Math.max(1, Math.round(file.size / 1024))} KB).`,
        source: 'Imported',
        durationSec: 30,
        capturedAt: Date.now(),
        blob: file,
      });
    }
    importFile.value = '';
    refreshClipPool();
    api.toast?.(`Imported ${files.length} clip${files.length === 1 ? '' : 's'} into Smart Highlights bin.`);
  });

  overlayBtn?.addEventListener('click', () => {
    if (overlayRun.active) stopStreamOverlay();
    else startStreamOverlay();
  });
  exportVideoBtn?.addEventListener('click', () => exportPlaylistWebm());
  exportJsonBtn?.addEventListener('click', () => exportPlaylistJson());
  exportCancelBtn?.addEventListener('click', () => { exportCancelled = true; });

  // Live sync whenever new 30s clips arrive anywhere in the studio
  document.addEventListener('gather:clips-updated', refreshClipPool);
  window.addEventListener('beforeunload', () => {
    for (const entry of blobUrlCache.values()) {
      if (entry?.url) try { URL.revokeObjectURL(entry.url); } catch {}
    }
  });

  // Expose public API for console & automated verification
  window.__gatherHighlightPlaylist = {
    refresh: refreshClipPool,
    addClipToBin: (clip) => {
      if (!clip) return null;
      const rec = {
        id: clip.id || `clip_ext_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        title: clip.title || '30s Highlight',
        speaker: clip.speaker || api.getMyName?.() || 'Host',
        snippet: clip.snippet || 'Generated 30-second highlight clip.',
        source: clip.source || '30s Clip',
        durationSec: Number(clip.durationSec) || 30,
        capturedAt: Number(clip.capturedAt) || Date.now(),
        blob: clip.blob || null,
      };
      localEditorClips.unshift(rec);
      refreshClipPool();
      return rec;
    },
    getBinClips: () => [...clipPool.values()],
    getSequence: () => getSequenceClips(),
    insertClipAt,
    reorderSequence,
    removeSequenceAt,
    play: () => startPreview(),
    pause: () => stopPreview(),
    startOverlay: () => startStreamOverlay(),
    stopOverlay: () => stopStreamOverlay(),
    isOverlayActive: () => overlayRun.active,
    isOverlayAudioRouted: () => !!(overlayRun.audioRouted && overlayAudioHandle?.isRouted?.()),
    exportJson: () => exportPlaylistJson(),
    exportWebm: (opts) => exportPlaylistWebm(opts),
    getState: () => ({
      binCount: clipPool.size,
      sequenceIds: sequence.map((s) => s.clipId),
      playing: preview.playing,
      clipIdx: preview.clipIdx,
      overlayActive: overlayRun.active,
      overlayAudioRouted: !!(overlayRun.audioRouted && overlayAudioHandle?.isRouted?.()),
      overlayMode: cfg.overlayMode,
      transition: cfg.transition,
      showTitles: cfg.showTitles,
    }),
  };

  refreshClipPool();
}
