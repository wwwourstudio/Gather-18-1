// Instant 30-second clip studio with trim preview.
// Created by app.js through createClipStudio(app): `app` carries the studio state and helpers this part uses.
export function createClipStudio(app) {
  const { $, $$, W, toast } = app;
  // ---------------------------------------------------------------- Instant 30s Clip Studio with Trim Preview
  const CLIP = { recs: [], timer: null, on: false, active: null, exporting: false, cancelExport: null };
  function clipStart() {
    const v = W.direct.video; if (!v?.srcObject || !window.MediaRecorder || CLIP.on) return;
    CLIP.on = true;
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const spawn = () => {
      if (!W.direct.video?.srcObject) return clipStop();
      try {
        const rec = new MediaRecorder(W.direct.video.srcObject, { mimeType: mime, videoBitsPerSecond: 2_000_000 }), chunks = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.start(1000); CLIP.recs.push({ rec, chunks, t0: Date.now(), mime: rec.mimeType || mime });
        while (CLIP.recs.length > 2) { const old = CLIP.recs.shift(); try { old.rec.stop(); } catch {} }
      } catch (e) { console.warn('clip recorder', e); }
    };
    spawn(); CLIP.timer = setInterval(spawn, 30000);
  }
  function clipStop() { clearInterval(CLIP.timer); for (const r of CLIP.recs) { try { r.rec.stop(); } catch {} } CLIP.recs = []; CLIP.on = false; }

  const fmtSec = (s) => {
    const v = Math.max(0, Number(s) || 0);
    const m = Math.floor(v / 60), sec = Math.floor(v % 60), tenth = Math.floor((v % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenth}`;
  };

  function updateClipTrimUI() {
    const a = CLIP.active; if (!a) return;
    const dur = Math.max(1, a.dur);
    const start = Number($('#wTrimIn').value), end = Number($('#wTrimOut').value);
    a.start = start; a.end = end;
    const left = (start / dur) * 100, right = 100 - (end / dur) * 100;
    $('#wClipSel').style.left = `${left}%`;
    $('#wClipSel').style.right = `${Math.max(0, right)}%`;
    const selDur = Math.max(0, end - start);
    $('#wClipInTxt').textContent = `In ${fmtSec(start)}`;
    $('#wClipOutTxt').textContent = `Out ${fmtSec(end)}`;
    $('#wClipDurTxt').textContent = `Selection ${selDur.toFixed(1)}s`;
    $('#wClipExportTxt').textContent = `Export trim (${selDur.toFixed(1)}s)`;
  }

  async function openClipStudio() {
    if (!CLIP.on) { clipStart(); toast('Buffering rolling 30s clip… give it ~3 seconds.'); }
    $('#wClipDlg').showModal();
    const vid = $('#wClipPreview');
    $('#wClipWait').hidden = false;
    $('#wClipWaitTxt').textContent = 'Preparing rolling clip buffer…';
    $('#wClipProg').hidden = true;
    $('#wClipExport').disabled = true;
    $('#wClipFullSave').disabled = true;

    // Pick richest recorder with >= 2.5s of recorded data (or wait briefly if freshly enabled)
    let r = CLIP.recs[0];
    if (!r || Date.now() - r.t0 < 2500) {
      await new Promise((res) => setTimeout(res, 2600));
      r = CLIP.recs[0];
    }
    if (!r) { $('#wClipDlg').close(); return toast('Direct video is not ready for clipping yet.', true); }
    try { r.rec.requestData(); } catch {}
    await new Promise((res) => setTimeout(res, 250));

    const mime = (r.mime || 'video/webm').split(';')[0];
    const blob = new Blob(r.chunks, { type: mime });
    if (!blob.size) { $('#wClipWaitTxt').textContent = 'Buffer is warming up — try again in a second.'; return; }

    if (CLIP.active?.url) URL.revokeObjectURL(CLIP.active.url);
    const url = URL.createObjectURL(blob);
    const approxDur = Math.max(2, (Date.now() - r.t0) / 1000);
    CLIP.active = { blob, url, mime, dur: approxDur, start: 0, end: approxDur };

    vid.src = url;
    vid.onloadedmetadata = () => {
      const d = Number.isFinite(vid.duration) && vid.duration > 0.5 && vid.duration < 180 ? vid.duration : approxDur;
      CLIP.active.dur = d;
      CLIP.active.start = Math.max(0, d - Math.min(30, d));
      CLIP.active.end = d;
      $('#wTrimIn').max = d.toFixed(1);
      $('#wTrimOut').max = d.toFixed(1);
      $('#wTrimIn').value = CLIP.active.start.toFixed(1);
      $('#wTrimOut').value = CLIP.active.end.toFixed(1);
      updateClipTrimUI();
      $('#wClipWait').hidden = true;
      $('#wClipExport').disabled = false;
      $('#wClipFullSave').disabled = false;
      const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
      const testFile = new File([blob], `clip.${ext}`, { type: mime });
      $('#wClipShare').hidden = !navigator.canShare?.({ files: [testFile] });
      vid.currentTime = CLIP.active.start;
      vid.play().catch(() => {});
    };
  }

  $('#wClipPreview').addEventListener('timeupdate', () => {
    const a = CLIP.active, vid = $('#wClipPreview');
    if (!a || CLIP.exporting) return;
    const ct = vid.currentTime;
    $('#wClipClock').textContent = `${fmtSec(ct)} / ${fmtSec(a.dur)}`;
    $('#wClipHead').style.left = `${Math.min(100, Math.max(0, (ct / Math.max(1, a.dur)) * 100))}%`;
    if (ct >= a.end) { vid.currentTime = a.start; vid.play().catch(() => {}); }
  });
  $('#wClipPreview').addEventListener('play', () => $('#wClipPlay use').setAttribute('href', '/icons.svg#i-pause'));
  $('#wClipPreview').addEventListener('pause', () => $('#wClipPlay use').setAttribute('href', '/icons.svg#i-play'));
  $('#wClipPlay').onclick = () => { const v = $('#wClipPreview'); if (v.paused) v.play().catch(() => {}); else v.pause(); };

  $('#wTrimIn').oninput = () => {
    let inV = Number($('#wTrimIn').value), outV = Number($('#wTrimOut').value);
    if (inV > outV - 1.5) { inV = Math.max(0, outV - 1.5); $('#wTrimIn').value = inV.toFixed(1); }
    updateClipTrimUI();
    $('#wClipPreview').currentTime = inV;
  };
  $('#wTrimOut').oninput = () => {
    let inV = Number($('#wTrimIn').value), outV = Number($('#wTrimOut').value);
    if (outV < inV + 1.5) { outV = Math.min(CLIP.active?.dur || 30, inV + 1.5); $('#wTrimOut').value = outV.toFixed(1); }
    updateClipTrimUI();
  };
  $$('.wv-clip-presets button').forEach((b) => b.onclick = () => {
    const a = CLIP.active; if (!a) return;
    const p = b.dataset.trim;
    const span = p === 'all' ? a.dur : Math.min(a.dur, Number(p));
    $('#wTrimIn').value = Math.max(0, a.dur - span).toFixed(1);
    $('#wTrimOut').value = a.dur.toFixed(1);
    updateClipTrimUI();
    $('#wClipPreview').currentTime = Number($('#wTrimIn').value);
  });

  function clipFilename(ext) {
    return `${(W.info?.title || 'gather').replace(/[^\w-]+/g, '-').slice(0, 40)}-clip-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${ext}`;
  }
  function saveBlob(blob, mime) {
    const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
    const name = clipFilename(ext);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Clip downloaded (${name}).`);
  }

  $('#wClipFullSave').onclick = () => { if (CLIP.active) saveBlob(CLIP.active.blob, CLIP.active.mime); };
  $('#wClipShare').onclick = async () => {
    if (!CLIP.active) return;
    const ext = /mp4/.test(CLIP.active.mime) ? 'mp4' : 'webm';
    const file = new File([CLIP.active.blob], clipFilename(ext), { type: CLIP.active.mime });
    try { await navigator.share({ files: [file], title: 'Clip from ' + (W.info?.title || 'the show') }); } catch {}
  };

  $('#wClipExport').onclick = async () => {
    const a = CLIP.active; if (!a || CLIP.exporting) return;
    // Instant zero-reencode export if full range selected or captureStream unsupported
    const isFull = a.start <= 0.3 && a.end >= a.dur - 0.3;
    const vid = $('#wClipPreview');
    const capFn = vid.captureStream || vid.mozCaptureStream;
    if (isFull || typeof capFn !== 'function') {
      saveBlob(a.blob, a.mime);
      return;
    }
    CLIP.exporting = true;
    $('#wClipExport').disabled = true;
    $('#wClipProg').hidden = false;
    const dur = Math.max(1.5, a.end - a.start);
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || a.mime;

    try {
      vid.pause();
      vid.currentTime = a.start;
      await new Promise((res) => { const onSeek = () => { vid.removeEventListener('seeked', onSeek); res(); }; vid.addEventListener('seeked', onSeek); setTimeout(res, 600); });
      const stream = capFn.call(vid);
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      rec.start(250);
      vid.play().catch(() => {});

      const timer = setInterval(() => {
        const elapsed = Math.max(0, vid.currentTime - a.start);
        const pct = Math.min(100, Math.round((elapsed / dur) * 100));
        $('#wClipProgBar').style.width = `${pct}%`;
        $('#wClipProgTxt').textContent = `Trimming ${elapsed.toFixed(1)}s / ${dur.toFixed(1)}s…`;
        if (vid.currentTime >= a.end || vid.ended) { clearInterval(timer); if (rec.state === 'recording') rec.stop(); vid.pause(); }
      }, 100);
      CLIP.cancelExport = () => { clearInterval(timer); if (rec.state === 'recording') rec.stop(); };

      await done;
      CLIP.cancelExport = null;
      if (chunks.length) saveBlob(new Blob(chunks, { type: mime.split(';')[0] }), mime);
      else saveBlob(a.blob, a.mime);
    } catch {
      saveBlob(a.blob, a.mime);
    } finally {
      CLIP.exporting = false;
      $('#wClipExport').disabled = false;
      $('#wClipProg').hidden = true;
      $('#wClipProgBar').style.width = '0';
    }
  };

  $('#wClipDlg').addEventListener('close', () => {
    CLIP.cancelExport?.();
    $('#wClipPreview').pause();
  });

  $('#wClip').onclick = openClipStudio;

  setInterval(() => {
    const ready = W.direct.state === 'live' && !!window.MediaRecorder;
    $('#wClip').hidden = !ready;
    if (ready && !CLIP.on && (navigator.hardwareConcurrency || 2) >= 6 && !/Mobi/i.test(navigator.userAgent)) clipStart();
    if (!ready && CLIP.on) clipStop();
  }, 2000);
}
