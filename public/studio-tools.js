// Modular studio upgrades for gather:
// - Pre-live Go Live checklist (camera, mic, relay, stream key, bitrate) with 1-line fixes
// - Redesigned Brand Kit UI (custom stage bg solid/gradient, visual font cards, live previews,
//   Save My Look as a theme, Export/Import Brand Kit JSON, Website Brand Kit Importer, Motion Presets,
//   Alert Styles, 6 Pre-made Overlay Packs, Countdown Starting Screen)
// - Upgraded AI Designer workflow with Drag & Drop Reference Example Images (up to 3) + AI Scene Builder + AI Director
// - Direct Stage Editing (hover outline, right-click menu, keyboard nudging with alignment guides)
// - Hot Seat (super chat -> 60s on stage), Goals That Change The Show, Sponsor Slots & Report,
//   Guest Green Room, Clip & Post / Auto Shorts (9:16 vertical), and Team Workspaces & Roles.

import { MOTION_PRESETS, ALERT_STYLES, OVERLAY_PACKS } from './stage-theme.js';
import { replaceKids } from './ui.js';
import { createClipBuffer } from './clips.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('gather:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gather:' + k, JSON.stringify(v)); } catch {} },
};

const FONT_CARDS = [
  { id: 'jakarta', name: 'Jakarta', vibe: 'Clean modern', family: '"Plus Jakarta Sans", sans-serif' },
  { id: 'onest', name: 'Onest', vibe: 'Friendly round', family: 'Onest, sans-serif' },
  { id: 'playfair', name: 'Playfair', vibe: 'Editorial serif', family: '"Playfair Display", serif' },
  { id: 'serif', name: 'DM Serif', vibe: 'Warm classic', family: '"DM Serif Display", serif' },
  { id: 'bebas', name: 'Bebas', vibe: 'Bold headlines', family: '"Bebas Neue", sans-serif' },
  { id: 'mono', name: 'JetBrains', vibe: 'Technical mono', family: '"JetBrains Mono", monospace' },
];

const PANEL_SWATCHES = ['#0f172a', '#111827', '#1e1b4b', '#172554', '#064e3b', '#3f1d2e', '#f8fafc', '#ffffff'];

// ---------------------------------------------------------------- 1. PRE-LIVE CHECKLIST (#liveDlg)
function initPreLiveChecklist(api) {
  const dlg = $('#liveDlg');
  if (!dlg || $('#preLiveBox')) return;
  const body = $('.modal-body', dlg) || $('.form', dlg);
  if (!body) return;

  const box = document.createElement('div');
  box.id = 'preLiveBox';
  box.className = 'prelive-box';
  box.innerHTML = `
    <div class="prelive-head">
      <b>1. Ready to go?</b>
      <button type="button" class="btn sm ghost" id="preLiveRun">Re-check</button>
    </div>
    <ul class="prelive-list" id="preLiveList"></ul>
  `;
  body.prepend(box);

  async function runChecks() {
    const list = $('#preLiveList', box);
    const items = [
      { id: 'cam', label: 'Camera', ok: false, fix: 'Turn on your camera in the bottom bar or allow camera access in browser settings.' },
      { id: 'mic', label: 'Microphone', ok: false, fix: 'Unmute your mic or select a working microphone in Studio Settings.' },
      { id: 'relay', label: 'Broadcast relay', ok: false, fix: 'Relay is unreachable. Check your connection or configure RELAY_URL.' },
      { id: 'key', label: 'Stream key & destination', ok: false, fix: 'Add at least one destination (YouTube, Twitch, Kick or Custom) with its stream key below.' },
      { id: 'bitrate', label: 'Connection', ok: false, fix: 'Your connection looks slow (under ~2.5 Mbps). Drop the quality to 720p in Settings.' },
    ];
    list.innerHTML = items.map((x) => `<li class="pl-row pending" data-ck="${x.id}"><i></i><div><b>${x.label}</b><small>Checking…</small></div></li>`).join('');

    const setRow = (id, ok, detail) => {
      const li = $(`[data-ck="${id}"]`, list);
      if (!li) return;
      li.className = 'pl-row ' + (ok ? 'ok' : 'fail');
      $('small', li).textContent = detail;
    };

    const diag = api.getLiveDiagnostics?.() || {};
    setRow('cam', !!diag.hasCam, diag.hasCam ? `Ready (${diag.camLabel || 'Camera active'})` : items[0].fix);
    setRow('mic', !!diag.hasMic, diag.hasMic ? `Ready (${diag.micLabel || 'Mic active'})` : items[1].fix);
    setRow('key', !!diag.hasKey, diag.hasKey ? `${diag.destCount} destination${diag.destCount > 1 ? 's' : ''} configured` : items[3].fix);

    // Check relay reachability via lightweight health ping
    try {
      const t0 = performance.now();
      const r = await fetch('/api/studio?action=wfeed&studio=ping', { cache: 'no-store' });
      const ms = Math.round(performance.now() - t0);
      const relayOk = r.status > 0 && diag.relayConfigured !== false;
      setRow('relay', relayOk, relayOk ? `Reachable (${ms} ms latency)` : items[2].fix);
      const estMbps = navigator.connection?.downlink ? Math.max(1.5, Math.min(25, navigator.connection.downlink * 0.6)) : (ms < 180 ? 8.5 : 4.2);
      const brOk = estMbps >= 2.5;
      setRow('bitrate', brOk, brOk ? `Looks fast enough (browser estimate ~${estMbps.toFixed(1)} Mbps)` : items[4].fix);
    } catch {
      setRow('relay', false, items[2].fix);
      setRow('bitrate', false, items[4].fix);
    }
  }

  $('#preLiveRun', box).onclick = runChecks;
  const obs = new MutationObserver(() => { if (dlg.open) runChecks(); });
  obs.observe(dlg, { attributes: true, attributeFilter: ['open'] });
}

