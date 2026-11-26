// Clips: the last minute of the program is always ready, so a marked moment holds a real 30-second highlight.
//
// While the host is in the studio, the program (the stage canvas plus the audio mix, exactly what's recorded and
// streamed) is recorded in self-contained 5-second WebM segments; the last 13 (about a minute) are kept. Marking a
// moment keeps the segments from 25 s before to 5 s after it (30 seconds total). Exporting plays those segments back
// through a canvas (9:16 crop or 16:9), adds a branded caption, and saves one video file.

const SEG_MS = 5000, KEEP = 13, BEFORE = 25_000, AFTER = 5_000, MAX_MOMENTS = 12;
const pickMime = () => ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';

export function createClipBuffer({ getCanvas, getMixStream, inStudio, isHost, getTitle, getBrandColor, onChange, onReady }) {
  const segs = []; // { t0, t1, blob }
  const moments = []; // { id, label, kind, ts, blobs, dur, state: 'capturing' | 'ready' | 'missed', readyNotified }
  let stream = null, rec = null, running = false, mime = '';

  function start() {
    if (running || !window.MediaRecorder) return;
    const canvas = getCanvas(); if (!canvas?.captureStream) return;
    mime = pickMime(); if (!mime) return;
    const vs = canvas.captureStream(24);
    const mix = getMixStream?.();
    stream = new MediaStream([...vs.getVideoTracks(), ...(mix ? mix.getAudioTracks() : [])]);
    running = true;
    next();
  }
  function next() {
    if (!running) return;
    const chunks = [], t0 = Date.now();
    try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 }); }
    catch { running = false; return; }
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      if (chunks.length) {
        segs.push({ t0, t1: Date.now(), blob: new Blob(chunks, { type: mime.split(';')[0] }) });
        while (segs.length > KEEP) segs.shift();
        settle();
      }
      next();
    };
    rec.start();
    setTimeout(() => { try { if (rec?.state === 'recording') rec.stop(); } catch {} }, SEG_MS);
  }
  function stop() {
    running = false;
    try { if (rec?.state === 'recording') rec.stop(); } catch {}
    stream?.getVideoTracks().forEach((t) => t.stop()); // the canvas capture track only; the mix is shared
    stream = null; rec = null; segs.length = 0;
  }
  // A moment becomes ready once the segments up to 5 s after it exist (25s before + 5s after = 30s clip).
  function settle() {
    let changed = false;
    const newlyReady = [];
    for (const m of moments) {
      if (m.state !== 'capturing') continue;
      const have = segs.filter((s) => s.t1 > m.ts - BEFORE && s.t0 < m.ts + AFTER);
      const doneAfter = segs.some((s) => s.t1 >= m.ts + AFTER);
      if (doneAfter && have.length) {
        m.blobs = have.map((s) => s.blob);
        m.dur = Math.max(5, Math.min(35, Math.round((have.at(-1).t1 - have[0].t0) / 1000)));
        m.state = 'ready';
        changed = true;
        if (!m.readyNotified) { m.readyNotified = true; newlyReady.push(m); }
      } else if (Date.now() - m.ts > AFTER + SEG_MS * 2) {
        m.blobs = have.map((s) => s.blob);
        m.dur = have.length ? Math.max(5, Math.round((have.at(-1).t1 - have[0].t0) / 1000)) : 30;
        m.state = have.length ? 'ready' : 'missed';
        changed = true;
        if (m.state === 'ready' && !m.readyNotified) { m.readyNotified = true; newlyReady.push(m); }
      }
    }
    if (changed) onChange?.(moments);
    for (const m of newlyReady) {
      try { onReady?.(m); } catch {}
    }
  }
  function mark(label, kind = 'manual') {
    if (!running && inStudio() && isHost()) start();
    const m = {
      id: 'clip_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      label: String(label || '30s Highlight').slice(0, 60),
      kind,
      ts: Date.now(),
      blobs: [],
      dur: 30,
      state: running ? 'capturing' : 'missed',
      readyNotified: false,
    };
    moments.unshift(m);
    while (moments.length > MAX_MOMENTS) moments.pop();
    onChange?.(moments);
    return m;
  }

  /** Fast single-file WebM assembly (used for immediate Cloud Clips storage & Drive sync). */
  async function exportClip(m, aspect = '16:9') {
    if (!m?.blobs?.length) throw new Error('That moment wasn’t captured.');
    if (m.blobs.length === 1 && aspect === '16:9') return m.blobs[0];
    const vertical = aspect === '9:16';
    const W = vertical ? 540 : 1280, H = vertical ? 960 : 720;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const g = out.getContext('2d');
    const ac = new AudioContext(), dest = ac.createMediaStreamDestination();
    const outStream = new MediaStream([...out.captureStream(24).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const outMime = pickMime();
    const recOut = new MediaRecorder(outStream, { mimeType: outMime, videoBitsPerSecond: vertical ? 2_500_000 : 3_500_000 });
    const chunks = []; recOut.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { recOut.onstop = res; });
    const color = getBrandColor?.() || '#3b82f6', title = getTitle?.() || 'Live on gather';
    const caption = () => {
      const pad = vertical ? 28 : 32, h = vertical ? 118 : 96, y = H - h - (vertical ? 80 : 36);
      g.fillStyle = 'rgba(7,10,18,0.78)'; g.beginPath(); g.roundRect(pad, y, W - pad * 2, h, 18); g.fill();
      g.fillStyle = color; g.fillRect(pad, y, 6, h);
      g.fillStyle = '#fff'; g.font = `800 ${vertical ? 26 : 30}px "Plus Jakarta Sans", Inter, sans-serif`; g.fillText(m.label.slice(0, vertical ? 28 : 48), pad + 24, y + (vertical ? 52 : 44));
      g.fillStyle = 'rgba(255,255,255,0.78)'; g.font = `600 ${vertical ? 17 : 19}px Inter, sans-serif`; g.fillText(title.slice(0, 60), pad + 24, y + (vertical ? 90 : 76));
    };
    recOut.start(500);
    for (const blob of m.blobs) {
      const v = document.createElement('video'); v.playsInline = true; v.muted = true; v.src = URL.createObjectURL(blob);
      let srcNode = null;
      try { srcNode = ac.createMediaElementSource(v); srcNode.connect(dest); } catch {}
      await new Promise((res) => {
        let raf = 0;
        const timeout = setTimeout(() => { cancelAnimationFrame(raf); res(); }, 7000);
        const draw = () => {
          const vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
          g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
          if (vertical) { const cw = Math.min(vw, vh * 9 / 16); g.drawImage(v, (vw - cw) / 2, 0, cw, vh, 0, 0, W, H); }
          else g.drawImage(v, 0, 0, vw, vh, 0, 0, W, H);
          caption();
          raf = requestAnimationFrame(draw);
        };
        const finish = () => { clearTimeout(timeout); cancelAnimationFrame(raf); res(); };
        v.onended = finish;
        v.onerror = finish;
        v.play().then(() => { raf = requestAnimationFrame(draw); }).catch(finish);
      });
      try { srcNode?.disconnect(); } catch {}
      URL.revokeObjectURL(v.src);
    }
    recOut.stop(); await done; ac.close().catch(() => {});
    return chunks.length ? new Blob(chunks, { type: outMime.split(';')[0] }) : new Blob(m.blobs, { type: 'video/webm' });
  }

  // Run while the host is in the studio
  setInterval(() => { const want = inStudio() && isHost() && !document.hidden; if (want && !running) start(); else if (!want && running) stop(); settle(); }, 2000);
  /** The segments covering the last `ms` (instant replay), oldest first. */
  const recent = (ms = 30000) => { const from = Date.now() - ms; return segs.filter((s) => s.t1 >= from).map((s) => s.blob); };
  return { mark, exportClip, moments, recent, get running() { return running; }, start, stop };
}
