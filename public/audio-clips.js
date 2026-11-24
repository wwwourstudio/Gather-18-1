// Audio Clips soundboard with organized Grid View, IndexedDB persistence,
// drag-and-drop upload & reordering, and instant single-click broadcast mix playback.

import { replaceKids } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);

const DB_NAME = 'gather-audio-clips';
const DB_VERSION = 1;
const STORE_NAME = 'clips';
const PREFS_KEY = 'gather.audioClips.prefs';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CLIP_SECONDS = 60;

export const CLIP_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'hype', label: 'Hype' },
  { id: 'reactions', label: 'Reactions' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'custom', label: 'Custom' },
];

export const CLIP_COLORS = [
  { id: 'default', label: 'Slate' },
  { id: 'blue', label: 'Cobalt' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'amber', label: 'Amber' },
  { id: 'rose', label: 'Rose' },
  { id: 'violet', label: 'Violet' },
];

const STARTER_CLIPS = [
  { id: 'starter-airhorn', name: 'Air Horn', category: 'hype', color: 'rose', duration: 1.5, source: 'builtin', builtin: 'airhorn', order: 0 },
  { id: 'starter-applause', name: 'Applause', category: 'reactions', color: 'emerald', duration: 2.2, source: 'builtin', builtin: 'applause', order: 1 },
  { id: 'starter-whoosh', name: 'Whoosh', category: 'transitions', color: 'blue', duration: 1.1, source: 'builtin', builtin: 'whoosh', order: 2 },
  { id: 'starter-cash', name: 'Sale Ding', category: 'reactions', color: 'amber', duration: 1.1, source: 'builtin', builtin: 'cash', order: 3 },
];

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      vol: Number.isFinite(Number(parsed.vol)) ? Math.max(0, Math.min(1, Number(parsed.vol))) : 0.85,
      cols: parsed.cols === 3 ? 3 : 2,
      cat: CLIP_CATEGORIES.some((c) => c.id === parsed.cat) ? parsed.cat : 'all',
      seeded: !!parsed.seeded,
    };
  } catch {
    return { vol: 0.85, cols: 2, cat: 'all', seeded: false };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function dbGetAll() {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function dbPut(clip) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(clip);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function dbPutMany(list) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const st = tx.objectStore(STORE_NAME);
      for (const item of list) st.put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function dbDelete(id) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function cleanClipName(filename) {
  const base = String(filename || 'Audio clip')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (base || 'Audio clip').slice(0, 32);
}

function fmtClipDur(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '0.0s';
  if (n < 10) return `${n.toFixed(1)}s`;
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function makeClipId() {
  return 'clip-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function svgIcon(name, size = 'sm') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', size === 'sm' ? 'i sm' : 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons.svg#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/**
 * Mount the Audio Clips section with Grid View inside the Music panel.
 * @param {HTMLElement} container Parent element (top of #audioWorkstation or #musicPanelBody)
 * @param {object} api Shared studio tools API
 * @param {object} helpers Extra helpers ({ renderSfxBuffer })
 */
export function mountAudioClips(container, api, { renderSfxBuffer }) {
  if (!container || $('#audioClipsSec')) return null;

  const prefs = loadPrefs();
  let clips = [];
  let editingId = null;
  let dragClipId = null;
  const bufferCache = new Map(); // clip.id -> AudioBuffer
  const activePlays = new Map(); // clip.id -> { stop, token }

  const sec = document.createElement('details');
  sec.className = 'psec ac-sec';
  sec.id = 'audioClipsSec';
  sec.dataset.sec = 'audio-clips';
  sec.open = true;

  sec.innerHTML = `
    <summary>
      <b>Audio Clips</b>
      <span class="hint num" id="acSummaryMeta">Loading…</span>
    </summary>
    <div class="psec-body form ac-body">
      <div class="ac-toolbar">
        <button type="button" class="btn sm primary" id="acUploadBtn">
          <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-upload"/></svg>
          <span>Upload clip</span>
        </button>
        <input type="file" id="acFileInput" accept="audio/*" multiple hidden>
        <div class="ac-toolbar-r">
          <div class="ac-density" role="group" aria-label="Grid density">
            <button type="button" class="ac-den-btn" data-cols="2" aria-label="2-column grid" data-tip="2 columns">2&times;</button>
            <button type="button" class="ac-den-btn" data-cols="3" aria-label="3-column compact grid" data-tip="3 columns">3&times;</button>
          </div>
          <button type="button" class="btn sm ghost ac-stop-btn" id="acStopAll" disabled aria-label="Stop playing clips" data-tip="Stop all clips">
            <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-square"/></svg>
            <span id="acStopLabel">Stop</span>
          </button>
        </div>
      </div>

      <div class="ac-vol-row">
        <label class="ac-vol" for="acVol">
          <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-volume-2"/></svg>
          <span class="ac-vol-lbl">Clip level</span>
          <input type="range" id="acVol" min="0" max="1" step="0.02" value="${prefs.vol}" aria-label="Audio clips volume">
          <em class="num" id="acVolVal">${Math.round(prefs.vol * 100)}%</em>
        </label>
      </div>

      <div class="ac-cats" id="acCats" role="tablist" aria-label="Filter audio clips by category"></div>

      <div class="ac-drop-banner" id="acDropBanner" hidden>
        <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-upload"/></svg>
        <span>Drop audio files to add to Audio Clips</span>
      </div>

      <div class="ac-grid" id="acGrid" data-cols="${prefs.cols}" role="list" aria-label="Audio clips grid"></div>

      <div class="ac-empty" id="acEmpty" hidden>
        <p class="hint" id="acEmptyText">No audio clips in this category yet.</p>
        <button type="button" class="btn sm" id="acEmptyUpload">
          <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-plus"/></svg>
          <span>Upload sound effect</span>
        </button>
      </div>

      <div class="ac-editor" id="acEditor" hidden aria-label="Organize audio clip">
        <div class="ac-ed-head">
          <b>Organize clip</b>
          <button type="button" class="icon-btn sm" id="acEditClose" aria-label="Close clip organizer">
            <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-x"/></svg>
          </button>
        </div>
        <div class="row2">
          <label class="fld">
            <span>Label</span>
            <input type="text" class="input sm" id="acEditName" maxlength="32" placeholder="e.g. Air Horn">
          </label>
          <label class="fld">
            <span>Category</span>
            <select class="input sm" id="acEditCat"></select>
          </label>
        </div>
        <div class="ac-ed-row">
          <span class="ac-ed-lbl">Accent</span>
          <div class="ac-swatches" id="acEditColors" role="radiogroup" aria-label="Clip pad color"></div>
        </div>
        <div class="ac-ed-acts">
          <div class="ac-move-grp">
            <button type="button" class="btn sm ghost" id="acMovePrev" aria-label="Move clip earlier" data-tip="Move earlier">
              <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-chevron-left"/></svg>
            </button>
            <button type="button" class="btn sm ghost" id="acMoveNext" aria-label="Move clip later" data-tip="Move later">
              <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-chevron-right"/></svg>
            </button>
          </div>
          <button type="button" class="btn sm danger ghost" id="acDeleteBtn">
            <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-trash-2"/></svg>
            <span>Delete</span>
          </button>
          <button type="button" class="btn sm primary" id="acEditDone">Done</button>
        </div>
      </div>

      <div class="ac-foot">
        <p class="hint">Click any pad to play into the live mix. Drag pads to reorder.</p>
        <button type="button" class="btn link" id="acRestoreBtn" hidden>Restore starters</button>
      </div>
    </div>
  `;

  container.prepend(sec);

  // Populate category select inside editor
  const editCatSel = $('#acEditCat', sec);
  replaceKids(
    editCatSel,
    ...CLIP_CATEGORIES.filter((c) => c.id !== 'all').map((c) => new Option(c.label, c.id)),
  );

  // Build color swatches inside editor
  const swatchWrap = $('#acEditColors', sec);
  replaceKids(
    swatchWrap,
    ...CLIP_COLORS.map((col) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ac-swatch';
      b.dataset.color = col.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', col.label);
      b.dataset.tip = col.label;
      b.appendChild(svgIcon('check', 'sm'));
      return b;
    }),
  );

  function ensureHost() {
    if (typeof api.isHost === 'function' && !api.isHost()) {
      api.toast?.('Only the host can play or organize audio clips.', { err: true });
      return false;
    }
    return true;
  }

  async function decodeBytes(arrayBuffer) {
    if (typeof api.decodeAudioData === 'function') {
      return api.decodeAudioData(arrayBuffer);
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    try {
      return await ac.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      ac.close?.();
    }
  }

  async function resolveClipBuffer(clip) {
    if (bufferCache.has(clip.id)) return bufferCache.get(clip.id);
    let buf = null;
    if (clip.source === 'builtin' && clip.builtin) {
      buf = await renderSfxBuffer(clip.builtin);
    } else if (clip.bytes) {
      const raw = clip.bytes instanceof ArrayBuffer
        ? clip.bytes
        : clip.bytes?.buffer instanceof ArrayBuffer
          ? clip.bytes.buffer.slice(clip.bytes.byteOffset, clip.bytes.byteOffset + clip.bytes.byteLength)
          : null;
      if (raw) buf = await decodeBytes(raw);
    }
    if (buf) bufferCache.set(clip.id, buf);
    return buf;
  }

  function sortedClips() {
    return [...clips].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  function filteredClips() {
    const ordered = sortedClips();
    if (prefs.cat === 'all') return ordered;
    return ordered.filter((c) => c.category === prefs.cat);
  }

  function updateSummaryAndControls() {
    const count = clips.length;
    const playingCount = activePlays.size;
    const meta = $('#acSummaryMeta', sec);
    if (meta) {
      if (playingCount > 0) {
        meta.textContent = `On air · ${playingCount} playing`;
      } else {
        meta.textContent = `${count} ${count === 1 ? 'clip' : 'clips'} · broadcast mix`;
      }
    }
    const stopBtn = $('#acStopAll', sec);
    const stopLbl = $('#acStopLabel', sec);
    if (stopBtn) {
      stopBtn.disabled = playingCount === 0;
      stopBtn.classList.toggle('is-active', playingCount > 0);
    }
    if (stopLbl) {
      stopLbl.textContent = playingCount > 1 ? `Stop (${playingCount})` : 'Stop';
    }
    // Density buttons
    sec.querySelectorAll('.ac-den-btn').forEach((b) => {
      const on = Number(b.dataset.cols) === prefs.cols;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const grid = $('#acGrid', sec);
    if (grid) grid.dataset.cols = String(prefs.cols);

    // Restore starters button visibility
    const hasAllStarters = STARTER_CLIPS.every((s) => clips.some((c) => c.id === s.id));
    const restoreBtn = $('#acRestoreBtn', sec);
    if (restoreBtn) restoreBtn.hidden = hasAllStarters;
  }

  function renderCategories() {
    const bar = $('#acCats', sec);
    if (!bar) return;
    const counts = { all: clips.length };
    for (const c of clips) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }
    const btns = CLIP_CATEGORIES.map((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ac-cat' + (prefs.cat === cat.id ? ' on' : '');
      btn.dataset.cat = cat.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(prefs.cat === cat.id));
      const lbl = document.createElement('span');
      lbl.textContent = cat.label;
      btn.appendChild(lbl);
      const n = counts[cat.id] || 0;
      if (n > 0) {
        const cnt = document.createElement('em');
        cnt.className = 'num';
        cnt.textContent = String(n);
        btn.appendChild(cnt);
      }
      btn.onclick = () => {
        prefs.cat = cat.id;
        savePrefs(prefs);
        renderAll();
      };
      return btn;
    });
    replaceKids(bar, ...btns);
  }

  function stopClip(clipId) {
    const entry = activePlays.get(clipId);
    if (!entry) return;
    activePlays.delete(clipId);
    try { entry.stop?.(); } catch {}
    syncPadPlayState(clipId, false);
    updateSummaryAndControls();
  }

  function stopAllClips() {
    for (const [id, entry] of [...activePlays.entries()]) {
      activePlays.delete(id);
      try { entry.stop?.(); } catch {}
      syncPadPlayState(id, false);
    }
    updateSummaryAndControls();
  }

  function syncPadPlayState(clipId, playing, durationSec = 0) {
    const grid = $('#acGrid', sec);
    if (!grid) return;
    const pad = [...grid.querySelectorAll('.ac-pad')].find((el) => el.dataset.clipId === clipId);
    if (!pad) return;
    pad.classList.remove('is-playing');
    const prog = $('.ac-pad-prog', pad);
    if (prog) {
      prog.style.removeProperty('--ac-dur');
    }
    if (playing) {
      // Force reflow so rapid retrigger restarts the progress animation cleanly
      void pad.offsetWidth;
      if (prog) prog.style.setProperty('--ac-dur', `${Math.max(0.25, durationSec || 1)}s`);
      pad.classList.add('is-playing');
    }
    const hit = $('.ac-pad-hit', pad);
    if (hit) hit.setAttribute('aria-pressed', String(!!playing));
  }

  async function playClip(clip) {
    if (!ensureHost()) return;
    // Instant retrigger if already active
    if (activePlays.has(clip.id)) {
      stopClip(clip.id);
    }

    const token = Symbol(clip.id);
    activePlays.set(clip.id, { stop: () => {}, token });
    syncPadPlayState(clip.id, true, clip.duration || 1.2);
    updateSummaryAndControls();

    try {
      const buf = await resolveClipBuffer(clip);
      if (!buf) {
        if (activePlays.get(clip.id)?.token === token) {
          activePlays.delete(clip.id);
          syncPadPlayState(clip.id, false);
          updateSummaryAndControls();
        }
        api.toast?.(`Could not play “${clip.name}”.`, { err: true });
        return;
      }
      // If user clicked Stop while decoding, abort cleanly
      if (activePlays.get(clip.id)?.token !== token) return;

      const dur = buf.duration || clip.duration || 1;
      syncPadPlayState(clip.id, true, dur);

      const onEnded = () => {
        if (activePlays.get(clip.id)?.token === token) {
          activePlays.delete(clip.id);
          syncPadPlayState(clip.id, false);
          updateSummaryAndControls();
        }
      };

      let stopFn;
      if (typeof api.playStreamBuffer === 'function') {
        stopFn = await api.playStreamBuffer(buf, { volume: prefs.vol, duck: false, onEnded });
      } else {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ac = new AC();
        const src = ac.createBufferSource();
        const g = ac.createGain();
        g.gain.value = prefs.vol;
        src.buffer = buf;
        src.connect(g).connect(ac.destination);
        src.onended = () => { ac.close?.(); onEnded(); };
        src.start();
        stopFn = () => { try { src.stop(); } catch {} ac.close?.(); onEnded(); };
        stopFn.setVolume = (v) => { try { g.gain.value = v; } catch {} };
      }

      if (activePlays.get(clip.id)?.token === token) {
        activePlays.set(clip.id, { stop: stopFn, token });
      } else {
        try { stopFn?.(); } catch {}
      }
    } catch (err) {
      if (activePlays.get(clip.id)?.token === token) {
        activePlays.delete(clip.id);
        syncPadPlayState(clip.id, false);
        updateSummaryAndControls();
      }
      api.toast?.('Could not play clip: ' + (err?.message || 'audio error'), { err: true });
    }
  }

  async function reorderClip(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    const ordered = sortedClips();
    const fromIdx = ordered.findIndex((c) => c.id === fromId);
    const toIdx = ordered.findIndex((c) => c.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    ordered.forEach((c, idx) => { c.order = idx; });
    clips = ordered;
    await dbPutMany(clips);
    renderAll();
  }

  async function nudgeClipOrder(clipId, delta) {
    const visible = filteredClips();
    const idx = visible.findIndex((c) => c.id === clipId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= visible.length) return;
    await reorderClip(clipId, visible[nextIdx].id);
  }

  function renderEditor() {
    const panel = $('#acEditor', sec);
    if (!panel) return;
    const clip = editingId ? clips.find((c) => c.id === editingId) : null;
    if (!clip) {
      editingId = null;
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const nameInp = $('#acEditName', sec);
    if (document.activeElement !== nameInp) nameInp.value = clip.name;
    $('#acEditCat', sec).value = clip.category || 'custom';
    swatchWrap.querySelectorAll('.ac-swatch').forEach((b) => {
      const on = b.dataset.color === (clip.color || 'default');
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const visible = filteredClips();
    const idx = visible.findIndex((c) => c.id === clip.id);
    $('#acMovePrev', sec).disabled = idx <= 0;
    $('#acMoveNext', sec).disabled = idx < 0 || idx >= visible.length - 1;
  }

  function renderGrid() {
    const grid = $('#acGrid', sec);
    const empty = $('#acEmpty', sec);
    if (!grid) return;

    const list = filteredClips();
    if (!list.length) {
      replaceKids(grid);
      grid.hidden = true;
      if (empty) {
        empty.hidden = false;
        const catObj = CLIP_CATEGORIES.find((c) => c.id === prefs.cat);
        $('#acEmptyText', sec).textContent = prefs.cat === 'all'
          ? 'Upload short sound effects (MP3, WAV, OGG) to trigger them live with one click.'
          : `No clips in ${catObj?.label || prefs.cat} yet.`;
      }
      return;
    }

    grid.hidden = false;
    if (empty) empty.hidden = true;

    const nodes = list.map((clip) => {
      const pad = document.createElement('div');
      pad.className = 'ac-pad';
      pad.dataset.clipId = clip.id;
      pad.dataset.color = clip.color || 'default';
      pad.setAttribute('role', 'listitem');
      pad.draggable = true;
      if (activePlays.has(clip.id)) pad.classList.add('is-playing');
      if (editingId === clip.id) pad.classList.add('is-editing');

      const hit = document.createElement('button');
      hit.type = 'button';
      hit.className = 'ac-pad-hit';
      hit.setAttribute('aria-pressed', String(activePlays.has(clip.id)));
      hit.setAttribute('aria-label', `Play ${clip.name} (${fmtClipDur(clip.duration)})`);

      const top = document.createElement('span');
      top.className = 'ac-pad-top';

      const iconBox = document.createElement('span');
      iconBox.className = 'ac-pad-ic';
      iconBox.appendChild(svgIcon('play', 'sm'));

      const dur = document.createElement('span');
      dur.className = 'ac-pad-dur num';
      dur.textContent = fmtClipDur(clip.duration);

      top.append(iconBox, dur);

      const name = document.createElement('span');
      name.className = 'ac-pad-name';
      name.textContent = clip.name;

      const prog = document.createElement('span');
      prog.className = 'ac-pad-prog';
      prog.setAttribute('aria-hidden', 'true');

      hit.append(top, name, prog);
      hit.onclick = () => playClip(clip);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'ac-pad-edit';
      editBtn.setAttribute('aria-label', `Organize ${clip.name}`);
      editBtn.dataset.tip = 'Organize clip';
      editBtn.appendChild(svgIcon('sliders-horizontal', 'sm'));
      editBtn.onclick = (e) => {
        e.stopPropagation();
        if (!ensureHost()) return;
        editingId = editingId === clip.id ? null : clip.id;
        renderAll();
        if (editingId) {
          $('#acEditor', sec)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      };

      // Drag-and-drop reordering
      pad.addEventListener('dragstart', (e) => {
        if (!ensureHost()) { e.preventDefault(); return; }
        dragClipId = clip.id;
        pad.classList.add('is-dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', clip.id);
        } catch {}
      });
      pad.addEventListener('dragend', () => {
        dragClipId = null;
        pad.classList.remove('is-dragging');
        grid.querySelectorAll('.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
      });
      pad.addEventListener('dragover', (e) => {
        if (!dragClipId || dragClipId === clip.id) return;
        e.preventDefault();
        pad.classList.add('is-drop-target');
      });
      pad.addEventListener('dragleave', () => {
        pad.classList.remove('is-drop-target');
      });
      pad.addEventListener('drop', (e) => {
        if (!dragClipId || dragClipId === clip.id) return;
        e.preventDefault();
        e.stopPropagation();
        pad.classList.remove('is-drop-target');
        const sourceId = dragClipId;
        dragClipId = null;
        reorderClip(sourceId, clip.id);
      });

      pad.append(hit, editBtn);
      return pad;
    });

    replaceKids(grid, ...nodes);
  }

  function renderAll() {
    renderCategories();
    renderGrid();
    renderEditor();
    updateSummaryAndControls();
  }

  async function importAudioFiles(fileList) {
    if (!ensureHost()) return;
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;

    const uploadBtn = $('#acUploadBtn', sec);
    if (uploadBtn) uploadBtn.disabled = true;

    const targetCat = prefs.cat === 'all' ? 'custom' : prefs.cat;
    const added = [];
    const errors = [];

    try {
      const existingMin = clips.reduce((min, c) => Math.min(min, c.order ?? 0), 0);
      let nextOrder = existingMin - files.length;

      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) {
          errors.push(`${file.name} is over 10 MB`);
          continue;
        }
        try {
          const bytes = await file.arrayBuffer();
          const buf = await decodeBytes(bytes);
          if (!buf || !buf.duration) {
            errors.push(`${file.name} could not be decoded`);
            continue;
          }
          if (buf.duration > MAX_CLIP_SECONDS) {
            errors.push(`${file.name} is over ${MAX_CLIP_SECONDS}s (use Background Music for full songs)`);
            continue;
          }
          const clip = {
            id: makeClipId(),
            name: cleanClipName(file.name),
            category: targetCat,
            color: 'blue',
            duration: buf.duration,
            mimeType: file.type || 'audio/mpeg',
            bytes,
            source: 'upload',
            order: nextOrder++,
            createdAt: Date.now(),
          };
          bufferCache.set(clip.id, buf);
          clips.push(clip);
          await dbPut(clip);
          added.push(clip);
        } catch {
          errors.push(`${file.name} is not a supported audio file`);
        }
      }

      if (added.length) {
        // Normalize order cleanly from 0..N-1
        const ordered = sortedClips();
        ordered.forEach((c, i) => { c.order = i; });
        clips = ordered;
        await dbPutMany(clips);
        renderAll();
        api.toast?.(
          added.length === 1
            ? `Added “${added[0].name}” to Audio Clips.`
            : `Added ${added.length} audio clips.`,
        );
      }
      if (errors.length) {
        api.toast?.(errors[0], { err: true });
      }
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
    }
  }

  // Wire toolbar & file upload controls
  const fileInput = $('#acFileInput', sec);
  const triggerUpload = () => {
    if (!ensureHost()) return;
    fileInput.click();
  };
  $('#acUploadBtn', sec).onclick = triggerUpload;
  $('#acEmptyUpload', sec).onclick = triggerUpload;
  fileInput.onchange = (e) => {
    const fl = e.target.files;
    if (fl && fl.length) importAudioFiles(fl);
    e.target.value = '';
  };

  // Drag-and-drop audio files anywhere onto the Audio Clips section
  let fileDragDepth = 0;
  const isFileDrag = (e) => !dragClipId && Array.from(e.dataTransfer?.types || []).includes('Files');
  sec.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepth++;
    sec.classList.add('is-file-drag');
    $('#acDropBanner', sec).hidden = false;
  });
  sec.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  sec.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (fileDragDepth === 0) {
      sec.classList.remove('is-file-drag');
      $('#acDropBanner', sec).hidden = true;
    }
  });
  sec.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    sec.classList.remove('is-file-drag');
    $('#acDropBanner', sec).hidden = true;
    if (e.dataTransfer?.files?.length) importAudioFiles(e.dataTransfer.files);
  });

  // Grid column density toggle
  sec.querySelectorAll('.ac-den-btn').forEach((btn) => {
    btn.onclick = () => {
      prefs.cols = Number(btn.dataset.cols) === 3 ? 3 : 2;
      savePrefs(prefs);
      updateSummaryAndControls();
    };
  });

  // Stop all active clips
  $('#acStopAll', sec).onclick = () => stopAllClips();

  // Master Clip Volume
  $('#acVol', sec).oninput = (e) => {
    prefs.vol = Math.max(0, Math.min(1, Number(e.target.value) || 0));
    savePrefs(prefs);
    $('#acVolVal', sec).textContent = `${Math.round(prefs.vol * 100)}%`;
    for (const entry of activePlays.values()) {
      try { entry.stop?.setVolume?.(prefs.vol); } catch {}
    }
  };

  // Inline Clip Organizer bindings
  const commitEdit = async () => {
    const clip = editingId ? clips.find((c) => c.id === editingId) : null;
    if (!clip) return;
    const rawName = $('#acEditName', sec).value.trim();
    clip.name = (rawName || clip.name || 'Audio clip').slice(0, 32);
    clip.category = $('#acEditCat', sec).value || 'custom';
    await dbPut(clip);
    renderAll();
  };

  $('#acEditName', sec).addEventListener('change', commitEdit);
  $('#acEditName', sec).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    }
  });
  $('#acEditCat', sec).addEventListener('change', commitEdit);

  swatchWrap.addEventListener('click', async (e) => {
    const b = e.target.closest('.ac-swatch');
    if (!b || !editingId) return;
    const clip = clips.find((c) => c.id === editingId);
    if (!clip) return;
    clip.color = b.dataset.color || 'default';
    await dbPut(clip);
    renderAll();
  });

  $('#acMovePrev', sec).onclick = () => { if (editingId) nudgeClipOrder(editingId, -1); };
  $('#acMoveNext', sec).onclick = () => { if (editingId) nudgeClipOrder(editingId, 1); };

  $('#acDeleteBtn', sec).onclick = async () => {
    if (!editingId) return;
    const clip = clips.find((c) => c.id === editingId);
    if (!clip) return;
    stopClip(clip.id);
    bufferCache.delete(clip.id);
    clips = clips.filter((c) => c.id !== clip.id);
    editingId = null;
    await dbDelete(clip.id);
    renderAll();
    api.toast?.(`Removed “${clip.name}”.`);
  };

  const closeEditor = () => {
    editingId = null;
    renderAll();
  };
  $('#acEditClose', sec).onclick = closeEditor;
  $('#acEditDone', sec).onclick = async () => {
    await commitEdit();
    closeEditor();
  };

  // Restore starter clips
  $('#acRestoreBtn', sec).onclick = async () => {
    if (!ensureHost()) return;
    const missing = STARTER_CLIPS.filter((s) => !clips.some((c) => c.id === s.id));
    if (!missing.length) return;
    const maxOrder = clips.reduce((m, c) => Math.max(m, c.order ?? 0), -1);
    missing.forEach((s, i) => {
      clips.push({ ...s, order: maxOrder + 1 + i });
    });
    await dbPutMany(clips);
    renderAll();
    api.toast?.('Starter audio clips restored.');
  };

  // Initial hydration from IndexedDB
  (async () => {
    const stored = await dbGetAll();
    if (stored && stored.length > 0) {
      clips = stored;
    } else if (!prefs.seeded) {
      clips = STARTER_CLIPS.map((s) => ({ ...s }));
      prefs.seeded = true;
      savePrefs(prefs);
      await dbPutMany(clips);
    } else {
      clips = [];
    }
    renderAll();
  })();

  return {
    importAudioFiles,
    stopAllClips,
    getClips: () => sortedClips(),
  };
}