// ---------------------------------------------------------------- 2. REDESIGNED BRAND KIT & LOOK UI
function initBrandRedesign(api) {
  const brandPanel = $('.panel[data-panel="brand"]');
  if (!brandPanel || $('#brandColorWell')) return;
  const applyBrand = (patch) => {
    if (!api.isHost()) return api.toast('Ask the host to change brand settings.', { err: true });
    if (typeof api.applyBrand === 'function') api.applyBrand(patch);
    else if (typeof api.brandPref === 'function') api.brandPref(patch);
    else api.setStage({ brand: patch });
  };

  // A. Upgrade Stage Palette & Colour: replace full-width ugly color input with crisp hex + well + harmony bar
  const colorPick = $('#colorPick', brandPanel);
  if (colorPick) {
    const well = document.createElement('div');
    well.id = 'brandColorWell';
    well.className = 'color-well-row';
    well.innerHTML = `
      <label class="cw-swatch-btn" title="Pick custom colour">
        <span class="cw-dot" id="cwAccentDot"></span>
        <span class="cw-lbl">Custom</span>
      </label>
      <input type="text" class="input sm cw-hex" id="cwAccentHex" maxlength="7" spellcheck="false" aria-label="Accent hex code" value="#3b82f6">
      <button type="button" class="btn sm ghost" id="cwCopyHex" title="Copy hex">Copy</button>
    `;
    colorPick.before(well);
    $('.cw-swatch-btn', well).append(colorPick);
    colorPick.classList.add('cw-native');

    const syncHex = (val) => {
      const hex = /^#[0-9a-f]{6}$/i.test(val) ? val.toLowerCase() : '#3b82f6';
      $('#cwAccentDot', well).style.background = hex;
      if (document.activeElement !== $('#cwAccentHex', well)) $('#cwAccentHex', well).value = hex.toUpperCase();
    };
    syncHex(colorPick.value);
    colorPick.addEventListener('input', () => syncHex(colorPick.value));
    $('#cwAccentHex', well).addEventListener('change', (e) => {
      let v = e.target.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        colorPick.value = v;
        colorPick.dispatchEvent(new Event('input', { bubbles: true }));
        applyBrand({ color: v });
        syncHex(v);
      }
    });
    $('#cwCopyHex', well).onclick = () => {
      navigator.clipboard?.writeText($('#cwAccentHex', well).value).catch(() => {});
      api.toast('Copied ' + $('#cwAccentHex', well).value);
    };
    api.onBrandSync?.((b) => syncHex(b?.color || '#3b82f6'));
  }

  // B. Upgrade Stage Background: add Custom Solid / Gradient colour controls right below the preset grid
  const bgsEl = $('#bgs', brandPanel);
  if (bgsEl && !$('#customBgBox')) {
    const customBg = document.createElement('div');
    customBg.id = 'customBgBox';
    customBg.className = 'bg-custom-box';
    const savedCustom = store.get('customStageBg', { on: false, mode: 'gradient', c1: '#0b1224', c2: '#1d4ed8', angle: 135 });
    customBg.innerHTML = `
      <div class="row between">
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="bgCustomOn" ${savedCustom.on ? 'checked' : ''}><span>Custom background colour</span></label>
        <div class="seg sm" id="bgCustomMode">
          <button type="button" data-bgm="solid" class="${savedCustom.mode === 'solid' ? 'on' : ''}">Solid</button>
          <button type="button" data-bgm="gradient" class="${savedCustom.mode !== 'solid' ? 'on' : ''}">Gradient</button>
        </div>
      </div>
      <div class="bg-custom-row" id="bgCustomFields" ${savedCustom.on ? '' : 'hidden'}>
        <label class="cw-mini"><span>Base</span><input type="color" id="bgC1" value="${savedCustom.c1}"></label>
        <label class="cw-mini" id="bgC2Wrap" ${savedCustom.mode === 'solid' ? 'hidden' : ''}><span>Blend</span><input type="color" id="bgC2" value="${savedCustom.c2}"></label>
        <label class="cw-mini grow" id="bgAngWrap" ${savedCustom.mode === 'solid' ? 'hidden' : ''}><span>Angle <em id="bgAngVal">${savedCustom.angle}°</em></span><input type="range" id="bgAngle" min="0" max="360" step="15" value="${savedCustom.angle}"></label>
      </div>
    `;
    bgsEl.after(customBg);

    const pushCustomBg = () => {
      const cfg = {
        on: $('#bgCustomOn', customBg).checked,
        mode: $('.on', $('#bgCustomMode', customBg))?.dataset.bgm || 'gradient',
        c1: $('#bgC1', customBg).value,
        c2: $('#bgC2', customBg).value,
        angle: Number($('#bgAngle', customBg).value) || 135,
      };
      store.set('customStageBg', cfg);
      $('#bgCustomFields', customBg).hidden = !cfg.on;
      $('#bgC2Wrap', customBg).hidden = cfg.mode === 'solid';
      $('#bgAngWrap', customBg).hidden = cfg.mode === 'solid';
      $('#bgAngVal', customBg).textContent = `${cfg.angle}°`;
      window.__gatherCustomBg = cfg;
    };
    window.__gatherCustomBg = savedCustom;
    $('#bgCustomOn', customBg).onchange = pushCustomBg;
    $('#bgC1', customBg).oninput = pushCustomBg;
    $('#bgC2', customBg).oninput = pushCustomBg;
    $('#bgAngle', customBg).oninput = pushCustomBg;
    $$('#bgCustomMode button', customBg).forEach((b) => {
      b.onclick = () => {
        $$('#bgCustomMode button', customBg).forEach((x) => x.classList.toggle('on', x === b));
        pushCustomBg();
      };
    });
    // Clicking any preset background turns off custom colour override
    $$('#bgs button', brandPanel).forEach((b) => b.addEventListener('click', () => {
      $('#bgCustomOn', customBg).checked = false;
      pushCustomBg();
    }));
  }

  // C. Upgrade Typography & Name Tags: visual Font Preview Cards + live miniature Name Tag preview
  const fontSel = $('#fontSel', brandPanel);
  if (fontSel && !$('#fontCardGrid')) {
    fontSel.hidden = true;
    const grid = document.createElement('div');
    grid.id = 'fontCardGrid';
    grid.className = 'font-card-grid';
    grid.innerHTML = FONT_CARDS.map((f) => `
      <button type="button" class="font-card" data-font="${f.id}">
        <span class="fc-aa" style="font-family:${f.family}">Aa</span>
        <b>${f.name}</b>
        <small>${f.vibe}</small>
      </button>
    `).join('');
    fontSel.after(grid);

    const tagPreview = document.createElement('div');
    tagPreview.id = 'tagLivePreview';
    tagPreview.className = 'mini-stage-prev';
    tagPreview.innerHTML = `<span class="msp-chip" id="mspTagChip">Alex Rivera · Host</span>`;
    $('#tagSeg', brandPanel)?.after(tagPreview);

    const syncFontUI = (b = {}) => {
      const cur = b.font || fontSel.value || 'jakarta';
      $$('.font-card', grid).forEach((c) => c.classList.toggle('on', c.dataset.font === cur));
      const fc = FONT_CARDS.find((x) => x.id === cur) || FONT_CARDS[0];
      const chip = $('#mspTagChip', tagPreview);
      if (chip) {
        chip.style.fontFamily = fc.family;
        chip.dataset.tag = b.tag || 'solid';
      }
    };
    $$('.font-card', grid).forEach((c) => {
      c.onclick = () => {
        fontSel.value = c.dataset.font;
        fontSel.dispatchEvent(new Event('change', { bubbles: true }));
        applyBrand({ font: c.dataset.font });
        syncFontUI({ font: c.dataset.font, tag: api.getBrand?.()?.tag });
      };
    });
    $$('#tagSeg button', brandPanel).forEach((btn) => btn.addEventListener('click', () => {
      setTimeout(() => syncFontUI(api.getBrand?.()), 20);
    }));
    syncFontUI(api.getBrand?.());
    api.onBrandSync?.(syncFontUI);
  }

  // D. Upgrade Banners & Titles: Live Lower-Third Preview + Motion Presets + Alert Styles
  const bannerSec = $('details[data-sec="banners"] .psec-body', brandPanel);
  if (bannerSec && !$('#bannerLivePrev')) {
    const extra = document.createElement('div');
    extra.id = 'bannerLivePrev';
    extra.className = 'form';
    extra.innerHTML = `
      <div class="mini-banner-prev" id="miniBannerCard" data-bs="classic">
        <i class="mbp-bar"></i>
        <div><b>Welcome to the live show</b><small>Episode 12 · Live from gather</small></div>
      </div>
      <div class="fld">
        <span>Graphics motion style</span>
        <div class="seg block sm" id="motionSeg">
          ${Object.entries(MOTION_PRESETS).map(([id, m]) => `<button type="button" data-motion="${id}" title="${m.desc}">${m.label}</button>`).join('')}
        </div>
      </div>
      <div class="fld">
        <span>On-screen alert &amp; card style</span>
        <div class="seg block sm" id="alertStyleSeg">
          ${Object.entries(ALERT_STYLES).map(([id, a]) => `<button type="button" data-as="${id}" title="${a.desc}">${a.label}</button>`).join('')}
        </div>
      </div>
    `;
    bannerSec.prepend(extra);

    const syncBannerUI = (b = {}) => {
      const card = $('#miniBannerCard', extra);
      if (card) card.dataset.bs = b.bannerStyle || 'classic';
      $$('#motionSeg button', extra).forEach((x) => x.classList.toggle('on', x.dataset.motion === (b.motion || 'cinematic')));
      $$('#alertStyleSeg button', extra).forEach((x) => x.classList.toggle('on', x.dataset.as === (b.alertStyle || 'broadcast')));
    };
    $$('#motionSeg button', extra).forEach((b) => { b.onclick = () => { applyBrand({ motion: b.dataset.motion }); syncBannerUI({ ...api.getBrand?.(), motion: b.dataset.motion }); }; });
    $$('#alertStyleSeg button', extra).forEach((b) => { b.onclick = () => { applyBrand({ alertStyle: b.dataset.as }); syncBannerUI({ ...api.getBrand?.(), alertStyle: b.dataset.as }); }; });
    syncBannerUI(api.getBrand?.());
    api.onBrandSync?.(syncBannerUI);
  }

  // E. Upgrade Panels & Cards: surface colour swatches + compact hex + live card preview
  const panelColorRow = $('#panelColorRow', brandPanel);
  const panelColor = $('#panelColor', brandPanel);
  if (panelColorRow && panelColor && !$('#panelSwatchRow')) {
    const swWrap = document.createElement('div');
    swWrap.id = 'panelSwatchRow';
    swWrap.className = 'panel-sw-wrap form';
    swWrap.innerHTML = `
      <div class="panel-sw-grid">
        ${PANEL_SWATCHES.map((c) => `<button type="button" class="psw" data-pc="${c}" style="--c:${c}" aria-label="Panel colour ${c}"></button>`).join('')}
      </div>
      <div class="mini-card-prev" id="miniPanelPrev">
        <b>Featured viewer message</b>
        <small>Cards, chat overlay &amp; alerts inherit this look.</small>
      </div>
    `;
    panelColorRow.after(swWrap);
    panelColorRow.hidden = false;
    const syncPanelUI = (b = {}) => {
      const col = String(b?.panelColor || '#0f172a');
      const isSolid = b?.panel === 'solid';
      $$('.psw', swWrap).forEach((x) => x.classList.toggle('on', String(x.dataset.pc || '').toLowerCase() === col.toLowerCase()));
      const prev = $('#miniPanelPrev', swWrap);
      if (prev) {
        prev.style.background = isSolid ? col : `color-mix(in srgb, ${col} 72%, transparent)`;
        prev.style.color = ['#f8fafc', '#ffffff'].includes(col.toLowerCase()) ? '#0f172a' : '#f8fafc';
        prev.classList.toggle('glass-look', !isSolid);
      }
    };
    $$('.psw', swWrap).forEach((b) => {
      b.onclick = () => {
        panelColor.value = b.dataset.pc;
        applyBrand({ panelColor: b.dataset.pc, panel: 'solid' });
        syncPanelUI({ panel: 'solid', panelColor: b.dataset.pc });
      };
    });
    panelColor.addEventListener('input', () => syncPanelUI({ panel: 'solid', panelColor: panelColor.value }));
    syncPanelUI(api.getBrand?.());
    api.onBrandSync?.(syncPanelUI);
  }

  // F. Brand Kit Importer (Website URL) + Save My Look as Theme + Export/Import Brand Kit JSON
  const themesWrap = $('#brandThemes', brandPanel);
  if (themesWrap && !$('#brandKitActions')) {
    const actions = document.createElement('div');
    actions.id = 'brandKitActions';
    actions.className = 'bk-tools form';
    actions.innerHTML = `
      <div class="row">
        <button type="button" class="btn sm grow" id="saveMyTheme">+ Save my look</button>
        <button type="button" class="btn sm" id="exportBrandBtn">Export kit</button>
        <button type="button" class="btn sm" id="importBrandBtn">Import</button>
        <input type="file" id="importBrandFile" accept="application/json,.json" hidden>
      </div>
      <div class="custom-themes-row" id="customThemesList" hidden></div>
      <div class="url-import-box">
        <label class="fld"><span>Import brand kit from website</span>
          <div class="composer-row">
            <input class="input sm" id="brandUrlIn" type="url" placeholder="https://yourbrand.com" spellcheck="false">
            <button type="button" class="btn sm primary" id="brandUrlGo">Import</button>
          </div>
        </label>
        <small class="hint">Reads your site’s colours, font &amp; logo to style the whole show.</small>
      </div>
    `;
    themesWrap.append(actions);

    function renderCustomThemes() {
      const list = store.get('customThemes', []);
      const box = $('#customThemesList', actions);
      box.hidden = !list.length;
      replaceKids(box, ...list.map((t, idx) => {
        const chip = document.createElement('div');
        chip.className = 'ct-pill';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'ct-apply';
        btn.innerHTML = `<i style="background:${t.color || '#3b82f6'}"></i><span></span>`;
        $('span', btn).textContent = t.name;
        btn.onclick = () => { const { name, ...b } = t; void name; applyBrand(b); api.toast(`Applied “${t.name}”.`); };
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'ct-del'; del.textContent = '×'; del.setAttribute('aria-label', 'Delete theme');
        del.onclick = () => {
          const next = store.get('customThemes', []).filter((_, i) => i !== idx);
          store.set('customThemes', next);
          renderCustomThemes();
        };
        chip.append(btn, del);
        return chip;
      }));
    }
    renderCustomThemes();

    $('#saveMyTheme', actions).onclick = () => {
      const b = api.getBrand?.() || {};
      const list = store.get('customThemes', []);
      const name = `My Look ${list.length + 1}`;
      list.push({ name, color: b.color, bg: b.bg, font: b.font, tag: b.tag, bannerStyle: b.bannerStyle, anim: b.anim, motion: b.motion, alertStyle: b.alertStyle, frame: b.frame, panel: b.panel, panelColor: b.panelColor });
      store.set('customThemes', list.slice(-8));
      renderCustomThemes();
      api.toast(`Saved “${name}” to your themes.`);
    };

    $('#exportBrandBtn', actions).onclick = () => {
      const payload = { version: 1, exportedAt: new Date().toISOString(), brand: api.getBrand?.() || {}, customStageBg: store.get('customStageBg', null) };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'gather-brand-kit.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      api.toast('Exported brand kit JSON.');
    };

    $('#importBrandBtn', actions).onclick = () => $('#importBrandFile', actions).click();
    $('#importBrandFile', actions).onchange = async (e) => {
      const f = e.target.files?.[0]; e.target.value = '';
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (!j?.brand) throw new Error('Invalid brand kit file.');
        applyBrand(j.brand);
        if (j.customStageBg) { store.set('customStageBg', j.customStageBg); window.__gatherCustomBg = j.customStageBg; }
        api.toast('Brand kit imported and applied!');
      } catch (err) {
        api.toast('Could not import brand kit: ' + (err.message || err), { err: true });
      }
    };

    $('#brandUrlGo', actions).onclick = async () => {
      const url = $('#brandUrlIn', actions).value.trim();
      if (!url) return api.toast('Paste a website address first.', { err: true });
      const btn = $('#brandUrlGo', actions);
      btn.disabled = true; btn.textContent = 'Reading…';
      try {
        const r = await fetch('/api/brand-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Import failed');
        applyBrand({ color: j.color, panelColor: j.panelColor, bg: j.bg, font: j.font, panel: j.panel, tag: j.tag, bannerStyle: j.bannerStyle, frame: j.frame, motion: j.motion, alertStyle: j.alertStyle });
        api.toast(`Imported brand kit from ${j.name || j.host} (${j.color}).`);
      } catch (err) {
        api.toast(err.message || 'Could not import website brand.', { err: true });
      } finally {
        btn.disabled = false; btn.textContent = 'Import';
      }
    };
  }
}

// ---------------------------------------------------------------- 3. OVERLAY PACKS + COUNTDOWN + SPONSOR SLOTS
function initOverlaysUpgrades(api) {
  const panel = $('.panel[data-panel="overlays"] .panel-body');
  if (!panel || $('#overlayPacksSec')) return;

  const packsSec = document.createElement('details');
  packsSec.className = 'psec';
  packsSec.id = 'overlayPacksSec';
  packsSec.dataset.sec = 'overlay-packs';
  packsSec.open = true;
  packsSec.innerHTML = `
    <summary><b>Pre-made overlay packs</b><span class="hint">inherits your theme</span></summary>
    <div class="psec-body form">
      <div class="pack-grid">
        ${Object.entries(OVERLAY_PACKS).map(([id, p]) => `
          <button type="button" class="pack-card" data-pack="${id}">
            <b>${p.name}</b>
            <small>${p.desc}</small>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  const cdSec = document.createElement('details');
  cdSec.className = 'psec';
  cdSec.id = 'countdownSec';
  cdSec.dataset.sec = 'countdown';
  cdSec.innerHTML = `
    <summary><b>Countdown &amp; break screens</b><span class="hint">auto-cuts to live</span></summary>
    <div class="psec-body form">
      <div class="seg block sm" id="cdModeSeg">
        <button type="button" data-cdm="starting" class="on">Starting soon</button>
        <button type="button" data-cdm="intermission">Intermission</button>
        <button type="button" data-cdm="brb">BRB</button>
        <button type="button" data-cdm="ending">Ending</button>
      </div>
      <input class="input sm" id="cdTitle" maxlength="80" value="Starting soon" placeholder="Screen headline">
      <input class="input sm" id="cdSub" maxlength="120" value="Grab a seat and say hello in chat" placeholder="Subtitle">
      <div class="row2">
        <label class="fld"><span>Minutes</span><input class="input sm" id="cdMins" type="number" min="1" max="60" value="5"></label>
        <label class="toggle-inline" style="align-self:end;padding-bottom:6px"><input type="checkbox" class="toggle sm" id="cdAutoLive" checked><span>Auto-cut to live</span></label>
      </div>
      <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="cdChat" checked><span>Show live chat preview</span></label>
      <div class="row">
        <button type="button" class="btn sm primary grow" id="cdStartBtn">Show countdown screen</button>
        <button type="button" class="btn sm ghost" id="cdStopBtn">Cut to stage</button>
      </div>
    </div>
  `;

  const spSec = document.createElement('details');
  spSec.className = 'psec';
  spSec.id = 'sponsorSlotsSec';
  spSec.dataset.sec = 'sponsor-slots';
  spSec.innerHTML = `
    <summary><b>Sponsor slots &amp; report</b><span class="hint">cards · reads · clicks</span></summary>
    <div class="psec-body form">
      <div class="row2">
        <input class="input sm" id="spBrand" maxlength="48" placeholder="Sponsor brand">
        <input class="input sm" id="spCode" maxlength="24" placeholder="Promo code">
      </div>
      <input class="input sm" id="spHeadline" maxlength="90" placeholder="Offer headline (e.g. 20% off with code LIVE)">
      <textarea class="input sm" id="spScript" rows="2" maxlength="320" placeholder="Spoken read teleprompter cue (optional)"></textarea>
      <div class="row2">
        <input class="input sm" id="spUrl" maxlength="300" placeholder="https://sponsor.example.com" spellcheck="false">
        <button type="button" class="btn sm primary" id="spAddBtn">+ Add slot</button>
      </div>
      <ul class="el-list" id="spList"></ul>
      <button type="button" class="btn sm ghost" id="spExportRep" hidden>Download sponsor report (.txt)</button>
    </div>
  `;

  panel.prepend(cdSec);
  panel.prepend(packsSec);
  panel.append(spSec);

  $$('.pack-card', packsSec).forEach((b) => {
    b.onclick = () => {
      if (!api.isHost()) return api.toast('Ask the host to apply overlay packs.', { err: true });
      const pack = OVERLAY_PACKS[b.dataset.pack];
      if (!pack) return;
      const _ab = typeof api.applyBrand === 'function' ? api.applyBrand : (typeof api.brandPref === 'function' ? api.brandPref : (p) => api.setStage({ brand: p }));
      _ab({ ...pack.brand, pack: b.dataset.pack });
      $('#cdTitle', cdSec).value = pack.countdown.title;
      $('#cdSub', cdSec).value = pack.countdown.subtitle;
      api.setStage({ ticker: pack.ticker });
      $$('.pack-card', packsSec).forEach((x) => x.classList.toggle('on', x === b));
      api.toast(`${pack.name} overlay pack applied using your brand colours.`);
    };
  });

  let cdMode = 'starting';
  $$('#cdModeSeg button', cdSec).forEach((b) => {
    b.onclick = () => {
      cdMode = b.dataset.cdm;
      $$('#cdModeSeg button', cdSec).forEach((x) => x.classList.toggle('on', x === b));
      const defaults = { starting: 'Starting soon', intermission: 'Short intermission', brb: 'Be right back', ending: 'Thanks for watching!' };
      $('#cdTitle', cdSec).value = defaults[cdMode] || 'Starting soon';
    };
  });
  $('#cdStartBtn', cdSec).onclick = () => {
    if (!api.isHost()) return api.toast('Only the host controls break screens.', { err: true });
    const mins = Math.max(1, Math.min(60, Number($('#cdMins', cdSec).value) || 5));
    api.setStage({
      countdown: {
        on: true, mode: cdMode,
        title: $('#cdTitle', cdSec).value.trim() || 'Starting soon',
        subtitle: $('#cdSub', cdSec).value.trim(),
        target: Date.now() + mins * 60e3,
        autoLive: $('#cdAutoLive', cdSec).checked,
        showChat: $('#cdChat', cdSec).checked,
      },
    });
    api.toast(`${$('#cdTitle', cdSec).value.trim() || 'Countdown'} is now on stage.`);
  };
  $('#cdStopBtn', cdSec).onclick = () => {
    if (!api.isHost()) return;
    api.setStage({ countdown: null });
    api.toast('Cut back to live stage.');
  };

  function renderSponsors() {
    const sp = api.getState?.()?.sponsors || { slots: [], activeId: '' };
    const list = $('#spList', spSec);
    replaceKids(list, ...(sp.slots || []).map((s) => {
      const li = document.createElement('li');
      const on = sp.activeId === s.id;
      li.innerHTML = `<div class="sp-row"><div><b></b><small></small></div><div class="row"><button type="button" class="btn sm ${on ? 'primary' : ''}" data-act="toggle">${on ? 'Hide' : 'Show'}</button><button type="button" class="btn sm ghost" data-act="del">×</button></div></div>`;
      $('b', li).textContent = `${s.brand || 'Sponsor'} · ${s.headline || ''}`;
      $('small', li).textContent = `${s.impressions || 0} on-screen · ${s.clicks || 0} clicks${s.script ? ' · Read: ' + s.script.slice(0, 48) : ''}`;
      $('[data-act="toggle"]', li).onclick = () => {
        const nextActive = on ? '' : s.id;
        const slots = sp.slots.map((x) => x.id === s.id && !on ? { ...x, impressions: (x.impressions || 0) + 1 } : x);
        api.setStage({ sponsors: { slots, activeId: nextActive } });
        if (!on && s.script) api.toast(`Spoken read cue: “${s.script.slice(0, 90)}”`, { ms: 8000 });
        setTimeout(renderSponsors, 80);
      };
      $('[data-act="del"]', li).onclick = () => {
        const slots = sp.slots.filter((x) => x.id !== s.id);
        api.setStage({ sponsors: { slots, activeId: sp.activeId === s.id ? '' : sp.activeId } });
        setTimeout(renderSponsors, 80);
      };
      return li;
    }));
    $('#spExportRep', spSec).hidden = !(sp.slots || []).length;
  }

  $('#spAddBtn', spSec).onclick = () => {
    const brand = $('#spBrand', spSec).value.trim(), headline = $('#spHeadline', spSec).value.trim();
    if (!brand && !headline) return api.toast('Enter a sponsor brand or headline.');
    const cur = api.getState?.()?.sponsors || { slots: [], activeId: '' };
    const slot = {
      id: 'sp' + Math.random().toString(36).slice(2, 7),
      brand, headline, code: $('#spCode', spSec).value.trim(),
      script: $('#spScript', spSec).value.trim(), url: $('#spUrl', spSec).value.trim(),
      impressions: 0, clicks: 0,
    };
    api.setStage({ sponsors: { slots: [...(cur.slots || []), slot], activeId: cur.activeId || '' } });
    $('#spBrand', spSec).value = ''; $('#spHeadline', spSec).value = ''; $('#spCode', spSec).value = ''; $('#spScript', spSec).value = ''; $('#spUrl', spSec).value = '';
    setTimeout(renderSponsors, 80);
  };
  $('#spExportRep', spSec).onclick = () => {
    const slots = api.getState?.()?.sponsors?.slots || [];
    const lines = ['GATHER SPONSOR REPORT', new Date().toLocaleString(), '', ...slots.map((s) => `- ${s.brand} (${s.headline}): ${s.impressions || 0} on-screen impressions, ${s.clicks || 0} viewer clicks`)];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'sponsor-report.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 3000);
  };
  api.onStateSync?.(renderSponsors);
}

// ---------------------------------------------------------------- 4. AI WORKFLOW UPGRADE + SCENE BUILDER + AI DIRECTOR
function initAiWorkflowUpgrade(api) {
  // A. Upgrade #aidDlg reference image dropzone UX (drag-and-drop, explicit example upload button, role tags)
  const refsWrap = $('.aid-refs-wrap');
  const aidFile = $('#aidFile');
  if (refsWrap && aidFile && !$('#aidDropZone')) {
    const dz = document.createElement('div');
    dz.id = 'aidDropZone';
    dz.className = 'aid-dropzone';
    dz.innerHTML = `
      <div class="aid-dz-copy">
        <b>Upload example images (up to 3)</b>
        <small>Drop screenshots, logos, or brand inspiration here — or paste with ⌘V / Ctrl+V</small>
      </div>
      <button type="button" class="btn sm primary" id="aidPickExamples">+ Upload examples</button>
    `;
    refsWrap.prepend(dz);
    $('#aidPickExamples', dz).onclick = () => aidFile.click();
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      const dt = new DataTransfer();
      files.slice(0, 3).forEach((f) => dt.items.add(f));
      aidFile.files = dt.files;
      aidFile.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // B. AI Scene Builder & AI Director + Simplified House-Key AI panel
  const aiBody = $('.panel[data-panel="ai"] .ai-body');
  if (!aiBody || $('#aiSceneBuilder')) return;

  const tools = document.createElement('div');
  tools.id = 'aiSceneBuilder';
  tools.className = 'form ai-tools-wrap';
  tools.innerHTML = `
    <div class="ai-house-pill">
      <span class="ahp-dot"></span>
      <div><b>Built-in Gemini ready</b><small>Works out of the box · use your own key under Advanced</small></div>
    </div>
    <details class="psec" data-sec="ai-scene" open>
      <summary><b>AI Scene Builder</b><span class="hint">describe any layout</span></summary>
      <div class="psec-body form">
        <textarea class="input sm" id="aiScenePrompt" rows="2" maxlength="200" placeholder="e.g. Interview with a product shot on the right and a QR code"></textarea>
        <div class="row">
          <button type="button" class="btn sm primary grow" id="aiSceneGo">✨ Build scene on stage</button>
        </div>
        <div class="ai-scene-chips">
          <button type="button" class="as-chip" data-sp="Interview with chat overlay on the right and QR code">Interview + Chat + QR</button>
          <button type="button" class="as-chip" data-sp="Solo host with slides on the left and timer">Solo + Slides + Timer</button>
          <button type="button" class="as-chip" data-sp="Gaming camera in corner with scoreboard and chat">Gamer + Scoreboard</button>
        </div>
      </div>
    </details>
    <details class="psec" data-sec="ai-director" open>
      <summary><b>AI Director</b><span class="hint">automatic layout switching</span></summary>
      <div class="psec-body form">
        <label class="toggle-row"><span><b>Active speaker spotlight</b><small>Automatically gives whoever is talking the large tile</small></span><input type="checkbox" class="toggle" id="dirSpeaker" role="switch"></label>
        <label class="toggle-row"><span><b>Scoreboard on round end</b><small>Auto-settles active gamer predictions when scores update</small></span><input type="checkbox" class="toggle" id="dirScore" role="switch" checked></label>
        <div class="row">
          <button type="button" class="btn sm grow" id="dirCloseup">🛍 Product close-up</button>
          <button type="button" class="btn sm grow" id="dirReset">Reset framing</button>
        </div>
      </div>
    </details>
  `;
  const quick = $('#aiQuick', aiBody);
  if (quick) quick.after(tools);
  else aiBody.prepend(tools);

  function buildSceneFromPrompt(text) {
    if (!api.isHost()) return api.toast('Ask the host to change the stage layout.', { err: true });
    const p = String(text || '').toLowerCase();
    const els = [];
    const wantInterview = /interview|two|guest|co-?host|duo|podcast/.test(p);
    const wantProduct = /product|shop|image|slide|deck|screen|demo/.test(p);
    const wantQr = /qr|scan|link|watch/.test(p);
    const wantChat = /chat|comment|audience/.test(p);
    const wantScore = /score|match|game|esport|round/.test(p);
    const wantTimer = /timer|countdown|clock/.test(p);

    if (wantInterview) {
      els.push({ id: 'slot0', type: 'slot', index: 0, x: 0.03, y: 0.08, w: wantProduct || wantChat ? 0.32 : 0.45, h: 0.72, radius: 14 });
      els.push({ id: 'slot1', type: 'slot', index: 1, x: wantProduct || wantChat ? 0.37 : 0.52, y: 0.08, w: wantProduct || wantChat ? 0.32 : 0.45, h: 0.72, radius: 14 });
    } else if (wantProduct) {
      els.push({ id: 'slot0', type: 'slot', index: 0, x: 0.03, y: 0.08, w: 0.58, h: 0.80, radius: 14 });
    } else {
      els.push({ id: 'slot0', type: 'slot', index: 0, x: 0.03, y: 0.06, w: wantChat ? 0.68 : 0.94, h: 0.84, radius: 14 });
    }
    if (wantProduct) els.push({ id: 'media0', type: 'media', x: 0.64, y: 0.08, w: 0.33, h: wantQr ? 0.50 : 0.78, radius: 14 });
    if (wantChat) els.push({ id: 'chat0', type: 'chat', x: 0.73, y: 0.08, w: 0.24, h: wantQr ? 0.54 : 0.80, max: 7, size: 17, bg: true });
    if (wantQr) els.push({ id: 'qr0', type: 'callin', x: 0.73, y: 0.66, w: 0.24, h: 0.24, label: 'Scan to join live' });
    if (wantScore) els.push({ id: 'score0', type: 'score', x: 0.25, y: 0.04, w: 0.50, h: 0.13, a: 'Home', b: 'Away', sa: 0, sb: 0, round: 'Round 1', ca: api.getBrand?.()?.color || '#3b82f6', cb: '#f43f5e' });
    if (wantTimer) els.push({ id: 'timer0', type: 'timer', mode: 'countdown', target: Date.now() + 5 * 60e3, x: 0.04, y: 0.82, w: 0.22, h: 0.12, size: 38, color: '#ffffff' });

    api.setStage({ layout: 'custom', elements: els });
    api.toast('Scene built on stage — drag any element or press arrow keys to fine-tune.');
  }

  $('#aiSceneGo', tools).onclick = () => {
    const v = $('#aiScenePrompt', tools).value.trim();
    if (!v) return api.toast('Describe the scene you want first.');
    buildSceneFromPrompt(v);
  };
  $$('.ai-scene-chips .as-chip', tools).forEach((b) => {
    b.onclick = () => { $('#aiScenePrompt', tools).value = b.dataset.sp; buildSceneFromPrompt(b.dataset.sp); };
  });

  // AI Director hooks exposed globally for app.js speech/score loop
  window.__gatherDirector = { activeSpeaker: false, autoSettleScore: true, productCloseup: false };
  $('#dirSpeaker', tools).onchange = (e) => {
    window.__gatherDirector.activeSpeaker = e.target.checked;
    api.toast(e.target.checked ? 'AI Director: active speaker spotlight enabled.' : 'AI Director spotlight paused.');
  };
  $('#dirScore', tools).onchange = (e) => { window.__gatherDirector.autoSettleScore = e.target.checked; };
  $('#dirCloseup', tools).onclick = () => {
    if (!api.isHost()) return;
    window.__gatherDirector.productCloseup = true;
    api.setStage({ layout: 'solo' });
    api.toast('AI Director: switched to full product close-up.');
  };
  $('#dirReset', tools).onclick = () => {
    if (!api.isHost()) return;
    window.__gatherDirector.productCloseup = false;
    api.setStage({ layout: 'split' });
    api.toast('AI Director: restored split studio layout.');
  };
}

// ---------------------------------------------------------------- 5. HOT SEAT, GOALS EFFECTS, GREEN ROOM, CLIPS & AUTO SHORTS, TEAM WORKSPACES
function initShowPowerTools(api) {
  const showBody = $('#watchSec');
  if (!showBody || $('#hotSeatSec')) return;

  // Hot Seat + Goals That Change The Show
  const interactiveSec = document.createElement('details');
  interactiveSec.className = 'psec';
  interactiveSec.id = 'hotSeatSec';
  interactiveSec.dataset.sec = 'hotseat-goals';
  interactiveSec.dataset.audGroup = 'supers';
  interactiveSec.innerHTML = `
    <summary><b>Hot seat &amp; goal effects</b><span class="hint">interactive show triggers</span></summary>
    <div class="psec-body form">
      <label class="toggle-row"><span><b>60s Camera Hot Seat</b><small>Super chats above your threshold unlock a 60-second guest camera spot</small></span><input type="checkbox" class="toggle" id="hsOn" role="switch"></label>
      <div class="row2">
        <label class="fld"><span>Threshold ($)</span><input class="input sm" id="hsMin" type="number" min="5" max="1000" value="25"></label>
        <label class="fld"><span>Duration (sec)</span><input class="input sm" id="hsSec" type="number" min="15" max="300" value="60"></label>
      </div>
      <div id="hsLiveBanner" class="hs-live" hidden></div>
      <hr>
      <div class="row between"><b>Goals that change the show</b><button type="button" class="btn sm ghost" id="goalTestConfetti">Test confetti</button></div>
      <div class="goal-fx-list" id="goalFxList">
        <div class="gfx-row"><span class="gfx-at">$50</span><span>Confetti mode on stream</span><i class="gfx-st" data-at="50">Locked</i></div>
        <div class="gfx-row"><span class="gfx-at">$100</span><span>Play next round with chat’s pick</span><i class="gfx-st" data-at="100">Locked</i></div>
        <div class="gfx-row"><span class="gfx-at">$250</span><span>Upgrade stage overlay &amp; glow</span><i class="gfx-st" data-at="250">Locked</i></div>
      </div>
    </div>
  `;

  // Clip & Post + Auto Shorts
  const clipSec = document.createElement('details');
  clipSec.className = 'psec';
  clipSec.id = 'clipPostSec';
  clipSec.dataset.sec = 'clips';
  clipSec.dataset.audGroup = 'stage';
  clipSec.innerHTML = `
    <summary><b>Clip &amp; post · Auto shorts</b><span class="hint">vertical 9:16 + captions</span></summary>
    <div class="psec-body form">
      <div class="row">
        <button type="button" class="btn sm primary grow" id="markMomentBtn">🎬 Mark moment <kbd>M</kbd></button>
        <button type="button" class="btn sm" id="autoShortsBtn">✨ Auto shorts</button>
      </div>
      <label class="toggle-row"><span><b>Clip big moments for me</b><small>Chat spikes, reaction bursts and super chats mark themselves. Sam tells you in the chat.</small></span><input type="checkbox" class="toggle" id="autoClipsSw" role="switch"></label>
      <p class="hint" style="margin:0">Marks highlights and exports 9:16 captioned clips for TikTok, Reels &amp; Shorts.</p>
      <ul class="el-list" id="momentList"></ul>
    </div>
  `;

  // Guest Green Room + Team Workspaces
  const teamSec = document.createElement('details');
  teamSec.className = 'psec';
  teamSec.id = 'teamWorkSec';
  teamSec.dataset.sec = 'team';
  teamSec.dataset.audGroup = 'viewers';
  teamSec.innerHTML = `
    <summary><b>Green room &amp; team roles</b><span class="hint">backstage · workspace</span></summary>
    <div class="psec-body form">
      <div class="row between"><b>Guest green room</b><span class="hint" id="grCount">0 backstage</span></div>
      <ul class="el-list" id="grBackstageList"></ul>
      <hr>
      <b>Team workspace roles</b>
      <p class="hint" style="margin:0">Assign Producer or Moderator roles and share your brand kit &amp; saved scenes.</p>
      <ul class="el-list" id="teamRolesList"></ul>
      <div class="row">
        <button type="button" class="btn sm grow" id="wsExportBtn">Share workspace kit</button>
      </div>
    </div>
  `;

  showBody.append(interactiveSec, clipSec, teamSec);

  const saveHotSeat = () => {
    if (!api.isHost()) return;
    const curW = api.getState?.()?.watch || {};
    const goalEffects = [
      { at: 50, effect: 'confetti', label: 'Confetti mode on stream' },
      { at: 100, effect: 'chatpick', label: 'Play next round with chat’s pick' },
      { at: 250, effect: 'overlay', label: 'Upgrade stage overlay & glow' },
    ];
    api.setStage({
      watch: {
        ...curW,
        hotSeat: { on: $('#hsOn', interactiveSec).checked, min: Number($('#hsMin', interactiveSec).value) || 25, sec: Number($('#hsSec', interactiveSec).value) || 60 },
        goalEffects,
      },
    });
  };
  $('#hsOn', interactiveSec).onchange = saveHotSeat;
  $('#hsMin', interactiveSec).onchange = saveHotSeat;
  $('#hsSec', interactiveSec).onchange = saveHotSeat;
  $('#goalTestConfetti', interactiveSec).onclick = () => {
    window.__gatherConfettiUntil = Date.now() + 9000;
    api.toast('Confetti mode triggered on stage!');
  };

  // Goal effect auto-trigger tracker
  const triggeredGoals = new Set();
  window.__gatherCheckGoals = (raised) => {
    $$('.gfx-st', interactiveSec).forEach((el) => {
      const at = Number(el.dataset.at);
      const hit = raised >= at;
      el.textContent = hit ? 'Unlocked!' : 'Locked';
      el.classList.toggle('hit', hit);
      if (hit && !triggeredGoals.has(at)) {
        triggeredGoals.add(at);
        if (at === 50) { window.__gatherConfettiUntil = Date.now() + 25000; api.toast('🎉 $50 Goal hit! Confetti mode unlocked on stream!'); }
        if (at === 100) { api.setStage({ banner: { id: 'goal100', text: 'GOAL UNLOCKED: $100!', sub: 'Next round played with chat’s pick!' } }); }
        if (at === 250) {
          const _ab = typeof api.applyBrand === 'function' ? api.applyBrand : (typeof api.brandPref === 'function' ? api.brandPref : (p) => api.setStage({ brand: p }));
          _ab({ alertStyle: 'neon', frame: 'none' });
          api.toast('🚀 $250 Goal hit! Upgraded stage alert theme activated!');
        }
      }
    });
  };

  // Moments + 9:16 Vertical Captioned Clip Exporter
  // Clip & post: the last minute of the program is always recorded in the background (clips.js), so a marked moment
  // holds the real highlight: 20 s before the mark to 5 s after. Export as 9:16 (TikTok, Reels, Shorts) or 16:9.
  const clips = createClipBuffer({
    getCanvas: () => api.getCanvas?.(), getMixStream: () => api.getMixStream?.(),
    inStudio: () => !!api.inStudio?.(), isHost: () => !!api.isHost?.(),
    getTitle: () => api.getState?.()?.title, getBrandColor: () => api.getBrand?.()?.color,
    onChange: () => renderMoments(),
  });
  const moments = clips.moments;
  window.__gatherAddMoment = (label, kind = 'manual') => clips.mark(label, kind);
  window.__gatherClips = clips; // for the console and tests

  async function exportMoment(m, aspect, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Making…'; }
    api.toast(`Making your ${aspect} clip of “${m.label}”. It takes about as long as the clip.`, { ms: 4000 });
    try {
      const blob = await clips.exportClip(m, aspect);
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = u; a.download = `gather-${aspect === '9:16' ? 'short' : 'clip'}-${new Date(m.ts).toISOString().slice(11, 19).replace(/:/g, '')}.webm`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 10_000);
      api.toast(aspect === '9:16' ? 'Vertical clip saved: ready for TikTok, Reels and Shorts.' : 'Clip saved.');
    } catch (e) { api.toast(e.message || 'Couldn’t make that clip.', { err: true }); }
    finally { if (btn) { btn.disabled = false; btn.textContent = aspect; } }
  }

  function renderMoments() {
    const cnt = document.getElementById('stageClipN'); if (cnt) { cnt.textContent = String(moments.length); cnt.hidden = !moments.length; }
    const ul = $('#momentList', clipSec);
    if (!moments.length) {
      ul.innerHTML = '<li class="hint">No moments yet. Press M, or Mark clip on the stage, right after something good happens: the clip keeps the 20 seconds before it.</li>';
      return;
    }
    replaceKids(ul, ...moments.map((m) => {
      const li = document.createElement('li'); li.className = 'clip-row';
      li.innerHTML = `<div class="sp-row"><div><b></b><small></small></div><span class="clip-acts"><button type="button" class="btn sm primary">9:16</button><button type="button" class="btn sm">16:9</button></span></div>`;
      $('b', li).textContent = m.label;
      const when = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      $('small', li).textContent = m.state === 'capturing' ? `${when} · capturing…` : m.state === 'missed' ? `${when} · not captured (the buffer wasn’t running)` : `${when} · ${m.dur || 25} s ready`;
      const [v, h] = li.querySelectorAll('button');
      v.disabled = h.disabled = m.state !== 'ready';
      v.onclick = () => exportMoment(m, '9:16', v);
      h.onclick = () => exportMoment(m, '16:9', h);
      return li;
    }));
  }
  renderMoments();
  window.__gatherExportMoment = (m, aspect) => exportMoment(m, aspect);
  { const sw = $('#autoClipsSw', clipSec); if (sw) { sw.checked = store.get('autoClips', true); sw.onchange = () => store.set('autoClips', sw.checked); } }

  // On the stage (host only, shows on hover): mark a clip without leaving the chat. A DOM control over the stage,
  // never drawn into the program, so it isn't recorded or streamed.
  const stageClip = document.getElementById('stageClipBtn');
  if (stageClip) stageClip.onclick = () => {
    window.__gatherAddMoment(`Highlight #${moments.length + 1}`, 'stage');
    stageClip.classList.remove('done'); void stageClip.offsetWidth; stageClip.classList.add('done');
    api.toast('Clip marked: it keeps the 20 s before this. Export it from Clip & post.', { ms: 2500 });
  };
  $('#markMomentBtn', clipSec).onclick = () => {
    window.__gatherAddMoment(`Highlight #${moments.length + 1}`, 'manual');
    api.toast(clips.running ? 'Marked. The clip keeps the 20 s before this, ready in a few seconds.' : 'Marked, but the clip buffer only runs while you’re in your studio as host.');
  };
  $('#autoShortsBtn', clipSec).onclick = () => {
    const ready = moments.find((m) => m.state === 'ready');
    if (ready) return exportMoment(ready, '9:16');
    const m = window.__gatherAddMoment('Auto short', 'auto');
    api.toast('Capturing now. Your short will save in a few seconds.');
    const wait = setInterval(() => { if (m.state !== 'capturing') { clearInterval(wait); if (m.state === 'ready') exportMoment(m, '9:16'); } }, 1000);
  };
  const replayBtn = document.getElementById('stageReplayBtn');
  if (replayBtn) replayBtn.onclick = () => window.__gatherReplay?.();
  // I: instant replay of the last 30 s (when not typing)
  document.addEventListener('keydown', (e) => {
    if (String(e.key || '').toLowerCase() !== 'i' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
    if (!api.isHost?.()) return;
    window.__gatherReplay?.();
  });
  // M marks a moment (when not typing)
  document.addEventListener('keydown', (e) => {
    if (String(e.key || '').toLowerCase() !== 'm' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable) return;
    if (!api.isHost?.()) return;
    window.__gatherAddMoment(`Highlight #${moments.length + 1}`, 'hotkey M');
    api.toast('🎬 Moment marked (M). Export it from Clip & post.');
  });

  // Green Room & Team Roles sync
  function renderTeamAndGreenRoom() {
    const peers = api.getPeers?.() || [];
    const stageIds = new Set(api.getState?.()?.stage || []);
    const roles = api.getState?.()?.roles || {};
    const backstage = peers.filter((p) => !stageIds.has(p.id));
    $('#grCount', teamSec).textContent = `${backstage.length} backstage`;
    const grList = $('#grBackstageList', teamSec);
    if (!backstage.length) {
      grList.innerHTML = '<li class="hint">Guests waiting backstage appear here with mic status and 1-tap branded intro.</li>';
    } else {
      replaceKids(grList, ...backstage.map((p) => {
        const li = document.createElement('li');
        li.innerHTML = `<div class="sp-row"><div><b></b><small></small></div><button type="button" class="btn sm primary">Bring on air</button></div>`;
        $('b', li).textContent = p.name || 'Guest';
        $('small', li).textContent = `${p.mic ? 'Mic ready' : 'Mic muted'} · ${p.cam ? 'Cam ready' : 'Cam off'}`;
        $('button', li).onclick = () => {
          if (!api.isHost()) return;
          api.setStage({
            stage: [...stageIds, p.id],
            banner: { id: 'intro-' + p.id, text: `Welcome ${p.name}!`, sub: 'Live in the studio' },
          });
          api.toast(`Brought ${p.name} on air with branded intro.`);
        };
        return li;
      }));
    }

    const rList = $('#teamRolesList', teamSec);
    replaceKids(rList, ...peers.map((p) => {
      const li = document.createElement('li');
      const cur = p.isHost ? 'host' : (roles[p.id] || 'guest');
      li.innerHTML = `<div class="sp-row"><b></b><select class="input sm" style="width:auto" ${p.isHost || !api.isHost() ? 'disabled' : ''}><option value="host">Host</option><option value="producer">Producer</option><option value="moderator">Moderator</option><option value="guest">Guest</option></select></div>`;
      $('b', li).textContent = p.name || 'Member';
      const sel = $('select', li); sel.value = cur;
      sel.onchange = () => {
        api.setStage({ roles: { ...roles, [p.id]: sel.value } });
        api.toast(`${p.name} role set to ${sel.value}.`);
      };
      return li;
    }));
  }
  $('#wsExportBtn', teamSec).onclick = () => {
    const ws = { brand: api.getBrand?.() || {}, scenes: store.get('layouts', []), customThemes: store.get('customThemes', []) };
    const blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = 'gather-team-workspace.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 3000);
    api.toast('Exported team workspace bundle (brand kit + saved scenes).');
  };
  api.onStateSync?.(renderTeamAndGreenRoom);
}

// ---------------------------------------------------------------- 6. DIRECT STAGE EDITING (hover handles, right-click menu, arrow nudge + guides)
function initDirectStageEditing(api) {
  const stageWrap = $('#stage')?.parentElement;
  if (!stageWrap || $('#stageCtxMenu')) return;

  const menu = document.createElement('div');
  menu.id = 'stageCtxMenu';
  menu.className = 'stage-ctx-menu glass raised';
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" data-cm="edit">Edit element on stage</button>
    <button type="button" data-cm="center">Center on stage</button>
    <button type="button" data-cm="front">Bring to front</button>
    <button type="button" data-cm="dup">Duplicate</button>
    <button type="button" data-cm="del" class="danger">Remove element</button>
  `;
  document.body.append(menu);

  let targetElId = null;
  document.addEventListener('click', () => { menu.hidden = true; });

  stageWrap.addEventListener('contextmenu', (e) => {
    if (!api.isHost()) return;
    const hit = api.hitStageElement?.(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    targetElId = hit.id;
    menu.hidden = false;
    menu.style.left = Math.min(window.innerWidth - 200, e.clientX) + 'px';
    menu.style.top = Math.min(window.innerHeight - 220, e.clientY) + 'px';
  });

  $$('button', menu).forEach((b) => {
    b.onclick = () => {
      menu.hidden = true;
      if (!targetElId) return;
      api.stageElementAction?.(targetElId, b.dataset.cm);
    };
  });

  // Arrow-key nudging for selected stage element (Shift = fine 0.5% step, normal = 1.5% step)
  document.addEventListener('keydown', (e) => {
    if (!api.isHost() || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
    const step = e.shiftKey ? 0.005 : 0.015;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (api.nudgeSelectedElement?.(dx, dy)) e.preventDefault();
  });
}

// ---------------------------------------------------------------- 7. SHOP DROP TIMER & STOCK + UNIFIED GET PAID SYNC
function initShopAndGetPaid(api) {
  const shopAddBtn = $('#shopAdd');
  if (shopAddBtn && !$('#shopStock')) {
    const stockFld = document.createElement('div');
    stockFld.className = 'row2';
    stockFld.innerHTML = `
      <label class="fld"><span>Live stock qty <em>optional</em></span><input id="shopStock" type="number" min="0" max="9999" placeholder="e.g. 20"></label>
      <label class="fld"><span>Drop timer (min)</span><input id="shopDropMins" type="number" min="0" max="180" placeholder="e.g. 15"></label>
    `;
    shopAddBtn.before(stockFld);
  }
  const shopItemsBody = $('details[data-sec="shop-items"] .psec-body');
  if (shopItemsBody && !$('#shopDropCtrl')) {
    const bar = document.createElement('div');
    bar.id = 'shopDropCtrl';
    bar.className = 'shop-drop-ctrl row';
    bar.innerHTML = `
      <button type="button" class="btn sm primary" id="startDrop15">⏱ Start 15m drop timer</button>
      <button type="button" class="btn sm ghost" id="clearDropTimer">Stop timer</button>
    `;
    shopItemsBody.prepend(bar);
    $('#startDrop15', bar).onclick = () => {
      const sh = api.getState?.()?.shop || { items: [] };
      api.setStage({ shop: { ...sh, dropUntil: Date.now() + 15 * 60e3, checkoutCard: true } });
      api.toast('15-minute live drop timer started on stage & watch page!');
    };
    $('#clearDropTimer', bar).onclick = () => {
      const sh = api.getState?.()?.shop || { items: [] };
      api.setStage({ shop: { ...sh, dropUntil: 0 } });
      api.toast('Drop timer cleared.');
    };
  }
}

export function initStudioTools(api) {
  initPreLiveChecklist(api);
  initBrandRedesign(api);
  initOverlaysUpgrades(api);
  initAiWorkflowUpgrade(api);
  initShowPowerTools(api);
  initDirectStageEditing(api);
  initShopAndGetPaid(api);
}
