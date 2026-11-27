// Modular studio upgrades for gather:
// - Pre-live Go Live checklist (camera, mic, relay, stream key, bitrate) with 1-line fixes
// - Redesigned Brand Kit UI (custom stage bg solid/gradient, visual font cards, live previews,
//   Save My Look as a theme, Export/Import Brand Kit JSON, Website Brand Kit Importer, Motion Presets,
//   Alert Styles, 6 Pre-made Overlay Packs, Countdown Starting Screen)
// - Upgraded AI Designer workflow with Drag & Drop Reference Example Images (up to 3) + AI Scene Builder + AI Director
// - Direct Stage Editing (hover outline, right-click menu, keyboard nudging with alignment guides)
// - Hot Seat (super chat -> 60s on stage), Goals That Change The Show, Sponsor Slots & Report,
//   Guest Green Room, Clip & Post / Auto Shorts (9:16 vertical), and Team Workspaces & Roles.

import { MOTION_PRESETS, ALERT_STYLES, OVERLAY_PACKS, renderAiCountdownBg } from './stage-theme.js';
import { replaceKids } from './ui.js';
import { createClipBuffer } from './clips.js';
import { createGeminiLiveClient } from './gemini-live.js';
import { initSmartHighlightsPlaylist } from './smart-highlights.js?v=20261126h';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('gather:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gather:' + k, JSON.stringify(v)); } catch {} },
};

const FONT_CARDS = [
  { id: 'jakarta', name: 'Jakarta', vibe: 'Clean modern', family: "'Plus Jakarta Sans', sans-serif" },
  { id: 'onest', name: 'Onest', vibe: 'Friendly round', family: "'Onest', sans-serif" },
  { id: 'playfair', name: 'Playfair', vibe: 'Editorial serif', family: "'Playfair Display', serif" },
  { id: 'serif', name: 'DM Serif', vibe: 'Warm classic', family: "'DM Serif Display', serif" },
  { id: 'bebas', name: 'Bebas', vibe: 'Bold headlines', family: "'Bebas Neue', sans-serif" },
  { id: 'mono', name: 'JetBrains', vibe: 'Technical mono', family: "'JetBrains Mono', monospace" },
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
function relLum(hex = '#3b82f6') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = parseInt(m ? m[1] : '3b82f6', 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrastRatio(hexA, hexB) {
  const l1 = relLum(hexA), l2 = relLum(hexB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function initBrandRedesign(api) {
  const brandPanel = $('.panel[data-panel="brand"]');
  if (!brandPanel || $('#brandColorWell')) return;
  const applyBrand = (patch) => {
    if (!api.isHost()) return api.toast('Ask the host to change brand settings.', { err: true });
    if (typeof api.applyBrand === 'function') api.applyBrand(patch);
    else if (typeof api.brandPref === 'function') api.brandPref(patch);
    else api.setStage({ brand: patch });
  };

  // Eagerly trigger font face loading so Typography preview cards render in real fonts immediately
  try {
    if (document.fonts?.load) {
      FONT_CARDS.forEach((f) => {
        document.fonts.load(`700 22px ${f.family}`).catch(() => {});
        document.fonts.load(`600 14px ${f.family}`).catch(() => {});
      });
    }
  } catch {}

  // A. Upgrade Stage Palette & Colour: crisp hex well + contrast readability indicator
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
      <span class="cw-contrast num" id="cwContrast" title="WCAG contrast ratio on button ink">AA</span>
      <button type="button" class="btn sm ghost" id="cwCopyHex" title="Copy hex">Copy</button>
    `;
    colorPick.before(well);
    $('.cw-swatch-btn', well).append(colorPick);
    colorPick.classList.add('cw-native');

    const syncHex = (val) => {
      const hex = /^#[0-9a-f]{6}$/i.test(val) ? val.toLowerCase() : '#3b82f6';
      $('#cwAccentDot', well).style.background = hex;
      if (document.activeElement !== $('#cwAccentHex', well)) $('#cwAccentHex', well).value = hex.toUpperCase();
      const crWhite = contrastRatio(hex, '#ffffff');
      const crDark = contrastRatio(hex, '#0b1020');
      const best = Math.max(crWhite, crDark);
      const badge = $('#cwContrast', well);
      if (badge) {
        badge.textContent = `${best.toFixed(1)}:1`;
        badge.classList.toggle('is-good', best >= 4.5);
        badge.dataset.tip = best >= 4.5 ? 'High contrast — passes WCAG AA' : 'Moderate contrast — readable on bold labels';
      }
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

  // B. Upgrade Stage Background: Custom Solid / Gradient colour controls with live strip preview
  const bgsEl = $('#bgs', brandPanel);
  if (bgsEl && !$('#customBgBox')) {
    const customBg = document.createElement('div');
    customBg.id = 'customBgBox';
    customBg.className = 'bg-custom-box';
    const savedCustom = store.get('customStageBg', { on: false, mode: 'gradient', c1: '#0b1224', c2: '#1d4ed8', angle: 135 });
    customBg.innerHTML = `
      <div class="row between">
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="bgCustomOn" ${savedCustom.on ? 'checked' : ''}><span>Custom backdrop colour</span></label>
        <div class="seg sm" id="bgCustomMode">
          <button type="button" data-bgm="solid" class="${savedCustom.mode === 'solid' ? 'on' : ''}">Solid</button>
          <button type="button" data-bgm="gradient" class="${savedCustom.mode !== 'solid' ? 'on' : ''}">Gradient</button>
        </div>
      </div>
      <div class="bg-custom-prev" id="bgCustomPrev" ${savedCustom.on ? '' : 'hidden'}></div>
      <div class="bg-custom-row" id="bgCustomFields" ${savedCustom.on ? '' : 'hidden'}>
        <label class="cw-mini"><span>Base</span><input type="color" id="bgC1" value="${savedCustom.c1}"></label>
        <label class="cw-mini" id="bgC2Wrap" ${savedCustom.mode === 'solid' ? 'hidden' : ''}><span>Blend</span><input type="color" id="bgC2" value="${savedCustom.c2}"></label>
        <label class="cw-mini grow" id="bgAngWrap" ${savedCustom.mode === 'solid' ? 'hidden' : ''}><span>Angle <em class="num" id="bgAngVal">${savedCustom.angle}°</em></span><input type="range" id="bgAngle" min="0" max="360" step="15" value="${savedCustom.angle}"></label>
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
      const prev = $('#bgCustomPrev', customBg);
      prev.hidden = !cfg.on;
      prev.style.background = cfg.mode === 'solid' ? cfg.c1 : `linear-gradient(${cfg.angle}deg, ${cfg.c1}, ${cfg.c2})`;
      $('#bgC2Wrap', customBg).hidden = cfg.mode === 'solid';
      $('#bgAngWrap', customBg).hidden = cfg.mode === 'solid';
      $('#bgAngVal', customBg).textContent = `${cfg.angle}°`;
      window.__gatherCustomBg = cfg;
      api.requestStageRender?.();
    };
    window.__gatherCustomBg = savedCustom;
    pushCustomBg();
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
    $$('#bgs button', brandPanel).forEach((b) => b.addEventListener('click', () => {
      $('#bgCustomOn', customBg).checked = false;
      pushCustomBg();
    }));
  }

  // C. Upgrade Typography & Name Tags: REAL font preview cards + realistic miniature Name Tag preview
  const fontSel = $('#fontSel', brandPanel);
  if (fontSel && !$('#fontCardGrid')) {
    fontSel.hidden = true;
    const grid = document.createElement('div');
    grid.id = 'fontCardGrid';
    grid.className = 'font-card-grid';
    grid.innerHTML = FONT_CARDS.map((f) => `
      <button type="button" class="font-card" data-font="${f.id}">
        <span class="fc-aa" style="font-family:${f.family}">Aa</span>
        <b class="fc-nm" style="font-family:${f.family}">${f.name}</b>
        <small class="fc-sub">${f.vibe}</small>
      </button>
    `).join('');
    fontSel.after(grid);

    const tagPreview = document.createElement('div');
    tagPreview.id = 'tagLivePreview';
    tagPreview.className = 'mini-stage-prev';
    tagPreview.innerHTML = `
      <div class="msp-cam-sim">
        <span class="msp-chip" id="mspTagChip" data-tag="solid">
          <i class="msp-accent"></i>
          <span class="msp-name" id="mspTagName"></span>
          <em class="msp-role">Host</em>
        </span>
      </div>
    `;
    $('#tagSeg', brandPanel)?.after(tagPreview);

    const syncFontUI = (b = {}) => {
      const cur = b.font || fontSel.value || 'jakarta';
      const accent = b.color || '#3b82f6';
      $$('.font-card', grid).forEach((c) => c.classList.toggle('on', c.dataset.font === cur));
      const fc = FONT_CARDS.find((x) => x.id === cur) || FONT_CARDS[0];
      const chip = $('#mspTagChip', tagPreview);
      if (chip) {
        chip.style.fontFamily = fc.family;
        chip.style.setProperty('--msp-accent', accent);
        chip.dataset.tag = b.tag || 'solid';
      }
      const nm = $('#mspTagName', tagPreview);
      if (nm) nm.textContent = api.getMyName?.() || 'Your Name';
    };
    $('#myName')?.addEventListener('input', () => syncFontUI(api.getBrand?.()));
    $$('.font-card', grid).forEach((c) => {
      c.onclick = () => {
        fontSel.value = c.dataset.font;
        fontSel.dispatchEvent(new Event('change', { bubbles: true }));
        applyBrand({ font: c.dataset.font });
        syncFontUI({ ...api.getBrand?.(), font: c.dataset.font });
      };
    });
    $$('#tagSeg button', brandPanel).forEach((btn) => btn.addEventListener('click', () => {
      setTimeout(() => syncFontUI(api.getBrand?.()), 20);
    }));
    syncFontUI(api.getBrand?.());
    api.onBrandSync?.(syncFontUI);
    api.onStateSync?.(() => syncFontUI(api.getBrand?.()));
  }

  // D. Upgrade Banners & Titles: Crisp Live Lower-Third Preview + 2x2 Motion & Alert Style Cards (zero smushing!)
  const bannerSec = $('details[data-sec="banners"] .psec-body', brandPanel);
  if (bannerSec && !$('#bannerLivePrev')) {
    const extra = document.createElement('div');
    extra.id = 'bannerLivePrev';
    extra.className = 'form';
    extra.innerHTML = `
      <div class="mini-banner-stage">
        <div class="mini-banner-prev" id="miniBannerCard" data-bs="classic" data-as="broadcast">
          <i class="mbp-bar" aria-hidden="true"></i>
          <div class="mbp-copy">
            <b class="mbp-title">Welcome to the live show</b>
            <small class="mbp-sub">Episode 12 · Live from gather</small>
          </div>
        </div>
      </div>
      <div class="fld">
        <span>Graphics motion style</span>
        <div class="brand-opt-grid" id="motionSeg" role="radiogroup" aria-label="Graphics motion style">
          ${Object.entries(MOTION_PRESETS).map(([id, m]) => `
            <button type="button" class="brand-opt-card" role="radio" aria-checked="false" data-motion="${id}">
              <b>${m.label}</b>
              <small>${m.desc.split(' ').slice(0, 4).join(' ')}</small>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="fld">
        <span>On-screen alert &amp; card style</span>
        <div class="brand-opt-grid" id="alertStyleSeg" role="radiogroup" aria-label="On-screen alert and card style">
          ${Object.entries(ALERT_STYLES).map(([id, a]) => `
            <button type="button" class="brand-opt-card" role="radio" aria-checked="false" data-as="${id}">
              <b>${a.label}</b>
              <small>${a.desc}</small>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    bannerSec.prepend(extra);

    const replayBannerAnim = (motionId) => {
      const card = $('#miniBannerCard', extra);
      if (!card) return;
      card.classList.remove('mbp-anim-cinematic', 'mbp-anim-playful', 'mbp-anim-esports', 'mbp-anim-luxury');
      void card.offsetWidth;
      card.classList.add('mbp-anim-' + (motionId || 'cinematic'));
    };

    const syncBannerUI = (b = {}) => {
      const card = $('#miniBannerCard', extra);
      const fc = FONT_CARDS.find((x) => x.id === (b.font || 'jakarta')) || FONT_CARDS[0];
      if (card) {
        card.dataset.bs = b.bannerStyle || 'classic';
        card.dataset.as = b.alertStyle || 'broadcast';
        card.style.fontFamily = fc.family;
        card.style.setProperty('--mbp-accent', b.color || '#3b82f6');
      }
      $$('#motionSeg button', extra).forEach((x) => {
        const on = x.dataset.motion === (b.motion || 'cinematic');
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', String(on));
      });
      $$('#alertStyleSeg button', extra).forEach((x) => {
        const on = x.dataset.as === (b.alertStyle || 'broadcast');
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', String(on));
      });
    };
    $$('#motionSeg button', extra).forEach((b) => {
      b.onclick = () => {
        applyBrand({ motion: b.dataset.motion });
        syncBannerUI({ ...api.getBrand?.(), motion: b.dataset.motion });
        replayBannerAnim(b.dataset.motion);
      };
    });
    $$('#alertStyleSeg button', extra).forEach((b) => {
      b.onclick = () => {
        applyBrand({ alertStyle: b.dataset.as });
        syncBannerUI({ ...api.getBrand?.(), alertStyle: b.dataset.as });
      };
    });
    $('#animPreview', brandPanel)?.addEventListener('click', () => {
      replayBannerAnim(api.getBrand?.()?.motion || 'cinematic');
    });
    syncBannerUI(api.getBrand?.());
    api.onBrandSync?.(syncBannerUI);
  }

  // E. Redesign Panels & Cards: curated 8-swatch grid, custom hex well, opacity, corner radius & realistic dual live preview
  const panelColorRow = $('#panelColorRow', brandPanel);
  const panelColor = $('#panelColor', brandPanel);
  if (panelColorRow && panelColor && !$('#panelStudioWrap')) {
    panelColorRow.hidden = true;
    const swWrap = document.createElement('div');
    swWrap.id = 'panelStudioWrap';
    swWrap.className = 'panel-studio form';
    swWrap.innerHTML = `
      <div class="fld">
        <span>Card surface colour</span>
        <div class="panel-sw-grid">
          ${PANEL_SWATCHES.map((c) => `<button type="button" class="psw" data-pc="${c}" style="--c:${c}" aria-label="Surface colour ${c}" data-tip="${c.toUpperCase()}"></button>`).join('')}
        </div>
        <div class="color-well-row panel-hex-row">
          <label class="cw-swatch-btn" title="Custom card surface colour">
            <span class="cw-dot" id="pcDot"></span>
            <span class="cw-lbl">Custom</span>
          </label>
          <input type="text" class="input sm cw-hex" id="pcHex" maxlength="7" spellcheck="false" aria-label="Panel hex code" value="#0F172A">
        </div>
      </div>

      <div class="row2">
        <label class="fld">
          <span>Surface opacity <em class="num" id="pcOpacityVal">86%</em></span>
          <input type="range" id="pcOpacity" min="0.45" max="1" step="0.02" value="0.86">
        </label>
        <div class="fld">
          <span>Corner radius</span>
          <div class="seg block sm" id="pcRadiusSeg" role="radiogroup" aria-label="Panel corner radius">
            <button type="button" data-pr="6">Sharp</button>
            <button type="button" data-pr="14" class="on">Soft</button>
            <button type="button" data-pr="22">Round</button>
          </div>
        </div>
      </div>

      <div class="mini-panel-stage">
        <div class="mini-card-prev" id="miniPanelPrev">
          <div class="mcp-top">
            <span class="mcp-dot"></span>
            <b class="mcp-who">Jordan · Viewer</b>
            <span class="mcp-tag">FEATURED</span>
          </div>
          <p class="mcp-msg">Cards, AI answers &amp; chat overlays update live with this surface.</p>
        </div>
      </div>
    `;
    panelColorRow.after(swWrap);
    $('.panel-hex-row .cw-swatch-btn', swWrap).append(panelColor);
    panelColor.classList.add('cw-native');

    const syncPanelUI = (b = {}) => {
      const col = /^#[0-9a-f]{6}$/i.test(b?.panelColor || '') ? b.panelColor : '#0f172a';
      const isSolid = b?.panel === 'solid';
      const op = Number.isFinite(Number(b?.panelOpacity)) ? Math.max(0.45, Math.min(1, Number(b.panelOpacity))) : (isSolid ? 0.95 : 0.86);
      const rad = Number.isFinite(Number(b?.panelRadius)) ? Number(b.panelRadius) : 14;
      const accent = b?.color || '#3b82f6';
      const fc = FONT_CARDS.find((x) => x.id === (b?.font || 'jakarta')) || FONT_CARDS[0];

      $('#pcDot', swWrap).style.background = col;
      if (document.activeElement !== $('#pcHex', swWrap)) $('#pcHex', swWrap).value = col.toUpperCase();
      $('#pcOpacity', swWrap).value = String(op);
      $('#pcOpacityVal', swWrap).textContent = `${Math.round(op * 100)}%`;

      $$('.psw', swWrap).forEach((x) => x.classList.toggle('on', String(x.dataset.pc || '').toLowerCase() === col.toLowerCase()));
      $$('#pcRadiusSeg button', swWrap).forEach((x) => x.classList.toggle('on', Number(x.dataset.pr) === rad));

      const prev = $('#miniPanelPrev', swWrap);
      if (prev) {
        const light = relLum(col) > 0.52;
        const pct = Math.round(op * 100);
        prev.style.background = `color-mix(in srgb, ${col} ${pct}%, transparent)`;
        prev.style.color = light ? '#0f172a' : '#f8fafc';
        prev.style.borderRadius = `${Math.min(18, rad)}px`;
        prev.style.borderColor = light ? 'rgba(15, 23, 42, 0.14)' : `color-mix(in srgb, ${accent} 38%, rgba(255,255,255,0.14))`;
        prev.style.fontFamily = fc.family;
        prev.style.setProperty('--mcp-accent', accent);
        prev.classList.toggle('glass-look', !isSolid);
      }
    };

    $$('.psw', swWrap).forEach((b) => {
      b.onclick = () => {
        panelColor.value = b.dataset.pc;
        applyBrand({ panelColor: b.dataset.pc });
        syncPanelUI({ ...api.getBrand?.(), panelColor: b.dataset.pc });
      };
    });
    panelColor.addEventListener('input', () => {
      applyBrand({ panelColor: panelColor.value });
      syncPanelUI({ ...api.getBrand?.(), panelColor: panelColor.value });
    });
    $('#pcHex', swWrap).addEventListener('change', (e) => {
      let v = e.target.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        panelColor.value = v;
        applyBrand({ panelColor: v });
        syncPanelUI({ ...api.getBrand?.(), panelColor: v });
      }
    });
    $('#pcOpacity', swWrap).addEventListener('input', (e) => {
      const op = Number(e.target.value);
      applyBrand({ panelOpacity: op });
      syncPanelUI({ ...api.getBrand?.(), panelOpacity: op });
    });
    $$('#pcRadiusSeg button', swWrap).forEach((b) => {
      b.onclick = () => {
        const pr = Number(b.dataset.pr) || 14;
        applyBrand({ panelRadius: pr });
        syncPanelUI({ ...api.getBrand?.(), panelRadius: pr });
      };
    });
    syncPanelUI(api.getBrand?.());
    api.onBrandSync?.(syncPanelUI);
  }

  // F. Brand Kit Importer (Website URL) + Save My Look + Export/Import Brand Kit JSON + Reset
  const themesWrap = $('#brandThemes', brandPanel);
  if (themesWrap && !$('#brandKitActions')) {
    const actions = document.createElement('div');
    actions.id = 'brandKitActions';
    actions.className = 'bk-tools form';
    actions.innerHTML = `
      <div class="row">
        <button type="button" class="btn sm grow" id="saveMyTheme">+ Save look</button>
        <button type="button" class="btn sm" id="exportBrandBtn">Export</button>
        <button type="button" class="btn sm" id="importBrandBtn">Import</button>
        <button type="button" class="btn sm ghost" id="resetBrandBtn" data-tip="Reset brand kit to defaults">Reset</button>
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
      list.push({ name, color: b.color, bg: b.bg, font: b.font, tag: b.tag, bannerStyle: b.bannerStyle, anim: b.anim, motion: b.motion, alertStyle: b.alertStyle, frame: b.frame, panel: b.panel, panelColor: b.panelColor, panelOpacity: b.panelOpacity, panelRadius: b.panelRadius });
      store.set('customThemes', list.slice(-8));
      renderCustomThemes();
      api.toast(`Saved “${name}” to your themes.`);
    };

    $('#resetBrandBtn', actions).onclick = () => {
      applyBrand({ color: '#3b82f6', bg: 'dusk', font: 'jakarta', tag: 'solid', bannerStyle: 'classic', anim: 'slide', motion: 'cinematic', alertStyle: 'broadcast', frame: 'none', panel: 'glass', panelColor: '#0f172a', panelOpacity: 0.86, panelRadius: 14 });
      store.set('customStageBg', { on: false, mode: 'gradient', c1: '#0b1224', c2: '#1d4ed8', angle: 135 });
      window.__gatherCustomBg = { on: false };
      api.toast('Brand kit reset to studio defaults.');
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

// Built-in procedural transparent SVG broadcast overlay frames (tinted with brand accent)
const OVERLAY_FRAME_TEMPLATES = [
  { id: 'studio-clean', name: 'Clean Studio', desc: 'Corner accents + subtle header frame' },
  { id: 'esports-hud', name: 'Esports HUD', desc: 'Angled tech brackets + top badge' },
  { id: 'minimal-glass', name: 'Minimal Hairline', desc: 'Crisp perimeter rule + tick marks' },
  { id: 'cinema-scope', name: 'Cinema Scope', desc: 'Widescreen bars + viewfinder marks' },
  { id: 'live-shop', name: 'Live Drop Frame', desc: 'Clean top rail + promo corner anchor' },
  { id: 'neon-edge', name: 'Neon Perimeter', desc: 'Luminous glowing broadcast border' },
];

function buildOverlayTemplateSvg(id, accent = '#3b82f6') {
  const safe = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#3b82f6';
  let inner = '';
  if (id === 'esports-hud') {
    inner = `
      <path d="M24 96 L24 30 L42 18 L240 18 L260 32 L1020 32 L1040 18 L1238 18 L1256 30 L1256 96" fill="none" stroke="${safe}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M24 624 L24 690 L42 702 L320 702 L338 690 L942 690 L960 702 L1238 702 L1256 690 L1256 624" fill="none" stroke="${safe}" stroke-width="3.5" stroke-linejoin="round"/>
      <rect x="554" y="14" width="172" height="28" rx="6" fill="rgba(7,12,26,0.86)" stroke="${safe}" stroke-width="2"/>
      <circle cx="582" cy="28" r="5" fill="${safe}"/>
      <text x="598" y="33" fill="#ffffff" font-family="Inter, sans-serif" font-size="13" font-weight="800" letter-spacing="2.2">LIVE HUD</text>
    `;
  } else if (id === 'minimal-glass') {
    inner = `
      <rect x="20" y="20" width="1240" height="680" rx="18" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>
      <path d="M20 68 L20 38 Q20 20 38 20 L68 20" fill="none" stroke="${safe}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M1260 68 L1260 38 Q1260 20 1242 20 L1212 20" fill="none" stroke="${safe}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M20 652 L20 682 Q20 700 38 700 L68 700" fill="none" stroke="${safe}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M1260 652 L1260 682 Q1260 700 1242 700 L1212 700" fill="none" stroke="${safe}" stroke-width="3.5" stroke-linecap="round"/>
    `;
  } else if (id === 'cinema-scope') {
    inner = `
      <rect x="0" y="0" width="1280" height="44" fill="rgba(4,7,14,0.88)"/>
      <rect x="0" y="676" width="1280" height="44" fill="rgba(4,7,14,0.88)"/>
      <line x1="0" y1="44" x2="1280" y2="44" stroke="${safe}" stroke-opacity="0.45" stroke-width="1.5"/>
      <line x1="0" y1="676" x2="1280" y2="676" stroke="${safe}" stroke-opacity="0.45" stroke-width="1.5"/>
      <path d="M40 94 L40 68 L66 68 M1240 94 L1240 68 L1214 68 M40 626 L40 652 L66 652 M1240 626 L1240 652 L1214 652" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2"/>
    `;
  } else if (id === 'live-shop') {
    inner = `
      <rect x="18" y="18" width="1244" height="684" rx="16" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="1.5"/>
      <rect x="34" y="28" width="142" height="30" rx="15" fill="${safe}"/>
      <circle cx="52" cy="43" r="4.5" fill="#ffffff"/>
      <text x="64" y="48" fill="#ffffff" font-family="Inter, sans-serif" font-size="12.5" font-weight="800" letter-spacing="1.4">LIVE DROP</text>
      <path d="M34 684 L290 684" stroke="${safe}" stroke-width="4" stroke-linecap="round"/>
    `;
  } else if (id === 'neon-edge') {
    inner = `
      <defs><filter id="ng"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <rect x="16" y="16" width="1248" height="688" rx="20" fill="none" stroke="${safe}" stroke-width="4" filter="url(#ng)" stroke-opacity="0.88"/>
      <rect x="24" y="24" width="1232" height="672" rx="14" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
    `;
  } else {
    // studio-clean
    inner = `
      <path d="M28 84 L28 36 Q28 24 40 24 L112 24" fill="none" stroke="${safe}" stroke-width="4" stroke-linecap="round"/>
      <path d="M1252 84 L1252 36 Q1252 24 1240 24 L1168 24" fill="none" stroke="${safe}" stroke-width="4" stroke-linecap="round"/>
      <path d="M28 636 L28 684 Q28 696 40 696 L112 696" fill="none" stroke="${safe}" stroke-width="4" stroke-linecap="round"/>
      <path d="M1252 636 L1252 684 Q1252 696 1240 696 L1168 696" fill="none" stroke="${safe}" stroke-width="4" stroke-linecap="round"/>
      <line x1="140" y1="24" x2="1140" y2="24" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
      <line x1="140" y1="696" x2="1140" y2="696" stroke="rgba(255,255,255,0.16)" stroke-width="1"/>
    `;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">${inner}</svg>`)}`;
}

// ---------------------------------------------------------------- 3. OVERLAY PACKS + OVERLAY ARTWORK STUDIO + COUNTDOWN & AI VIDEO MAKER + SPONSOR SLOTS
function initOverlaysUpgrades(api) {
  const panel = $('.panel[data-panel="overlays"] .panel-body');
  if (!panel || $('#overlayPacksSec')) return;
  const applyBrand = (patch) => {
    if (!api.isHost()) return api.toast('Only the host can update stage overlays.', { err: true });
    if (typeof api.applyBrand === 'function') api.applyBrand(patch);
    else if (typeof api.brandPref === 'function') api.brandPref(patch);
    else api.setStage({ brand: patch });
  };

  // A. Enhance Stage Overlay Artwork section with visibility switch, opacity slider & 6-frame broadcast gallery
  const stageOvBody = $('details[data-sec="stage-overlay"] .psec-body', panel);
  if (stageOvBody && !$('#ovStudioTools')) {
    const ovTools = document.createElement('div');
    ovTools.id = 'ovStudioTools';
    ovTools.className = 'ov-studio form';
    ovTools.innerHTML = `
      <div class="ov-ctl-row">
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="ovVisibleChk" checked><span>Show artwork</span></label>
        <label class="ov-op-ctl"><span>Opacity <em class="num" id="ovOpacityVal">100%</em></span><input type="range" id="ovOpacity" min="0.15" max="1" step="0.05" value="1"></label>
      </div>
      <div class="fld">
        <span>Instant broadcast frames <em>tinted to your brand colour</em></span>
        <div class="ov-tpl-grid" id="ovTplGrid">
          ${OVERLAY_FRAME_TEMPLATES.map((t) => `
            <button type="button" class="ov-tpl-card" data-ovtpl="${t.id}" data-tip="${t.desc}">
              <span class="ov-tpl-pv"><img alt="" loading="lazy"></span>
              <b>${t.name}</b>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    const firstCard = $('.look-asset-card', stageOvBody);
    if (firstCard) firstCard.after(ovTools);
    else stageOvBody.prepend(ovTools);

    const syncOvThumbs = (b = {}) => {
      const col = b.color || '#3b82f6';
      $$('.ov-tpl-card', ovTools).forEach((card) => {
        const img = $('img', card);
        if (img) img.src = buildOverlayTemplateSvg(card.dataset.ovtpl, col);
      });
      const op = Number.isFinite(Number(b.overlayOpacity)) ? Number(b.overlayOpacity) : 1;
      $('#ovOpacity', ovTools).value = String(op);
      $('#ovOpacityVal', ovTools).textContent = `${Math.round(op * 100)}%`;
      $('#ovVisibleChk', ovTools).checked = !b.overlayHidden;
    };

    $$('.ov-tpl-card', ovTools).forEach((card) => {
      card.onclick = async () => {
        if (!api.isHost()) return api.toast('Only the host can change stage artwork.', { err: true });
        const b = api.getBrand?.() || {};
        const svgUrl = buildOverlayTemplateSvg(card.dataset.ovtpl, b.color || '#3b82f6');
        // Rasterize crisp 1280x720 transparent PNG so WebRTC / canvas drawImage works reliably everywhere
        try {
          const img = new Image();
          img.src = svgUrl;
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
          const c = document.createElement('canvas');
          c.width = 1280; c.height = 720;
          c.getContext('2d').drawImage(img, 0, 0, 1280, 720);
          const pngUrl = c.toDataURL('image/png');
          await api.brandDataUrl?.('overlay', pngUrl);
          applyBrand({ overlayHidden: false, overlayTpl: card.dataset.ovtpl });
          $$('.ov-tpl-card', ovTools).forEach((x) => x.classList.toggle('on', x === card));
          api.toast(`Applied “${$('b', card).textContent}” overlay frame.`);
        } catch {
          api.toast('Could not apply overlay frame.', { err: true });
        }
      };
    });
    $('#ovVisibleChk', ovTools).onchange = (e) => {
      applyBrand({ overlayHidden: !e.target.checked });
    };
    $('#ovOpacity', ovTools).oninput = (e) => {
      const v = Number(e.target.value);
      $('#ovOpacityVal', ovTools).textContent = `${Math.round(v * 100)}%`;
      applyBrand({ overlayOpacity: v });
    };
    syncOvThumbs(api.getBrand?.());
    api.onBrandSync?.(syncOvThumbs);
  }

  // B. Pre-made Overlay Packs
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

  // C. Refactored Countdown & Break Screens + Custom Video Upload + AI Video Countdown Maker
  const cdSec = document.createElement('details');
  cdSec.className = 'psec cd-sec';
  cdSec.id = 'countdownSec';
  cdSec.dataset.sec = 'countdown';
  cdSec.open = true;
  cdSec.innerHTML = `
    <summary><b>Countdown &amp; break screens</b><span class="hint" id="cdSummaryHint">timer · video · AI maker</span></summary>
    <div class="psec-body form cd-body">
      <div class="cd-mode-grid" id="cdModeSeg" role="tablist" aria-label="Break screen mode">
        <button type="button" role="tab" class="cd-mode-btn on" data-cdm="starting" aria-selected="true">Starting soon</button>
        <button type="button" role="tab" class="cd-mode-btn" data-cdm="intermission" aria-selected="false">Intermission</button>
        <button type="button" role="tab" class="cd-mode-btn" data-cdm="brb" aria-selected="false">BRB</button>
        <button type="button" role="tab" class="cd-mode-btn" data-cdm="ending" aria-selected="false">Ending</button>
      </div>

      <div class="cd-fields form">
        <input class="input sm" id="cdTitle" maxlength="80" value="Starting soon" placeholder="Screen headline" aria-label="Screen headline">
        <input class="input sm" id="cdSub" maxlength="120" value="Grab a seat and say hello in chat" placeholder="Subtitle" aria-label="Screen subtitle">
      </div>

      <div class="cd-time-card">
        <div class="cd-time-top">
          <label class="fld"><span>Min</span><input class="input sm num" id="cdMins" type="number" min="0" max="60" value="5"></label>
          <label class="fld"><span>Sec</span><input class="input sm num" id="cdSecs" type="number" min="0" max="59" value="0"></label>
          <div class="fld grow">
            <span>Quick set</span>
            <div class="cd-presets" id="cdPresets">
              <button type="button" class="cd-pre-btn" data-pm="1">1m</button>
              <button type="button" class="cd-pre-btn" data-pm="3">3m</button>
              <button type="button" class="cd-pre-btn on" data-pm="5">5m</button>
              <button type="button" class="cd-pre-btn" data-pm="10">10m</button>
            </div>
          </div>
        </div>
      </div>

      <div class="fld">
        <span>Screen layout</span>
        <div class="brand-opt-grid" id="cdLayoutGrid" role="radiogroup" aria-label="Countdown layout style">
          <button type="button" class="brand-opt-card on" role="radio" aria-checked="true" data-cdl="split"><b>Broadcast Split</b><small>Timer left + glass chat</small></button>
          <button type="button" class="brand-opt-card" role="radio" aria-checked="false" data-cdl="center"><b>Centered Hero</b><small>Progress ring &amp; bold clock</small></button>
          <button type="button" class="brand-opt-card" role="radio" aria-checked="false" data-cdl="cinema"><b>Cinema Bar</b><small>Full-bleed video + bottom bar</small></button>
          <button type="button" class="brand-opt-card" role="radio" aria-checked="false" data-cdl="esports"><b>Neon Esports</b><small>Corner HUD &amp; glowing clock</small></button>
        </div>
      </div>

      <div class="cd-bg-studio">
        <div class="fld">
          <span>Countdown backdrop</span>
          <div class="seg block sm" id="cdBgTypeSeg" role="tablist" aria-label="Countdown backdrop source">
            <button type="button" role="tab" data-bgtype="theme" class="on" aria-selected="true">Theme</button>
            <button type="button" role="tab" data-bgtype="video" aria-selected="false">Upload video</button>
            <button type="button" role="tab" data-bgtype="ai" aria-selected="false">AI video maker</button>
          </div>
        </div>

        <div class="cd-bg-pane" id="cdBgVideoPane" hidden>
          <div class="cd-vid-box">
            <div class="row">
              <button type="button" class="btn sm primary grow" id="cdVidPick">
                <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-upload"/></svg>
                <span>Choose countdown video</span>
              </button>
              <button type="button" class="btn sm ghost" id="cdVidClear" hidden>Remove</button>
              <input type="file" id="cdVidFile" accept="video/mp4,video/webm,video/quicktime,video/*" hidden>
            </div>
            <div class="cd-vid-meta" id="cdVidMeta" hidden>
              <b id="cdVidName">countdown-loop.mp4</b>
              <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="cdVidMute" checked><span>Mute video audio</span></label>
            </div>
            <p class="hint" id="cdVidHint">Loops MP4, WebM, or MOV seamlessly behind your live countdown timer.</p>
          </div>
        </div>

        <div class="cd-bg-pane" id="cdBgAiPane" hidden>
          <div class="cd-ai-maker form">
            <canvas id="cdAiPreview" class="cd-ai-prev" width="320" height="180"></canvas>
            <textarea class="input sm" id="cdAiPrompt" rows="2" maxlength="160" placeholder="Describe your countdown video (e.g. Cyberpunk neon arcade grid, cozy sunset bokeh, deep space warp)"></textarea>
            <div class="cd-ai-styles" id="cdAiStyles">
              <button type="button" class="cd-ai-chip on" data-ais="aurora">Aurora Waves</button>
              <button type="button" class="cd-ai-chip" data-ais="neon-grid">Neon Grid</button>
              <button type="button" class="cd-ai-chip" data-ais="starfield">Starfield</button>
              <button type="button" class="cd-ai-chip" data-ais="liquid">Liquid Mesh</button>
              <button type="button" class="cd-ai-chip" data-ais="bokeh">Studio Bokeh</button>
              <button type="button" class="cd-ai-chip" data-ais="esports">Esports Pulse</button>
            </div>
            <div class="cd-ai-row">
              <label class="cw-mini"><span>Primary</span><input type="color" id="cdAiC1" value="#3b82f6"></label>
              <label class="cw-mini"><span>Secondary</span><input type="color" id="cdAiC2" value="#8b5cf6"></label>
              <label class="cw-mini grow"><span>Motion <em class="num" id="cdAiSpdVal">1.0×</em></span><input type="range" id="cdAiSpeed" min="0.4" max="2.2" step="0.1" value="1"></label>
            </div>
            <div class="row">
              <button type="button" class="btn sm primary grow" id="cdAiGenBtn">
                <svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-sparkles"/></svg>
                <span>Generate AI video</span>
              </button>
              <button type="button" class="btn sm" id="cdAiExportBtn" data-tip="Render & download a 6-second WebM loop">Export WebM</button>
            </div>
          </div>
        </div>

        <label class="fld cd-dim-row" id="cdDimRow" hidden>
          <span>Backdrop dimming <em class="num" id="cdDimVal">42%</em></span>
          <input type="range" id="cdDim" min="0" max="0.85" step="0.05" value="0.42">
        </label>
      </div>

      <div class="cd-opts-grid">
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="cdAutoLive" checked><span>Auto-cut to live</span></label>
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="cdChat" checked><span>Live chat card</span></label>
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="cdProgress" checked><span>Progress bar</span></label>
        <label class="toggle-inline"><input type="checkbox" class="toggle sm" id="cdChime" checked><span>End chime</span></label>
      </div>

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
      applyBrand({ ...pack.brand, pack: b.dataset.pack });
      $('#cdTitle', cdSec).value = pack.countdown.title;
      $('#cdSub', cdSec).value = pack.countdown.subtitle;
      api.setStage({ ticker: pack.ticker });
      $$('.pack-card', packsSec).forEach((x) => x.classList.toggle('on', x === b));
      api.toast(`${pack.name} overlay pack applied using your brand colours.`);
    };
  });

  // Countdown state & interactive wiring
  let cdMode = 'starting';
  let cdLayout = 'split';
  let cdBgType = 'theme';
  let cdAiStyle = 'aurora';
  let cdVidUrl = '';
  let cdAiPreviewRaf = 0;

  const getAiCfg = () => ({
    style: cdAiStyle,
    color: $('#cdAiC1', cdSec).value || api.getBrand?.()?.color || '#3b82f6',
    color2: $('#cdAiC2', cdSec).value || '#8b5cf6',
    speed: Number($('#cdAiSpeed', cdSec).value) || 1,
  });

  const buildCountdownPayload = (forceOn = true) => {
    const mins = Math.max(0, Math.min(60, Number($('#cdMins', cdSec).value) || 0));
    const secs = Math.max(0, Math.min(59, Number($('#cdSecs', cdSec).value) || 0));
    const totalSec = Math.max(5, mins * 60 + secs);
    return {
      on: forceOn,
      mode: cdMode,
      layout: cdLayout,
      title: $('#cdTitle', cdSec).value.trim() || 'Starting soon',
      subtitle: $('#cdSub', cdSec).value.trim(),
      totalSec,
      target: Date.now() + totalSec * 1000,
      autoLive: $('#cdAutoLive', cdSec).checked,
      showChat: $('#cdChat', cdSec).checked,
      showProgress: $('#cdProgress', cdSec).checked,
      chime: $('#cdChime', cdSec).checked,
      dim: Number($('#cdDim', cdSec).value) || 0.42,
      bgType: cdBgType === 'theme' ? '' : cdBgType,
      aiBg: cdBgType === 'ai' ? getAiCfg() : null,
    };
  };

  // Live update active countdown if it's already on stage
  const syncLiveCountdownIfOn = () => {
    const cur = api.getState?.()?.countdown;
    if (!cur?.on) return;
    api.setStage({
      countdown: {
        ...cur,
        mode: cdMode,
        layout: cdLayout,
        title: $('#cdTitle', cdSec).value.trim() || cur.title,
        subtitle: $('#cdSub', cdSec).value.trim(),
        autoLive: $('#cdAutoLive', cdSec).checked,
        showChat: $('#cdChat', cdSec).checked,
        showProgress: $('#cdProgress', cdSec).checked,
        chime: $('#cdChime', cdSec).checked,
        dim: Number($('#cdDim', cdSec).value) || 0.42,
        bgType: cdBgType === 'theme' ? '' : cdBgType,
        aiBg: cdBgType === 'ai' ? getAiCfg() : null,
      },
    });
  };

  const stopAiPreviewLoop = () => {
    if (cdAiPreviewRaf) { cancelAnimationFrame(cdAiPreviewRaf); cdAiPreviewRaf = 0; }
  };
  const startAiPreviewLoop = () => {
    stopAiPreviewLoop();
    const cv = $('#cdAiPreview', cdSec);
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const tick = (now) => {
      if (cdBgType !== 'ai' || !cdSec.open) { cdAiPreviewRaf = 0; return; }
      renderAiCountdownBg(ctx, cv.width, cv.height, getAiCfg(), api.getBrand?.() || {}, now);
      cdAiPreviewRaf = requestAnimationFrame(tick);
    };
    cdAiPreviewRaf = requestAnimationFrame(tick);
  };
  cdSec.addEventListener('toggle', () => {
    if (cdSec.open && cdBgType === 'ai') startAiPreviewLoop();
    else stopAiPreviewLoop();
  });

  $$('#cdModeSeg button', cdSec).forEach((b) => {
    b.onclick = () => {
      cdMode = b.dataset.cdm;
      $$('#cdModeSeg button', cdSec).forEach((x) => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-selected', String(on));
      });
      const defaults = {
        starting: ['Starting soon', 'Grab a seat and say hello in chat'],
        intermission: ['Short intermission', 'Stretch your legs — we’ll be right back'],
        brb: ['Be right back', 'Quick studio reset in progress'],
        ending: ['Thanks for watching!', 'See you on the next live stream'],
      };
      const [t, s] = defaults[cdMode] || defaults.starting;
      $('#cdTitle', cdSec).value = t;
      $('#cdSub', cdSec).value = s;
      syncLiveCountdownIfOn();
    };
  });

  $$('#cdPresets button', cdSec).forEach((b) => {
    b.onclick = () => {
      const m = Number(b.dataset.pm) || 5;
      $('#cdMins', cdSec).value = String(m);
      $('#cdSecs', cdSec).value = '0';
      $$('#cdPresets button', cdSec).forEach((x) => x.classList.toggle('on', x === b));
    };
  });

  $$('#cdLayoutGrid button', cdSec).forEach((b) => {
    b.onclick = () => {
      cdLayout = b.dataset.cdl || 'split';
      $$('#cdLayoutGrid button', cdSec).forEach((x) => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', String(on));
      });
      syncLiveCountdownIfOn();
    };
  });

  const setBgType = (nextType) => {
    cdBgType = nextType;
    $$('#cdBgTypeSeg button', cdSec).forEach((x) => {
      const on = x.dataset.bgtype === cdBgType;
      x.classList.toggle('on', on);
      x.setAttribute('aria-selected', String(on));
    });
    $('#cdBgVideoPane', cdSec).hidden = cdBgType !== 'video';
    $('#cdBgAiPane', cdSec).hidden = cdBgType !== 'ai';
    $('#cdDimRow', cdSec).hidden = cdBgType === 'theme';
    if (cdBgType === 'ai') startAiPreviewLoop();
    else stopAiPreviewLoop();
    syncLiveCountdownIfOn();
  };
  $$('#cdBgTypeSeg button', cdSec).forEach((b) => {
    b.onclick = () => setBgType(b.dataset.bgtype || 'theme');
  });

  // Custom Video Upload Countdown
  const ensureCdVideoEl = () => {
    if (!window.__gatherCdVideo) {
      const v = document.createElement('video');
      v.loop = true;
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = 'anonymous';
      window.__gatherCdVideo = v;
    }
    return window.__gatherCdVideo;
  };
  $('#cdVidPick', cdSec).onclick = () => $('#cdVidFile', cdSec).click();
  $('#cdVidFile', cdSec).onchange = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('video/')) return api.toast('Please choose a video file (MP4, WebM, MOV).', { err: true });
    const v = ensureCdVideoEl();
    if (cdVidUrl) URL.revokeObjectURL(cdVidUrl);
    cdVidUrl = URL.createObjectURL(f);
    v.src = cdVidUrl;
    v.muted = $('#cdVidMute', cdSec).checked;
    v.loop = true;
    try { await v.play(); } catch {}
    $('#cdVidName', cdSec).textContent = f.name;
    $('#cdVidMeta', cdSec).hidden = false;
    $('#cdVidClear', cdSec).hidden = false;
    $('#cdVidHint', cdSec).hidden = true;
    setBgType('video');
    api.toast(`Loaded “${f.name}” as your countdown video backdrop.`);
  };
  $('#cdVidMute', cdSec).onchange = (e) => {
    if (window.__gatherCdVideo) window.__gatherCdVideo.muted = e.target.checked;
  };
  $('#cdVidClear', cdSec).onclick = () => {
    if (window.__gatherCdVideo) { window.__gatherCdVideo.pause(); window.__gatherCdVideo.removeAttribute('src'); window.__gatherCdVideo.load(); }
    if (cdVidUrl) { URL.revokeObjectURL(cdVidUrl); cdVidUrl = ''; }
    $('#cdVidMeta', cdSec).hidden = true;
    $('#cdVidClear', cdSec).hidden = true;
    $('#cdVidHint', cdSec).hidden = false;
    setBgType('theme');
    api.toast('Removed custom countdown video.');
  };

  // AI Video Countdown Maker bindings
  $$('#cdAiStyles button', cdSec).forEach((b) => {
    b.onclick = () => {
      cdAiStyle = b.dataset.ais || 'aurora';
      $$('#cdAiStyles button', cdSec).forEach((x) => x.classList.toggle('on', x === b));
      syncLiveCountdownIfOn();
    };
  });
  $('#cdAiSpeed', cdSec).oninput = (e) => {
    $('#cdAiSpdVal', cdSec).textContent = `${Number(e.target.value).toFixed(1)}×`;
    syncLiveCountdownIfOn();
  };
  $('#cdAiC1', cdSec).oninput = syncLiveCountdownIfOn;
  $('#cdAiC2', cdSec).oninput = syncLiveCountdownIfOn;
  $('#cdDim', cdSec).oninput = (e) => {
    $('#cdDimVal', cdSec).textContent = `${Math.round(Number(e.target.value) * 100)}%`;
    syncLiveCountdownIfOn();
  };
  ['#cdAutoLive', '#cdChat', '#cdProgress', '#cdChime'].forEach((id) => {
    $(id, cdSec).onchange = syncLiveCountdownIfOn;
  });

  $('#cdAiGenBtn', cdSec).onclick = () => {
    if (!api.isHost()) return api.toast('Only the host can generate countdown videos.', { err: true });
    const prompt = $('#cdAiPrompt', cdSec).value.trim().toLowerCase();
    // Smart prompt-to-video motif & palette synthesis
    let style = cdAiStyle;
    let c1 = $('#cdAiC1', cdSec).value;
    let c2 = $('#cdAiC2', cdSec).value;
    if (prompt) {
      if (/cyber|neon|arcade|retro|grid|synth|80s/.test(prompt)) { style = 'neon-grid'; c1 = '#f43f5e'; c2 = '#38bdf8'; }
      else if (/space|star|galaxy|cosmos|warp|sci/.test(prompt)) { style = 'starfield'; c1 = '#6366f1'; c2 = '#06b6d4'; }
      else if (/cozy|sunset|warm|coffee|lofi|gold|bokeh/.test(prompt)) { style = 'bokeh'; c1 = '#f59e0b'; c2 = '#ec4899'; }
      else if (/esport|match|game|tournament|hype|arena/.test(prompt)) { style = 'esports'; c1 = '#ef4444'; c2 = '#f97316'; }
      else if (/liquid|ocean|calm|mesh|abstract|glass/.test(prompt)) { style = 'liquid'; c1 = '#06b6d4'; c2 = '#8b5cf6'; }
      else if (/aurora|northern|emerald|forest|chill/.test(prompt)) { style = 'aurora'; c1 = '#10b981'; c2 = '#3b82f6'; }
      cdAiStyle = style;
      $('#cdAiC1', cdSec).value = c1;
      $('#cdAiC2', cdSec).value = c2;
      $$('#cdAiStyles button', cdSec).forEach((x) => x.classList.toggle('on', x.dataset.ais === cdAiStyle));
    }
    setBgType('ai');
    api.setStage({ countdown: buildCountdownPayload(true) });
    api.toast('AI countdown video generated and live on stage.');
  };

  $('#cdAiExportBtn', cdSec).onclick = async () => {
    if (typeof MediaRecorder === 'undefined') return api.toast('Video export is not supported in this browser.', { err: true });
    const btn = $('#cdAiExportBtn', cdSec);
    btn.disabled = true;
    btn.textContent = 'Rendering 6s…';
    try {
      const off = document.createElement('canvas');
      off.width = 1280; off.height = 720;
      const ctx = off.getContext('2d');
      const stream = off.captureStream(30);
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      const chunks = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      const cfg = getAiCfg();
      const brand = api.getBrand?.() || {};
      const t0 = performance.now();
      let active = true;
      const drawLoop = (now) => {
        if (!active) return;
        renderAiCountdownBg(ctx, 1280, 720, cfg, brand, now);
        if (now - t0 < 6000) requestAnimationFrame(drawLoop);
      };
      rec.start();
      requestAnimationFrame(drawLoop);
      await new Promise((r) => setTimeout(r, 6000));
      active = false;
      rec.stop();
      await done;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `countdown-${cdAiStyle}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      api.toast('Exported 6-second AI countdown video (.webm).');
    } catch (err) {
      api.toast('Could not export video: ' + (err?.message || err), { err: true });
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export WebM';
    }
  };

  $('#cdStartBtn', cdSec).onclick = () => {
    if (!api.isHost()) return api.toast('Only the host controls break screens.', { err: true });
    if (cdBgType === 'video' && (!window.__gatherCdVideo || !window.__gatherCdVideo.src)) {
      api.toast('Upload a countdown video first, or switch backdrop to Theme / AI.', { err: true });
      return;
    }
    if (cdBgType === 'video' && window.__gatherCdVideo) {
      window.__gatherCdVideo.play?.().catch(() => {});
    }
    const payload = buildCountdownPayload(true);
    api.setStage({ countdown: payload });
    api.toast(`${payload.title} is now live on stage.`);
  };
  $('#cdStopBtn', cdSec).onclick = () => {
    if (!api.isHost()) return;
    api.setStage({ countdown: null });
    api.toast('Cut back to live stage.');
  };

  api.onBrandSync?.((b) => {
    if (b?.color && !$('#cdAiPrompt', cdSec).value.trim()) {
      $('#cdAiC1', cdSec).value = b.color;
    }
  });

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
  // holds the real 30-second highlight: 25 s before the mark to 5 s after. Export as 9:16 (TikTok, Reels, Shorts) or 16:9,
  // and automatically archive into Cloud Clips & Google Drive.
  const clips = createClipBuffer({
    getCanvas: () => api.getCanvas?.(), getMixStream: () => api.getMixStream?.(),
    inStudio: () => !!api.inStudio?.(), isHost: () => !!api.isHost?.(),
    getTitle: () => api.getState?.()?.title, getBrandColor: () => api.getBrand?.()?.color,
    onChange: () => renderMoments(),
    onReady: (m) => {
      window.__gatherOnAiHighlightClipReady?.(m);
      if (m?.kind !== 'ai-agent') window.__gatherOnClipReady?.(m);
    },
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
      ul.innerHTML = '<li class="hint">No moments yet. Press M, or Mark clip on the stage, right after something good happens: the 30-second clip saves automatically to Cloud Clips.</li>';
      return;
    }
    replaceKids(ul, ...moments.map((m) => {
      const li = document.createElement('li'); li.className = 'clip-row';
      li.innerHTML = `<div class="sp-row"><div><b></b><small></small></div><span class="clip-acts"><button type="button" class="btn sm primary">9:16</button><button type="button" class="btn sm">16:9</button></span></div>`;
      $('b', li).textContent = m.label;
      const when = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      $('small', li).textContent = m.state === 'capturing' ? `${when} · capturing…` : m.state === 'missed' ? `${when} · not captured (the buffer wasn’t running)` : `${when} · ${m.dur || 30} s ready`;
      const [v, h] = li.querySelectorAll('button');
      v.disabled = h.disabled = m.state !== 'ready';
      v.onclick = () => exportMoment(m, '9:16', v);
      h.onclick = () => exportMoment(m, '16:9', h);
      return li;
    }));
    document.dispatchEvent(new CustomEvent('gather:clips-updated'));
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
    api.toast('30s clip marked — saving to Cloud Clips & Google Drive.', { ms: 2800 });
  };
  $('#markMomentBtn', clipSec).onclick = () => {
    window.__gatherAddMoment(`Highlight #${moments.length + 1}`, 'manual');
    api.toast(clips.running ? 'Marked! Saving your 30-second clip to Cloud Clips in a few seconds.' : 'Marked, but the clip buffer only runs while you’re in your studio as host.');
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
    api.toast('30s clip marked (M) — saving to Cloud Clips.');
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

// ---------------------------------------------------------------- 8. INTERACTIVE 1:1 SQUARE LOGO CROPPER
function initLogoCropper(api) {
  const dlg = $('#logoCropDlg');
  const cv = $('#logoCropCanvas');
  const stage = $('#logoCropStage');
  const zoomIn = $('#logoCropZoom');
  const zoomVal = $('#logoCropZoomVal');
  if (!dlg || !cv || !zoomIn) return;
  const ctx = cv.getContext('2d');
  const S = { img: null, zoom: 1, minZoom: 0.5, x: 0, y: 0, drag: false, sx: 0, sy: 0, ox: 0, oy: 0 };

  const baseScale = () => {
    if (!S.img) return 1;
    const w = S.img.naturalWidth || 1, h = S.img.naturalHeight || 1;
    return cv.width / Math.max(w, h);
  };
  const coverScale = () => {
    if (!S.img) return 1;
    const w = S.img.naturalWidth || 1, h = S.img.naturalHeight || 1;
    return cv.width / Math.min(w, h);
  };
  const render = () => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!S.img) return;
    const w = S.img.naturalWidth || 1, h = S.img.naturalHeight || 1;
    const sc = baseScale() * S.zoom;
    const dw = w * sc, dh = h * sc;
    const dx = (cv.width - dw) / 2 + S.x;
    const dy = (cv.height - dh) / 2 + S.y;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(S.img, dx, dy, dw, dh);
    if (zoomVal) zoomVal.textContent = `${Math.round(S.zoom * 100)}%`;
    zoomIn.value = String(Math.max(Number(zoomIn.min), Math.min(Number(zoomIn.max), S.zoom)));
  };
  const setFit = () => { S.zoom = 1; S.x = 0; S.y = 0; render(); };
  const setFill = () => {
    const ratio = coverScale() / Math.max(0.0001, baseScale());
    S.zoom = Math.max(0.5, Math.min(3.5, Number(ratio.toFixed(2))));
    S.x = 0; S.y = 0; render();
  };

  cv.addEventListener('pointerdown', (e) => {
    S.drag = true; S.sx = e.clientX; S.sy = e.clientY; S.ox = S.x; S.oy = S.y;
    cv.setPointerCapture?.(e.pointerId);
    stage?.classList.add('dragging');
  });
  cv.addEventListener('pointermove', (e) => {
    if (!S.drag) return;
    const rect = cv.getBoundingClientRect();
    const factor = cv.width / Math.max(1, rect.width);
    S.x = S.ox + (e.clientX - S.sx) * factor;
    S.y = S.oy + (e.clientY - S.sy) * factor;
    render();
  });
  const endDrag = () => { S.drag = false; stage?.classList.remove('dragging'); };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 0.1 : -0.1;
    S.zoom = Math.max(0.5, Math.min(3.5, Number((S.zoom + step).toFixed(2))));
    render();
  }, { passive: false });

  zoomIn.addEventListener('input', () => { S.zoom = Number(zoomIn.value) || 1; render(); });
  $('#logoCropFit')?.addEventListener('click', setFit);
  $('#logoCropFill')?.addEventListener('click', setFill);
  $('#logoCropReset')?.addEventListener('click', () => { S.x = 0; S.y = 0; render(); });
  $$('#logoCropBgSeg button').forEach((b) => {
    b.addEventListener('click', () => {
      $$('#logoCropBgSeg button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      if (stage) stage.dataset.bg = b.dataset.cbg || 'check';
    });
  });
  const closeCrop = () => { if (dlg.open) dlg.close(); };
  $('#logoCropClose')?.addEventListener('click', closeCrop);
  $('#logoCropCancel')?.addEventListener('click', closeCrop);

  $('#logoCropApply')?.addEventListener('click', async () => {
    if (!S.img) return;
    const out = document.createElement('canvas');
    out.width = out.height = 512;
    const og = out.getContext('2d');
    const mult = out.width / cv.width;
    const w = S.img.naturalWidth || 1, h = S.img.naturalHeight || 1;
    const sc = baseScale() * S.zoom * mult;
    const dw = w * sc, dh = h * sc;
    const dx = (out.width - dw) / 2 + S.x * mult;
    const dy = (out.height - dh) / 2 + S.y * mult;
    og.imageSmoothingEnabled = true;
    og.imageSmoothingQuality = 'high';
    og.drawImage(S.img, dx, dy, dw, dh);
    const png = out.toDataURL('image/png');
    closeCrop();
    try {
      await api.brandDataUrl?.('logo', png);
      api.toast?.('Square logo saved.');
    } catch (err) {
      api.toast?.(err?.message || 'Could not save logo.', { err: true });
    }
  });

  window.__gatherOpenLogoCrop = (fileOrSrc) => {
    const load = (src) => {
      const im = new Image();
      im.onload = () => {
        S.img = im;
        const isRect = Math.abs(im.naturalWidth - im.naturalHeight) > 4;
        if (isRect) setFit(); else setFill();
        if (!dlg.open) dlg.showModal();
      };
      im.onerror = () => api.toast?.('Could not read that image.', { err: true });
      im.src = src;
    };
    if (typeof fileOrSrc === 'string') { load(fileOrSrc); return; }
    if (fileOrSrc instanceof Blob) {
      const r = new FileReader();
      r.onload = () => load(String(r.result || ''));
      r.onerror = () => api.toast?.('Could not read that file.', { err: true });
      r.readAsDataURL(fileOrSrc);
    }
  };
}

// ---------------------------------------------------------------- 9. GAMER STREAM CONTROL CENTER
function initGamingPanel(api) {
  const panel = $('[data-panel="gaming"]');
  if (!panel) return;
  const saved = store.get('gamerHud', { on: false, game: '', mode: '', wins: 0, losses: 0, kills: 0, deaths: 0 });
  const hud = { ...saved, timerText: '' };
  window.__gatherGamerHud = hud;

  const fmtSw = (ms) => {
    const totalTenths = Math.floor(Math.max(0, ms) / 100);
    const tenths = totalTenths % 10;
    const sec = Math.floor(totalTenths / 10) % 60;
    const min = Math.floor(totalTenths / 600);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths}`;
  };

  let running = false, elapsed = 0, startedAt = 0, raf = 0;
  const splits = [];
  const syncHud = () => {
    store.set('gamerHud', { on: hud.on, game: hud.game, mode: hud.mode, wins: hud.wins, losses: hud.losses, kills: hud.kills, deaths: hud.deaths });
    if ($('#gmHudOn')) $('#gmHudOn').checked = !!hud.on;
    if ($('#gmGameTitle') && document.activeElement !== $('#gmGameTitle')) $('#gmGameTitle').value = hud.game || '';
    if ($('#gmGameMode') && document.activeElement !== $('#gmGameMode')) $('#gmGameMode').value = hud.mode || '';
    if ($('#gmStatWins')) $('#gmStatWins').textContent = String(hud.wins);
    if ($('#gmStatLosses')) $('#gmStatLosses').textContent = String(hud.losses);
    if ($('#gmStatKills')) $('#gmStatKills').textContent = String(hud.kills);
    if ($('#gmStatDeaths')) $('#gmStatDeaths').textContent = String(hud.deaths);
    api.requestStageRender?.();
  };
  window.__syncGamerHud = syncHud;
  const tickTimer = () => {
    const cur = running ? elapsed + (performance.now() - startedAt) : elapsed;
    const txt = fmtSw(cur);
    if ($('#gmTimerDisplay')) $('#gmTimerDisplay').textContent = txt;
    hud.timerText = (running || elapsed > 0) ? txt : '';
    if (hud.on) api.requestStageRender?.();
    if (running) raf = requestAnimationFrame(tickTimer);
  };

  $('#gmHudOn')?.addEventListener('change', (e) => { hud.on = e.target.checked; syncHud(); });
  $('#gmGameTitle')?.addEventListener('input', (e) => { hud.game = e.target.value.trim(); syncHud(); });
  $('#gmGameMode')?.addEventListener('input', (e) => { hud.mode = e.target.value.trim(); syncHud(); });
  $('#gmCounters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delta]'); if (!btn) return;
    const stat = btn.closest('[data-stat]')?.dataset.stat;
    if (!stat || !(stat in hud)) return;
    hud[stat] = Math.max(0, (Number(hud[stat]) || 0) + Number(btn.dataset.delta || 0));
    syncHud();
  });
  $('#gmStatsReset')?.addEventListener('click', () => {
    hud.wins = 0; hud.losses = 0; hud.kills = 0; hud.deaths = 0;
    syncHud();
    api.toast?.('Match stats reset.');
  });
  $('#gmTimerToggle')?.addEventListener('click', () => {
    if (running) {
      elapsed += performance.now() - startedAt;
      running = false;
      cancelAnimationFrame(raf);
      $('#gmTimerToggle').textContent = 'Resume';
      tickTimer();
    } else {
      startedAt = performance.now();
      running = true;
      $('#gmTimerToggle').textContent = 'Pause';
      tickTimer();
    }
  });
  $('#gmTimerSplit')?.addEventListener('click', () => {
    const cur = running ? elapsed + (performance.now() - startedAt) : elapsed;
    if (cur <= 0) return;
    splits.push(fmtSw(cur));
    if (splits.length > 5) splits.shift();
    const box = $('#gmSplits');
    if (box) {
      box.hidden = false;
      box.innerHTML = splits.map((s, i) => `<span class="gm-split-item"><b>#${i + 1}</b><em class="num">${s}</em></span>`).join('');
    }
  });
  $('#gmTimerReset')?.addEventListener('click', () => {
    running = false; elapsed = 0; cancelAnimationFrame(raf);
    splits.length = 0;
    if ($('#gmTimerToggle')) $('#gmTimerToggle').textContent = 'Start';
    if ($('#gmSplits')) { $('#gmSplits').hidden = true; $('#gmSplits').innerHTML = ''; }
    tickTimer();
  });

  // Quick gamer stream actions
  $('#gmQuickActions')?.addEventListener('click', (e) => {
    const act = e.target.closest('[data-gm]')?.dataset.gm;
    if (!act) return;
    if (act === 'share-game') api.triggerShareGame?.();
    if (act === 'replay') api.triggerReplay?.();
    if (act === 'clip') api.triggerClip?.();
    if (act === 'predict') {
      api.setTab?.('polls');
      setTimeout(() => { $('[data-kind="predict"]')?.click(); $('#pollQ')?.focus(); }, 60);
    }
    if (act === 'scene-game') { api.applyGameScene?.(); api.toast?.('Switched to Game + Cam layout.'); }
    if (act === 'brb') {
      api.setTab?.('overlays');
      setTimeout(() => { $('#cdTypeSeg [data-cdt="brb"]')?.click(); $('#cdStartBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80);
    }
  });

  // Built-in Web Audio Hype SFX stingers
  const playGamerSfx = (kind) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ac = new AC();
      const now = ac.currentTime;
      const gain = ac.createGain();
      gain.gain.setValueAtTime(0.24, now);
      gain.connect(ac.destination);
      if (kind === 'airhorn') {
        [392, 493.88, 587.33].forEach((f) => {
          const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, now);
          o.connect(gain); o.start(now); o.stop(now + 0.55);
        });
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      } else if (kind === 'fanfare') {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, now + i * 0.09);
          o.connect(gain); o.start(now + i * 0.09); o.stop(now + i * 0.09 + 0.28);
        });
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      } else if (kind === 'glitch') {
        const o = ac.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(880, now);
        o.frequency.exponentialRampToValueAtTime(220, now + 0.12);
        o.frequency.setValueAtTime(660, now + 0.13);
        o.frequency.exponentialRampToValueAtTime(110, now + 0.28);
        o.connect(gain); o.start(now); o.stop(now + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      } else {
        // applause / GG burst
        const buf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.18));
        const src = ac.createBufferSource(); src.buffer = buf;
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400;
        src.connect(bp); bp.connect(gain); src.start(now);
      }
      setTimeout(() => ac.close().catch(() => {}), 900);
    } catch {}
  };
  $('#gmHypeSfx')?.addEventListener('click', (e) => {
    const k = e.target.closest('[data-gmsfx]')?.dataset.gmsfx;
    if (!k) return;
    playGamerSfx(k);
    api.toast?.(`Played ${k} stinger!`);
  });

  syncHud();
}

// ---------------------------------------------------------------- 11. GREEN ROOM GUEST READY CHECKLIST
function initGreenRoomChecklist(api) {
  const wrap = $('#grChecklist');
  if (!wrap) return;
  const micRow = $('#grChkMic'), micVal = $('#grChkMicVal');
  const camRow = $('#grChkCam'), camVal = $('#grChkCamVal');
  const netRow = $('#grChkNet'), netVal = $('#grChkNetVal');
  const badge = $('#grReadyBadge');
  const retestBtn = $('#grRetestBtn');
  const audioOnlyWrap = $('#grAudioOnlyWrap');
  const audioOnlyChk = $('#grAudioOnlyChk');
  const goBtn = $('#enterGo');

  let netState = 'checking'; // 'checking' | 'ok' | 'warn' | 'fail'
  let lastLatencyMs = 0;
  let audioOnlyBypass = false;
  let pingInFlight = false;

  const setRow = (row, valEl, state, text) => {
    if (row) row.dataset.state = state;
    if (valEl) valEl.textContent = text;
  };

  async function measureLatency() {
    if (pingInFlight) return;
    pingInFlight = true;
    netState = 'checking';
    setRow(netRow, netVal, 'checking', 'Pinging…');
    evaluate();
    const samples = [];
    for (let i = 0; i < 2; i++) {
      const t0 = performance.now();
      try {
        const res = await fetch('/api/studio?action=config&_ping=' + Date.now(), { cache: 'no-store' });
        if (res.ok) samples.push(Math.max(1, Math.round(performance.now() - t0)));
      } catch {}
    }
    pingInFlight = false;
    if (!samples.length) {
      lastLatencyMs = 0;
      netState = 'fail';
      setRow(netRow, netVal, 'fail', 'Offline / unreachable');
    } else {
      lastLatencyMs = Math.min(...samples);
      if (lastLatencyMs <= 250) {
        netState = 'ok';
        setRow(netRow, netVal, 'ok', `${lastLatencyMs} ms · Excellent`);
      } else if (lastLatencyMs <= 600) {
        netState = 'warn';
        setRow(netRow, netVal, 'warn', `${lastLatencyMs} ms · Fair`);
      } else {
        netState = 'fail';
        setRow(netRow, netVal, 'fail', `${lastLatencyMs} ms · High latency`);
      }
    }
    evaluate();
  }

  function evaluate() {
    if (!/^\/[sc]\//.test(location.pathname)) {
      if (goBtn && !goBtn.classList.contains('busy')) { goBtn.disabled = false; goBtn.title = ''; }
      return;
    }
    const local = api.getLocal?.() || {};
    const mode = api.getEnterMode?.() || 'create';
    const isGuestJoin = mode === 'join';

    const micOk = !!(local.micOn && local.audio);
    const camOk = !!(local.camOn && local.cam);
    const netOk = netState === 'ok' || netState === 'warn';

    if (micOk) setRow(micRow, micVal, 'ok', local.audio?.label ? 'Ready' : 'Connected');
    else setRow(micRow, micVal, local.micOn ? 'warn' : 'fail', local.micError ? 'Blocked' : 'Muted / Off');

    if (camOk) setRow(camRow, camVal, 'ok', 'Ready');
    else if (audioOnlyBypass) setRow(camRow, camVal, 'ok', 'Audio-only');
    else setRow(camRow, camVal, local.camError ? 'warn' : 'fail', local.camError ? 'Unavailable' : 'Off');

    if (audioOnlyWrap) audioOnlyWrap.hidden = camOk;

    const allPass = micOk && (camOk || audioOnlyBypass) && netOk;
    // Also treat verified network + audio-only / headless environments fairly for hosts while enforcing guest readiness
    const fullyReady = allPass || (!isGuestJoin && netOk && (micOk || camOk));

    if (badge) {
      if (netState === 'checking') {
        badge.dataset.state = 'checking';
        badge.textContent = 'Checking…';
      } else if (allPass) {
        badge.dataset.state = 'ready';
        badge.textContent = '✓ Ready to join';
      } else if (netOk && (micOk || camOk)) {
        badge.dataset.state = 'warn';
        badge.textContent = isGuestJoin ? 'Check devices' : 'Partial ready';
      } else {
        badge.dataset.state = 'fail';
        badge.textContent = netOk ? 'Enable mic & cam' : 'Check network';
      }
    }

    // Store readiness so studio tile gets the ✓ Ready badge when checks pass
    api.setLocalReady?.(allPass || (netOk && (micOk || camOk || audioOnlyBypass)), lastLatencyMs);

    // For guests joining a stage, require network + mic + (camera or audio-only check) before entering
    if (goBtn && !goBtn.classList.contains('busy')) {
      const blocked = isGuestJoin && !(netOk && (micOk || audioOnlyBypass) && (camOk || audioOnlyBypass));
      goBtn.disabled = blocked;
      goBtn.title = blocked ? 'Complete the Guest Ready check (enable mic/camera or tick audio-only) to join.' : '';
    }
  }

  audioOnlyChk?.addEventListener('change', () => {
    audioOnlyBypass = !!audioOnlyChk.checked;
    evaluate();
  });
  retestBtn?.addEventListener('click', () => {
    measureLatency();
  });

  window.__gatherCheckGreenRoom = (reping = false) => {
    if (reping || netState === 'checking') measureLatency();
    else evaluate();
  };
}

// ---------------------------------------------------------------- 12. AI SCENE SUGGEST (SCENES TAB + STAGE LAYOUT PANEL)
function initAiSceneSuggest(api) {
  const listEl = $('#aiSceneSuggestList');
  const ctxEl = $('#aiSuggestContext');
  const deckWrap = $('#deckAiSuggest');
  const deckListEl = $('#deckAiSuggestList');
  const deckCtxEl = $('#deckAiSuggestCtx');
  if (!listEl && !deckListEl) return;

  let lastSig = '';

  function pickSuggestions() {
    const peers = api.getPeers?.() || [];
    const scenes = api.getSceneList?.() || [];
    const activeId = api.activeSceneId?.() || '';
    const presenting = !!api.isPresenting?.();
    const state = api.getState?.() || {};
    const streamType = state.streamType || 'live';
    const stageIds = new Set(state.stage || []);
    const onStage = peers.filter((p) => stageIds.has(p.id));
    const activePeople = onStage.length ? onStage : peers;
    const hostCount = activePeople.filter((p) => p.isHost).length;
    const guestCount = Math.max(0, activePeople.length - hostCount);
    const total = Math.max(1, activePeople.length);
    const backstageCount = Math.max(0, peers.length - onStage.length);

    const byId = (id) => scenes.find((s) => s.id === id);
    const byKeyword = (re) => scenes.find((s) => re.test(`${s.id} ${s.name} ${s.cat || ''}`.toLowerCase()));

    const picks = [];
    const pushUnique = (sc, reason, tag) => {
      if (!sc || picks.some((x) => x.sc.id === sc.id)) return;
      picks.push({ sc, reason, tag });
    };

    let ctxText = `${hostCount || 1} Host`;
    if (guestCount > 0) ctxText += ` · ${guestCount} Guest${guestCount === 1 ? '' : 's'}`;
    if (backstageCount > 0) ctxText += ` · ${backstageCount} backstage`;
    if (presenting) ctxText += ' · Screen share live';
    if (ctxEl) ctxEl.textContent = ctxText;
    if (deckCtxEl) deckCtxEl.textContent = ctxText;

    if (presenting) {
      if (streamType === 'gaming') {
        pushUnique(byId('game') || byKeyword(/game/), 'Active screen share in gaming mode — full-bleed gameplay with facecam', 'Recommended');
        pushUnique(byId('present') || byId('v-present') || byKeyword(/present|slides|screen/), 'Active screen share detected — keeps content crisp & readable', 'Content focus');
        pushUnique(byId('ai') || byKeyword(/screen.*ai|ai/), 'Shared screen alongside Sam AI window', 'Co-host AI');
      } else {
        pushUnique(byId('present') || byId('v-present') || byKeyword(/present|slides|screen/), 'Active screen share detected — keeps content crisp & readable', 'Recommended');
        pushUnique(byId('game') || byKeyword(/game/), 'Full-bleed shared screen with compact speaker PIP', 'Content focus');
        pushUnique(byId('b-spotlight') || byId('spotlight') || byKeyword(/spotlight|split/), 'Highlights speaker beside shared content', 'Balanced');
      }
    } else if (total === 1) {
      pushUnique(byId('b-solo') || byId('v-solo') || byKeyword(/solo/), '1 Host on stage — full-frame camera focus', 'Recommended');
      pushUnique(byId('chat') || byId('v-chat') || byKeyword(/chat|talk/), 'Solo host paired with live audience chat', 'Interactive');
      pushUnique(byId('ai') || byId('v-ai') || byKeyword(/ai|podcast/), 'Solo host with Sam AI research window', 'Co-host AI');
    } else if (total === 2) {
      pushUnique(byId('b-split') || byId('v-stack') || byKeyword(/split|1-on-1|interview|duo/), `1 Host + ${guestCount} Guest — side-by-side 1-on-1 framing`, 'Recommended');
      pushUnique(byId('b-spotlight') || byKeyword(/spotlight/), 'Focuses on active speaker with guest inset', 'Dynamic');
      pushUnique(byId('chat') || byKeyword(/chat|talk/), 'Two speakers with live chat card', 'Interactive');
    } else {
      pushUnique(byId('b-grid') || byKeyword(/grid|panel/), `${hostCount || 1} Host + ${guestCount} Guests — equal multi-cam panel grid`, 'Recommended');
      pushUnique(byId('b-spotlight') || byKeyword(/spotlight/), 'Spotlights the active speaker with a guest strip', 'Host led');
      pushUnique(byId('b-split') || byKeyword(/split/), 'Clean balanced frames for group discussion', 'Compact');
    }

    for (const sc of scenes) {
      if (picks.length >= 3) break;
      pushUnique(sc, 'Matched to your current studio layout', 'Suggested');
    }
    const sig = `${ctxText}|${activeId}|${api.isHost?.() ? 1 : 0}|` + picks.slice(0, 3).map((x) => `${x.sc.id}:${x.tag}`).join(',');
    return { picks: picks.slice(0, 3), activeId, sig, ctxText };
  }

  function applySuggestedScene(sc) {
    if (!api.isHost?.()) return api.toast?.('Only the host can switch scenes.', { err: true });
    api.applyScene?.(sc);
    api.toast?.(`Applied “${sc.name}” scene.`);
    render(true);
  }

  function render(force = false) {
    const { picks, activeId, sig, ctxText } = pickSuggestions();
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const host = !!api.isHost?.();

    // 1. Render inside the Scenes tab (#deckAiSuggest)
    if (deckListEl) {
      if (deckWrap) deckWrap.hidden = !host || !picks.length;
      deckListEl.replaceChildren();
      for (const { sc, reason, tag } of picks) {
        const isCurrent = sc.id === activeId;
        const isRec = tag === 'Recommended';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'das-btn' + (isCurrent ? ' is-active' : '') + (isRec ? ' is-rec' : '');
        btn.dataset.sceneId = sc.id;
        btn.title = reason;
        btn.setAttribute('aria-pressed', String(isCurrent));
        btn.dataset.layout = sc.layout || sc.id;
        btn.disabled = !host;

        const name = document.createElement('span');
        name.className = 'das-name';
        name.textContent = sc.name;

        const meta = document.createElement('span');
        meta.className = 'das-meta';
        meta.textContent = isCurrent ? 'Active' : tag;

        btn.append(name, meta);
        btn.addEventListener('click', () => {
          if (!isCurrent) applySuggestedScene(sc);
        });
        deckListEl.append(btn);
      }
    }
    const topPick = picks[0] || null;
    window.__gatherLastAiRec = topPick ? {
      id: topPick.sc.id,
      name: topPick.sc.name,
      layout: topPick.sc.layout || topPick.sc.id,
      reason: topPick.reason,
      ctx: ctxText || 'Studio',
      isActive: topPick.sc.id === activeId,
    } : null;

    // 2. Render full cards inside Stage -> Layout panel (#aiSceneSuggestList)
    if (listEl) {
      listEl.replaceChildren();
      if (!picks.length) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = 'Join a studio to see dynamic scene recommendations.';
        listEl.append(p);
        return;
      }
      for (const { sc, reason, tag } of picks) {
        const isCurrent = sc.id === activeId;
        const isRec = tag === 'Recommended';
        const card = document.createElement('div');
        card.className = 'ai-suggest-card' + (isCurrent ? ' is-active' : '') + (isRec ? ' is-recommended' : '');
        card.dataset.sceneId = sc.id;

        const head = document.createElement('div');
        head.className = 'ai-suggest-head';

        const pvWrap = document.createElement('div');
        pvWrap.className = 'ai-suggest-pv';
        if (typeof api.scenePreview === 'function') pvWrap.append(api.scenePreview(sc));

        const meta = document.createElement('div');
        meta.className = 'ai-suggest-meta';
        const b = document.createElement('b');
        b.className = 'ai-suggest-name';
        b.textContent = sc.name;
        const label = document.createElement('span');
        label.className = 'ai-suggest-tag' + (isRec ? ' rec' : '');
        label.textContent = tag;
        meta.append(b, label);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn sm ai-suggest-btn ' + (isCurrent ? 'ghost is-active' : (isRec ? 'primary' : ''));
        btn.disabled = !host || isCurrent;
        btn.textContent = isCurrent ? 'Active' : 'Apply';
        btn.onclick = () => applySuggestedScene(sc);

        head.append(pvWrap, meta, btn);

        const desc = document.createElement('p');
        desc.className = 'ai-suggest-reason';
        desc.textContent = reason;

        card.append(head, desc);
        listEl.append(card);
      }
    }
  }

  const safeRender = (force = false) => {
    try { render(force); } catch (err) { console.warn('[scene-suggest] render error:', err); }
  };
  window.__gatherRefreshSceneSuggest = () => safeRender(true);
  onStudioChange(() => safeRender(false));
  api.onStateSync?.(() => safeRender(false));
  // Real-time monitor for local/remote screen shares & participant changes
  setInterval(() => {
    if (document.hidden || !api.inStudio?.()) return;
    safeRender(false);
  }, 900);
  safeRender(true);
}

// ---------------------------------------------------------------- 13. GAMING AI VISION SCOREBOARD AUTO-TRACKER
function initAiScoreboardVision(api) {
  const autoChk = $('#gmScoreVisionOn');
  const overrideChk = $('#gmScoreManualOverride');
  const statEl = $('#gmScoreVisionStat');
  const scanBtn = $('#gmScoreScanNow');
  if (!autoChk || !overrideChk || !statEl) return;

  let timer = null;
  let scanning = false;

  const setStatus = (txt, state = 'off') => {
    statEl.textContent = txt;
    statEl.dataset.state = state;
  };

  async function scanStageScore(manualTrigger = false) {
    if (scanning) return;
    if (!manualTrigger && overrideChk.checked) {
      setStatus('Manual override', 'paused');
      return;
    }
    const sb = (api.getElements?.() || []).find((x) => x.type === 'score');
    if (!sb) {
      if (manualTrigger) api.toast?.('Add a scoreboard to the stage first.', { err: true });
      setStatus('Add scoreboard', 'warn');
      return;
    }
    const canvas = api.getCanvas?.();
    if (!canvas) return;
    scanning = true;
    setStatus('Scanning…', 'live');
    try {
      const snap = canvas.toDataURL('image/jpeg', 0.65);
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Read the live match scoreboard numbers visible on this game stream screenshot for "${sb.a || 'Team A'}" vs "${sb.b || 'Team B'}". Reply ONLY with strict JSON {"sa":number,"sb":number} or {"none":true} if no on-screen score is visible.`,
          image: snap,
        }),
      });
      if (!res.ok) throw new Error('Vision API unavailable');
      const data = await res.json();
      const raw = String(data?.text || data?.reply || data?.answer || '');
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (Number.isFinite(parsed.sa) && Number.isFinite(parsed.sb) && !overrideChk.checked) {
          if (parsed.sa !== sb.sa || parsed.sb !== sb.sb) {
            api.patchEl?.(sb.id, { sa: parsed.sa, sb: parsed.sb });
            api.toast?.(`Sam Vision updated score: ${parsed.sa} – ${parsed.sb}`);
          }
          setStatus(`Synced (${parsed.sa}–${parsed.sb})`, 'live');
          return;
        }
      }
      setStatus(autoChk.checked ? 'Watching screen' : 'No score detected', autoChk.checked ? 'live' : 'off');
    } catch {
      setStatus(autoChk.checked ? 'Watching (manual ready)' : 'Ready', autoChk.checked ? 'warn' : 'off');
      if (manualTrigger) api.toast?.('No on-screen match score detected — you can also update manually or ask @Sam in chat.');
    } finally {
      scanning = false;
    }
  }

  const syncLoop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (!autoChk.checked) {
      setStatus('Off', 'off');
      return;
    }
    if (overrideChk.checked) {
      setStatus('Manual override', 'paused');
      return;
    }
    setStatus('Watching screen', 'live');
    timer = setInterval(() => scanStageScore(false), 12000);
  };

  autoChk.addEventListener('change', () => {
    if (autoChk.checked) {
      overrideChk.checked = false;
      syncLoop();
      scanStageScore(false);
    } else {
      syncLoop();
    }
  });
  overrideChk.addEventListener('change', () => {
    syncLoop();
    if (overrideChk.checked && autoChk.checked) api.toast?.('Manual override on — Sam Vision paused.');
  });
  scanBtn?.addEventListener('click', () => scanStageScore(true));

  // If the host taps manual +/- buttons while auto-track is running, automatically respect manual edits
  $('#scoreQuick')?.addEventListener('click', (e) => {
    if (autoChk.checked && e.target.closest('[data-sq]') && !overrideChk.checked) {
      setStatus('Manual edit synced', 'live');
    }
  });
}

// ---------------------------------------------------------------- SHARED EVENT BUS FOR NEW STUDIO MODULES
const _studioChangeSubs = new Set();
const _speechOrChatSubs = new Set();
const _libraryChangeSubs = new Set();

function onStudioChange(fn) {
  _studioChangeSubs.add(fn);
  return () => _studioChangeSubs.delete(fn);
}
function onSpeechOrChat(fn) {
  _speechOrChatSubs.add(fn);
  return () => _speechOrChatSubs.delete(fn);
}
function onLibraryChange(fn) {
  _libraryChangeSubs.add(fn);
  return () => _libraryChangeSubs.delete(fn);
}

window.__gatherOnStudioChange = () => {
  for (const fn of _studioChangeSubs) { try { fn(); } catch {} }
};
window.__gatherOnSpeechOrChat = (ev) => {
  for (const fn of _speechOrChatSubs) { try { fn(ev); } catch {} }
};
window.__gatherOnLibraryChange = () => {
  for (const fn of _libraryChangeSubs) { try { fn(); } catch {} }
};

function clamp50(str) {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  if (s.length <= 50) return s;
  const cut = s.slice(0, 49);
  const sp = cut.lastIndexOf(' ');
  return (sp > 24 ? cut.slice(0, sp) : cut).replace(/[,:;\-]+$/, '') + '…';
}

function fmtClock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- 14. AI RECAP IN 'SAVE AS A SCENE'
function initAiRecap(api) {
  const btn = $('#aiRecapBtn');
  const descEl = $('#layoutDesc');
  const countEl = $('#layoutDescCount');
  const partEl = $('#layoutParticipants');
  const nameEl = $('#layoutName');
  if (!btn || !descEl) return;

  const syncCount = () => {
    if (descEl.value.length > 50) descEl.value = descEl.value.slice(0, 50);
    if (countEl) {
      countEl.textContent = `${descEl.value.length}/50`;
      countEl.classList.toggle('is-max', descEl.value.length >= 50);
    }
  };
  descEl.addEventListener('input', syncCount);
  syncCount();

  btn.addEventListener('click', async () => {
    const peers = (api.getPeers?.() || []).map((p) => p.name).filter(Boolean);
    const transcript = (api.getTranscript?.() || []).slice(-20);
    const speakers = [...new Set([...peers, ...transcript.map((t) => t.speaker).filter(Boolean)])];
    const activeScene = (api.getSceneList?.() || []).find((s) => s.id === api.activeSceneId?.())?.name || 'Studio';
    const presenting = !!api.isPresenting?.();

    const buildFallback = () => {
      const lastLine = transcript.slice().reverse().find((t) => t.text && t.text.length >= 4);
      let desc = '';
      if (lastLine) {
        const cleaned = lastLine.text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
        desc = clamp50(cleaned || `${activeScene} with ${speakers.slice(0, 2).join(' & ') || 'host'}`);
      } else if (presenting) {
        desc = clamp50(`Live ${activeScene} presentation (${speakers.length || 1} on)`);
      } else if (speakers.length >= 2) {
        desc = clamp50(`${activeScene} chat with ${speakers.slice(0, 2).join(' & ')}`);
      } else {
        desc = clamp50(`${activeScene} segment with ${speakers[0] || api.getMyName?.() || 'Host'}`);
      }
      return {
        desc: clamp50(desc),
        participants: speakers.length ? speakers : [api.getMyName?.() || 'Host'],
        title: `${activeScene} Recap`,
      };
    };

    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    let result = buildFallback();

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'recap',
          activeScene,
          presenting,
          speakers,
          transcript,
        }),
      });
      if (res.ok) {
        const parsed = await res.json();
        if (parsed && !parsed.fallback) {
          if (parsed.desc) result.desc = clamp50(parsed.desc);
          if (Array.isArray(parsed.participants) && parsed.participants.length) {
            result.participants = [...new Set(parsed.participants.map((x) => String(x).trim()).filter(Boolean))];
          }
          if (parsed.title && typeof parsed.title === 'string') result.title = parsed.title.trim().slice(0, 38);
        }
      }
    } catch {
      // Fall back smoothly to deterministic transcript summary
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }

    descEl.value = clamp50(result.desc);
    syncCount();
    if (partEl) partEl.value = result.participants.join(', ');
    if (nameEl && !nameEl.value.trim() && result.title) nameEl.value = result.title.slice(0, 40);
    api.toast?.(`AI Recap ready (${descEl.value.length}/50 chars).`);
  });
}

// ---------------------------------------------------------------- 15. CHAT COMPOSER REACTION BUTTON + ANIMATED STAGE OVERLAYS
function initChatReactions(api) {
  const btn = $('#chatReactBtn');
  const pop = $('#chatReactPop');
  if (!btn || !pop) return;

  let lastFire = 0;

  const setOpen = (open) => {
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('active', open);
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(pop.hidden);
  });

  pop.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-react]');
    if (!choice) return;
    const emoji = choice.dataset.react;
    if (!emoji) return;
    const now = Date.now();
    if (now - lastFire < 220) return;
    lastFire = now;

    // Immediate animated stage reaction burst locally
    api.reactFloat?.(emoji);
    setTimeout(() => api.reactFloat?.(emoji), 120);
    setTimeout(() => api.reactFloat?.(emoji), 250);

    // Broadcast to every connected studio participant (host & guests)
    if (api.inStudio?.()) {
      api.wsSend?.({ type: 'react', emoji });
    }
    setOpen(false);
  });

  document.addEventListener('click', (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) setOpen(false);
  });
}

// ---------------------------------------------------------------- 16. SCENE AI — CONTEXT-AWARE SWITCHES (AUTO-APPLY + UNDO TOAST)
function initSceneAi(api) {
  const enChk = $('#saiEnabled');
  const statusHint = $('#saiStatusHint');
  const liveCtxEl = $('#saiLiveCtx');
  const liveSceneEl = $('#saiLiveScene');
  const liveStateEl = $('#saiLiveState');
  const ruleShareStart = $('#saiRuleShareStart');
  const targetShareStart = $('#saiTargetShareStart');
  const ruleShareEnd = $('#saiRuleShareEnd');
  const ruleTwo = $('#saiRuleTwo');
  const targetTwo = $('#saiTargetTwo');
  const ruleThreePlus = $('#saiRuleThreePlus');
  const targetThreePlus = $('#saiTargetThreePlus');
  const ruleSolo = $('#saiRuleSolo');
  const targetSolo = $('#saiTargetSolo');
  const lastActionEl = $('#saiLastAction');
  const undoBtn = $('#saiUndoBtn');
  const historyEl = $('#saiHistory');
  const ruleListEl = $('#saiRuleList');
  if (!enChk || !targetShareStart) return;

  const STORE_KEY = 'gather:sceneAiRules:v2';
  const LEGACY_STORE_KEY = 'gather:sceneAiRules';
  const COUNT_COOLDOWN_MS = 2200;
  const SHARE_COOLDOWN_MS = 600;
  const TOAST_KEY = 'scene-ai-switch';

  let cfg = {
    enabled: true,
    shareStart: true,
    shareStartTarget: 'present',
    shareEnd: true,
    two: true,
    twoTarget: 'b-split',
    threePlus: true,
    threePlusTarget: 'b-grid',
    solo: true,
    soloTarget: 'b-solo',
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') cfg = { ...cfg, ...saved };
  } catch {}

  const syncUiState = () => {
    const on = !!cfg.enabled;
    if (statusHint) statusHint.textContent = on ? 'Auto-apply · Undo ready' : 'Paused';
    if (liveStateEl) {
      liveStateEl.textContent = on ? 'Active' : 'Paused';
      liveStateEl.dataset.state = on ? 'active' : 'paused';
    }
    if (ruleListEl) ruleListEl.classList.toggle('is-paused', !on);
  };

  const saveCfg = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch {}
    syncUiState();
  };

  const populateSelect = (sel, prefId, fallbacks) => {
    if (!sel) return;
    const list = api.getSceneList?.() || [];
    const prev = sel.value || prefId;
    const existingSig = [...sel.options].map((o) => `${o.value}:${o.textContent}`).join('|');
    const nextSig = list.map((s) => `${s.id}:${s.name}`).join('|');
    if (existingSig !== nextSig) {
      sel.innerHTML = '';
      for (const sc of list) {
        const opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        sel.append(opt);
      }
    }
    const ids = new Set(list.map((s) => s.id));
    if (prev && ids.has(prev)) sel.value = prev;
    else {
      const hit = fallbacks.find((id) => ids.has(id)) || list[0]?.id || '';
      if (hit) sel.value = hit;
    }
  };

  const refreshTargets = () => {
    populateSelect(targetShareStart, cfg.shareStartTarget, ['present', 'v-present', 'game', 'b-grid', 'b-split']);
    populateSelect(targetTwo, cfg.twoTarget, ['b-split', 'interview', 'v-stack', 'b-grid']);
    populateSelect(targetThreePlus, cfg.threePlusTarget, ['b-grid', 'panel', 'b-split']);
    populateSelect(targetSolo, cfg.soloTarget, ['b-solo', 'v-solo', 'b-grid']);
  };

  enChk.checked = !!cfg.enabled;
  if (ruleShareStart) ruleShareStart.checked = !!cfg.shareStart;
  if (ruleShareEnd) ruleShareEnd.checked = !!cfg.shareEnd;
  if (ruleTwo) ruleTwo.checked = !!cfg.two;
  if (ruleThreePlus) ruleThreePlus.checked = !!cfg.threePlus;
  if (ruleSolo) ruleSolo.checked = !!cfg.solo;
  refreshTargets();
  saveCfg();

  const bindToggle = (el, key) => el?.addEventListener('change', () => {
    cfg[key] = !!el.checked;
    suppressedContextKey = '';
    saveCfg();
  });
  const bindSelect = (el, key) => el?.addEventListener('change', () => {
    cfg[key] = el.value;
    suppressedContextKey = '';
    saveCfg();
  });

  bindToggle(enChk, 'enabled');
  bindToggle(ruleShareStart, 'shareStart');
  bindToggle(ruleShareEnd, 'shareEnd');
  bindToggle(ruleTwo, 'two');
  bindToggle(ruleThreePlus, 'threePlus');
  bindToggle(ruleSolo, 'solo');
  bindSelect(targetShareStart, 'shareStartTarget');
  bindSelect(targetTwo, 'twoTarget');
  bindSelect(targetThreePlus, 'threePlusTarget');
  bindSelect(targetSolo, 'soloTarget');

  let baselineInit = false;
  let prevPresenting = false;
  let prevCount = 0;
  let preShareSnapshot = null;
  let lastCountSwitchAt = 0;
  let lastShareSwitchAt = 0;
  let lastUndo = null;
  let suppressedContextKey = '';
  const history = [];

  const sceneNameById = (id) => {
    const sc = (api.getSceneList?.() || []).find((s) => s.id === id);
    return sc?.name || '';
  };

  const captureSnapshot = () => {
    const state = api.getState?.() || {};
    const id = api.activeSceneId?.() || state.scene || '';
    const name = sceneNameById(id) || (state.layout ? state.layout.charAt(0).toUpperCase() + state.layout.slice(1) : 'Previous layout');
    let elements = [];
    try { elements = JSON.parse(JSON.stringify(state.elements || [])); } catch {}
    return {
      id,
      name,
      layout: state.layout || 'solo',
      scene: state.scene || '',
      elements,
    };
  };

  const restoreSnapshot = (snap) => {
    if (!snap) return null;
    if (snap.id) {
      const sc = api.applySceneById?.(snap.id);
      if (sc) return sc;
    }
    api.setStage?.({
      layout: snap.layout || 'solo',
      scene: snap.scene || '',
      elements: Array.isArray(snap.elements) ? snap.elements : [],
    });
    return { id: snap.id || '', name: snap.name || 'Previous layout' };
  };

  const getStageContext = () => {
    const peers = api.getPeers?.() || [];
    const state = api.getState?.() || {};
    const stageIds = Array.isArray(state.stage) ? new Set(state.stage) : null;
    const onStage = stageIds && stageIds.size ? peers.filter((p) => stageIds.has(p.id)) : peers;
    const count = onStage.length || peers.length;
    const presenting = !!api.isPresenting?.();
    const curId = api.activeSceneId?.() || state.scene || '';
    const curName = sceneNameById(curId) || (state.layout ? state.layout.charAt(0).toUpperCase() + state.layout.slice(1) : 'Solo');
    return { count, totalPeers: peers.length, presenting, curId, curName, streamType: state.streamType || 'live' };
  };

  const renderLiveStatus = (ctx) => {
    if (liveCtxEl) {
      const pTxt = `${ctx.count} on stage`;
      const sTxt = ctx.presenting ? 'Screen share live' : 'No screen share';
      liveCtxEl.textContent = `${pTxt} · ${sTxt}`;
    }
    if (liveSceneEl) {
      liveSceneEl.textContent = `Current layout: ${ctx.curName}`;
    }
    const activeRule = ctx.presenting
      ? 'shareStart'
      : ctx.count <= 1 ? 'solo' : ctx.count === 2 ? 'two' : 'threePlus';
    ruleListEl?.querySelectorAll('.sai-rule').forEach((row) => {
      row.classList.toggle('is-matched', row.dataset.saiRule === activeRule);
    });
  };

  const renderHistory = () => {
    if (!historyEl) return;
    historyEl.hidden = !history.length;
    historyEl.replaceChildren();
    for (const item of history.slice(0, 4)) {
      const li = document.createElement('li');
      li.className = 'sai-hist-item' + (item.undone ? ' is-undone' : '');
      const copy = document.createElement('span');
      copy.className = 'sai-hist-copy';
      copy.textContent = item.undone ? `Undid: ${item.reason} → ${item.targetName}` : `${item.reason} → ${item.targetName}`;
      const time = document.createElement('small');
      time.className = 'num';
      time.textContent = item.time;
      li.append(copy, time);
      historyEl.append(li);
    }
  };

  const pushHistory = (entry) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    history.unshift({ ...entry, time, undone: false });
    if (history.length > 6) history.length = 6;
    renderHistory();
  };

  const undoLastSwitch = () => {
    if (!lastUndo?.prevSnapshot) return false;
    const pending = lastUndo;
    lastUndo = null;
    lastCountSwitchAt = Date.now();
    lastShareSwitchAt = Date.now();
    if (pending.contextKey) suppressedContextKey = pending.contextKey;
    const restored = restoreSnapshot(pending.prevSnapshot);
    const restoredName = restored?.name || pending.prevSnapshot.name || 'previous layout';
    if (history[0] && history[0].id === pending.histId) history[0].undone = true;
    renderHistory();
    if (lastActionEl) lastActionEl.textContent = `Reverted to ${restoredName}.`;
    if (undoBtn) undoBtn.hidden = true;
    try { api.toast?.dismiss?.(TOAST_KEY); } catch {}
    api.toast?.(`Restored “${restoredName}” layout.`, { key: 'scene-ai-restored', ms: 3400 });
    renderLiveStatus(getStageContext());
    return true;
  };
  undoBtn?.addEventListener('click', () => undoLastSwitch());

  const executeSwitch = (targetIdOrSnap, reason, opts = {}) => {
    const isShareEvent = !!opts.isShare;
    const isTest = !!opts.isTest;
    const contextKey = opts.contextKey || '';
    if (!isTest && contextKey && suppressedContextKey === contextKey) return false;

    const prevSnapshot = captureSnapshot();
    const targetId = typeof targetIdOrSnap === 'string' ? targetIdOrSnap : targetIdOrSnap?.id || '';
    if (targetId && targetId === prevSnapshot.id && !isTest) return false;

    const now = Date.now();
    if (!isTest) {
      if (isShareEvent && now - lastShareSwitchAt < SHARE_COOLDOWN_MS) return false;
      if (!isShareEvent && now - lastCountSwitchAt < COUNT_COOLDOWN_MS) return false;
    }

    let applied = null;
    if (typeof targetIdOrSnap === 'object' && targetIdOrSnap) {
      applied = restoreSnapshot(targetIdOrSnap);
    } else if (targetId) {
      applied = api.applySceneById?.(targetId);
    }
    if (!applied) return false;

    if (isShareEvent) lastShareSwitchAt = now;
    else lastCountSwitchAt = now;

    const histId = `${now}-${Math.random().toString(36).slice(2, 6)}`;
    lastUndo = { prevSnapshot, targetName: applied.name, reason, contextKey, histId };
    pushHistory({ id: histId, reason, targetName: applied.name });

    if (lastActionEl) lastActionEl.textContent = `${reason} → ${applied.name}`;
    if (undoBtn) undoBtn.hidden = false;
    renderLiveStatus(getStageContext());

    api.toast?.(`Scene AI: ${reason} → ${applied.name}`, {
      key: TOAST_KEY,
      priority: 'high',
      tone: 'scene-ai',
      action: ['Undo', undoLastSwitch],
      ms: 9000,
    });
    return true;
  };

  const resolveShareStartTarget = (streamType) => {
    const chosen = targetShareStart.value || cfg.shareStartTarget;
    if (chosen) return chosen;
    const list = api.getSceneList?.() || [];
    if (streamType === 'gaming' && list.some((s) => s.id === 'game')) return 'game';
    return list.find((s) => /present|slides|screen/.test(s.id))?.id || list[0]?.id || '';
  };

  const evaluateContext = () => {
    try {
      refreshTargets();
      if (!api.inStudio?.() || !api.isHost?.()) {
        baselineInit = false;
        return;
      }
      const ctx = getStageContext();
      renderLiveStatus(ctx);

      if (!baselineInit) {
        baselineInit = true;
        prevPresenting = ctx.presenting;
        prevCount = ctx.count;
        return;
      }

      const curContextKey = ctx.presenting ? 'share:on' : `count:${ctx.count >= 3 ? '3+' : ctx.count}`;
      if (suppressedContextKey && suppressedContextKey !== curContextKey) {
        suppressedContextKey = '';
      }

      if (!cfg.enabled) {
        prevPresenting = ctx.presenting;
        prevCount = ctx.count;
        return;
      }

      // 1. Screen share started — highest priority, immediate switch
      if (!prevPresenting && ctx.presenting && cfg.shareStart) {
        preShareSnapshot = captureSnapshot();
        executeSwitch(resolveShareStartTarget(ctx.streamType), 'Screen share started', {
          isShare: true,
          contextKey: 'share:on',
        });
      }
      // 2. Screen share ended — restore previous layout or match current participant count
      else if (prevPresenting && !ctx.presenting && cfg.shareEnd) {
        const restore = preShareSnapshot;
        preShareSnapshot = null;
        if (restore) {
          executeSwitch(restore, 'Screen share ended', {
            isShare: true,
            contextKey: 'share:off',
          });
        } else if (ctx.count === 1 && cfg.solo) {
          executeSwitch(targetSolo.value || cfg.soloTarget, 'Screen share ended · Solo', { isShare: true, contextKey: 'count:1' });
        } else if (ctx.count === 2 && cfg.two) {
          executeSwitch(targetTwo.value || cfg.twoTarget, 'Screen share ended · 2 on stage', { isShare: true, contextKey: 'count:2' });
        } else if (ctx.count >= 3 && cfg.threePlus) {
          executeSwitch(targetThreePlus.value || cfg.threePlusTarget, `Screen share ended · ${ctx.count} on stage`, { isShare: true, contextKey: 'count:3+' });
        }
      }
      // 3. On-stage participant count changed (while not screen sharing)
      else if (!ctx.presenting && ctx.count !== prevCount && ctx.count > 0) {
        if (ctx.count === 1 && cfg.solo) {
          executeSwitch(targetSolo.value || cfg.soloTarget, 'Solo speaker on stage', { contextKey: 'count:1' });
        } else if (ctx.count === 2 && cfg.two) {
          executeSwitch(targetTwo.value || cfg.twoTarget, '2 participants on stage', { contextKey: 'count:2' });
        } else if (ctx.count >= 3 && cfg.threePlus) {
          executeSwitch(targetThreePlus.value || cfg.threePlusTarget, `${ctx.count} participants on stage`, { contextKey: 'count:3+' });
        }
      }

      prevPresenting = ctx.presenting;
      prevCount = ctx.count;
    } catch (err) {
      console.warn('[scene-ai] evaluateContext error:', err);
    }
  };

  // Per-rule manual Test buttons inside Scene AI panel
  const triggerTest = (ruleKey) => {
    if (!api.isHost?.()) return api.toast?.('Only the host can switch scenes.', { err: true });
    refreshTargets();
    const map = {
      shareStart: [resolveShareStartTarget(api.getState?.()?.streamType || 'live'), 'Screen share started'],
      solo: [targetSolo.value || cfg.soloTarget, 'Solo speaker on stage'],
      two: [targetTwo.value || cfg.twoTarget, '2 participants on stage'],
      threePlus: [targetThreePlus.value || cfg.threePlusTarget, '3+ participants on stage'],
    };
    const spec = map[ruleKey];
    if (!spec) return false;
    const ok = executeSwitch(spec[0], spec[1], { isTest: true, isShare: ruleKey === 'shareStart' });
    if (!ok) {
      api.toast?.('Already using that scene layout — pick another scene to preview a switch.');
    }
    return ok;
  };

  ruleListEl?.querySelectorAll('[data-sai-test]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerTest(btn.dataset.saiTest);
    });
  });

  window.__gatherSceneAi = {
    isEnabled: () => !!cfg.enabled,
    evaluate: evaluateContext,
    triggerTest,
    undo: undoLastSwitch,
    getConfig: () => ({ ...cfg }),
    getState: () => ({ ...getStageContext(), canUndo: !!lastUndo, enabled: !!cfg.enabled }),
  };

  onStudioChange(evaluateContext);
  api.onStateSync?.(evaluateContext);
  // Fast real-time monitor for local/remote screen share track changes & stage transitions
  setInterval(() => {
    if (document.hidden || !api.inStudio?.()) return;
    evaluateContext();
  }, 450);
  evaluateContext();
}

// ---------------------------------------------------------------- 17. STREAM CONTROLLER & MULTI-CAM SWITCHER (DRAGGABLE FLOATING WINDOW + OS PiP + BROADCASTCHANNEL)
function initMultiCamPreview(api) {
  const mount = $('#streamCtrlMount');
  const deck = $('#streamCtrlDeck');
  const popFloatBtn = $('#ctrlPopFloat');
  const popPipBtn = $('#ctrlPopPip');
  const popTabLink = $('#ctrlPopTab');
  const poppedNote = $('#ctrlPoppedNote');
  const poppedMsg = $('#ctrlPoppedMsg');
  const popBackBtn = $('#ctrlPopBack');
  const floatWin = $('#ctrlFloatWin');
  const floatDrag = $('#ctrlFloatDrag');
  const floatBody = $('#ctrlFloatBody');
  const floatMeta = $('#ctrlFloatMeta');
  const floatMinBtn = $('#ctrlFloatMin');
  const floatTabLink = $('#ctrlFloatTab');
  const floatDockBtn = $('#ctrlFloatDock');
  const railToggle = $('#multiCamToggle');
  const showTitleEl = $('#ctrlShowTitle');
  const statusMetaEl = $('#ctrlStatusMeta');
  const transportEl = $('#ctrlTransport');
  const metaEl = $('#multiCamMeta');
  const gridEl = $('#multiCamGrid');
  const scenesEl = $('#ctrlScenes');
  const bannerInput = $('#ctrlBannerInput');
  const bannerShowBtn = $('#ctrlBannerShow');
  const bannerHideBtn = $('#ctrlBannerHide');
  const supersSec = $('#ctrlSupersSec');
  const supersCount = $('#ctrlSupersCount');
  const supersList = $('#ctrlSupersList');
  const floatLed = $('#ctrlFloatLed');
  const airLed = $('#ctrlAirLed');
  const layoutReadout = $('#ctrlLayoutReadout');
  const superBar = $('#ctrlSuperBar');
  const superTitle = $('#ctrlSuperTitle');
  const superAmt = $('#ctrlSuperAmt');
  const superMsg = $('#ctrlSuperMsg');
  const superActs = $('#ctrlSuperActs');
  const superAirBtn = $('#ctrlSuperAir');
  const superDismissBtn = $('#ctrlSuperDismiss');
  const tickPrevBtn = $('#ctrlTickPrev');
  const tickPauseBtn = $('#ctrlTickPause');
  const tickNextBtn = $('#ctrlTickNext');
  const tickSlide = $('#ctrlTickSlide');
  const tickWho = $('#ctrlTickWho');
  const tickTxt = $('#ctrlTickTxt');
  const tickStageBtn = $('#ctrlTickStage');
  const aiCtxEl = $('#ctrlAiCtx');
  const aiRecNameEl = $('#ctrlAiRecName');
  const aiRecReasonEl = $('#ctrlAiRecReason');
  const aiApplyBtn = $('#ctrlAiApply');
  const aiActionsEl = $('#ctrlAiActions');
  const bannerPresetsEl = $('#ctrlBannerPresets');
  if (!mount || !deck || !gridEl) return;

  const POS_KEY = 'gather:ctrlFloatPos';
  const SNAP_KEY_PREFIX = 'gather:ctrlSnap:';
  const CMD_KEY_PREFIX = 'gather:ctrlCmd:';
  let pipWin = null;
  let mode = 'docked'; // 'docked' | 'float' | 'pip'
  let bc = null;
  let bcCode = '';
  let externalPeerLastSeen = 0;
  let snapCanvas = null;
  let snapCtx = null;
  let vuTimer = null;
  let tickTimer = null;
  let tickIdx = 0;
  let tickPaused = false;
  let dismissedSuperIds = new Set();
  let lastSeenSuperId = '';
  let currentSuperItem = null;
  let currentTickerMsg = null;

  const isDeckVisible = () => mode !== 'docked' || !mount.closest('.panel')?.hidden || (Date.now() - externalPeerLastSeen < 15000);
  const makeInitials = (name) => String(name || 'G').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || 'G';

  function updateCompanionHref() {
    const code = api.getStudioCode?.() || '';
    if (code) {
      try { localStorage.setItem('gather:activeStudio', code); } catch {}
    }
    const href = code ? `/controller.html?studio=${encodeURIComponent(code)}` : '/controller.html';
    if (popTabLink) popTabLink.href = href;
    if (floatTabLink) floatTabLink.href = href;
  }

  function ensureBroadcastChannel() {
    const code = api.getStudioCode?.() || '';
    if (!code) {
      if (bc) { try { bc.close(); } catch {} bc = null; bcCode = ''; }
      return;
    }
    if (bc && bcCode === code) return;
    if (bc) { try { bc.close(); } catch {} }
    bcCode = code;
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      bc = new BroadcastChannel('gather-director:' + code);
      bc.onmessage = (ev) => {
        const msg = ev?.data;
        if (!msg || typeof msg !== 'object') return;
        externalPeerLastSeen = Date.now();
        if (msg.type === 'hello' || msg.type === 'ping') {
          broadcastSnapshot(true);
          return;
        }
        if (msg.type === 'cmd') {
          handleCommand(msg.action, msg.payload);
        }
      };
    } catch { bc = null; }
  }

  // Fallback localStorage command listener so standalone /controller.html works even if BroadcastChannel is partitioned
  window.addEventListener('storage', (ev) => {
    const code = api.getStudioCode?.() || '';
    if (!code || !ev.key) return;
    if (ev.key === CMD_KEY_PREFIX + code && ev.newValue) {
      try {
        const msg = JSON.parse(ev.newValue);
        externalPeerLastSeen = Date.now();
        if (msg?.type === 'hello' || msg?.type === 'ping') {
          broadcastSnapshot(true);
        } else if (msg?.type === 'cmd') {
          handleCommand(msg.action, msg.payload);
        }
      } catch {}
    }
  });

  function fireHypeBurst() {
    const emojis = ['🔥', '🎉', '❤️', '👏', '🚀'];
    emojis.forEach((em, i) => {
      setTimeout(() => {
        api.reactFloat?.(em);
        try { api.wsSend?.({ type: 'react', emoji: em }); } catch {}
      }, i * 110);
    });
    api.toast?.('Hype burst fired on stream!');
  }

  function handleCommand(action, payload) {
    if (!api.isHost?.()) return;
    switch (action) {
      case 'mic': api.toggleMic?.(); break;
      case 'cam': api.toggleCam?.(); break;
      case 'rec': api.toggleRec?.(); break;
      case 'live': api.toggleGoLive?.(); break;
      case 'captions': api.toggleCaptions?.(); break;
      case 'clip': api.triggerClip?.(); break;
      case 'scene': if (payload?.id) api.applySceneById?.(String(payload.id)); break;
      case 'stage': if (payload?.id) api.toggleStage?.(String(payload.id)); break;
      case 'mute': if (payload?.id) api.mutePeer?.(String(payload.id)); break;
      case 'banner':
        api.setBanner?.(payload?.text ? String(payload.text).slice(0, 120) : '', '');
        break;
      case 'confirmSuper': if (payload?.id) api.confirmSuper?.(String(payload.id)); break;
      case 'dismissSuper':
        if (payload?.id) {
          dismissedSuperIds.add(String(payload.id));
          api.dismissSuper?.(String(payload.id));
        }
        break;
      case 'featureComment':
        if (payload?.clear) api.featureMessage?.(null);
        else if (payload?.msg) api.featureMessage?.(payload.msg);
        break;
      case 'aiAction':
        if (payload?.kind === 'sam') api.askSamQuick?.();
        else if (payload?.kind === 'vision') api.triggerStageVision?.();
        else if (payload?.kind === 'poll') api.openQuickPoll?.();
        else if (payload?.kind === 'hype') fireHypeBurst();
        break;
      default: break;
    }
    setTimeout(() => { renderController(); broadcastSnapshot(false); }, 60);
  }

  function grabThumb(videoEl) {
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return '';
    try {
      if (!snapCanvas) {
        snapCanvas = document.createElement('canvas');
        snapCanvas.width = 160;
        snapCanvas.height = 90;
        snapCtx = snapCanvas.getContext('2d');
      }
      snapCtx.drawImage(videoEl, 0, 0, 160, 90);
      return snapCanvas.toDataURL('image/jpeg', 0.55);
    } catch { return ''; }
  }

  function getAiRecData() {
    if (window.__gatherLastAiRec) return window.__gatherLastAiRec;
    const peers = api.inStudio?.() ? (api.getPeers?.() || []) : [];
    const presenting = !!api.isPresenting?.();
    const list = api.getSceneList?.() || [];
    const activeId = api.activeSceneId?.() || '';
    const pick = presenting
      ? (list.find((s) => s.layout === 'present') || list[0])
      : peers.length >= 3
        ? (list.find((s) => s.layout === 'grid') || list[0])
        : peers.length === 2
          ? (list.find((s) => s.layout === 'side') || list[0])
          : (list.find((s) => s.layout === 'solo') || list[0]);
    if (!pick) return null;
    return {
      id: pick.id,
      name: pick.name,
      layout: pick.layout || pick.id,
      reason: presenting ? 'Screen share active — maximize slides/content' : peers.length <= 1 ? 'Best framing for 1 speaker on stage' : `Balanced framing for ${peers.length} on stage`,
      ctx: presenting ? `${peers.length || 1} on stage · Screen share` : `${peers.length || 1} ${peers.length === 1 ? 'Host' : 'People'}`,
      isActive: pick.id === activeId,
    };
  }

  function buildSnapshot(includeThumbs = false) {
    const code = api.getStudioCode?.() || '';
    const live = api.getLiveStatus?.() || {};
    const peers = api.inStudio?.() ? (api.getPeers?.() || []) : [];
    const stageIds = new Set(api.getState?.()?.stage || []);
    const scenes = (api.getSceneList?.() || []).slice(0, 12).map((s) => ({ id: s.id, name: s.name, layout: s.layout || '' }));
    const activeSc = api.activeSceneId?.() || '';
    const banner = api.getState?.()?.banner || null;
    const pendingSupers = api.getPendingSupers?.() || [];
    const recentSupers = api.getRecentSupers?.() || pendingSupers;
    const recentComments = api.getRecentMessages?.() || [];
    const featured = api.getFeatured?.() || null;
    const aiRec = getAiRecData();
    return {
      type: 'snapshot',
      ts: Date.now(),
      studio: code,
      isHost: !!api.isHost?.(),
      title: live.title || 'Gather Studio',
      live: !!live.live,
      rec: !!live.rec,
      micOn: !!live.micOn,
      camOn: !!live.camOn,
      captionsOn: !!live.captionsOn,
      viewers: Number(live.viewers) || 0,
      activeSceneId: activeSc,
      scenes,
      banner: banner?.text || '',
      pendingSupers,
      recentSupers,
      recentComments,
      featuredId: featured?.id || '',
      aiRec,
      peers: peers.map((p) => {
        const tile = gridEl.querySelector(`.mc-tile[data-id="${CSS.escape(p.id)}"]`);
        const v = tile?.querySelector('video');
        return {
          id: p.id,
          name: p.name,
          isHost: !!p.isHost,
          me: !!p.me,
          onStage: stageIds.has(p.id),
          mic: !!p.mic,
          cam: !!p.cam,
          level: p.mic ? Math.min(100, Math.round((p.level || 0) * 650)) : 0,
          thumb: includeThumbs && p.cam ? grabThumb(v) : '',
        };
      }),
    };
  }

  let lastThumbAt = 0;
  let lastStorageSnapAt = 0;
  function broadcastSnapshot(forceThumbs = false) {
    const code = api.getStudioCode?.() || '';
    if (!code) return;
    const now = Date.now();
    const hasPeer = now - externalPeerLastSeen < 15000;
    const withThumbs = forceThumbs || (hasPeer && now - lastThumbAt > 1200);
    if (withThumbs) lastThumbAt = now;
    const snap = buildSnapshot(withThumbs);
    if (bc && (hasPeer || forceThumbs)) {
      try { bc.postMessage(snap); } catch {}
    }
    if (forceThumbs || now - lastStorageSnapAt > (hasPeer ? 600 : 1800)) {
      lastStorageSnapAt = now;
      try {
        localStorage.setItem('gather:activeStudio', code);
        localStorage.setItem(SNAP_KEY_PREFIX + code, JSON.stringify(snap));
      } catch {}
    }
  }

  function renderSuperBar() {
    if (!superBar) return;
    const all = (api.getRecentSupers?.() || []).filter((s) => !dismissedSuperIds.has(s.id));
    const pending = all.filter((s) => s.status === 'pending');
    const top = pending[0] || all[0] || null;
    currentSuperItem = top;
    if (!top) {
      superBar.classList.remove('has-alert', 'is-pulse');
      if (superTitle) superTitle.textContent = 'Super Chats Ready';
      if (superAmt) superAmt.hidden = true;
      if (superMsg) superMsg.textContent = 'Paid tips & bounties alert here for 1-tap stage airing.';
      if (superActs) superActs.hidden = true;
      return;
    }
    superBar.classList.add('has-alert');
    if (top.id !== lastSeenSuperId) {
      lastSeenSuperId = top.id;
      superBar.classList.remove('is-pulse');
      void superBar.offsetWidth;
      superBar.classList.add('is-pulse');
    }
    if (superTitle) superTitle.textContent = `${top.name}${top.bounty ? ' · Bounty' : ''}${pending.length > 1 ? ` (+${pending.length - 1})` : ''}`;
    if (superAmt) {
      superAmt.hidden = false;
      superAmt.textContent = `$${Number(top.amount || 0).toFixed(top.amount % 1 ? 2 : 0)}`;
    }
    if (superMsg) superMsg.textContent = top.text || 'Sent a Super Chat!';
    if (superActs) superActs.hidden = false;
    if (superAirBtn) superAirBtn.textContent = top.status === 'pending' ? 'Air' : 'Stage';
  }

  function renderTicker(step = 0) {
    if (!tickWho || !tickTxt) return;
    const msgs = api.getRecentMessages?.() || [];
    if (!msgs.length) {
      currentTickerMsg = null;
      tickWho.textContent = 'Live feed';
      tickTxt.textContent = 'Viewer & studio comments rotate here automatically.';
      if (tickStageBtn) {
        tickStageBtn.disabled = true;
        tickStageBtn.textContent = 'Stage';
        tickStageBtn.classList.remove('is-on');
      }
      return;
    }
    if (step !== 0) {
      tickIdx = (tickIdx + step + msgs.length) % msgs.length;
    } else if (tickIdx >= msgs.length) {
      tickIdx = msgs.length - 1;
    }
    const m = msgs[tickIdx];
    currentTickerMsg = m;
    const srcTag = m.src && m.src !== 'studio' ? ` · ${m.src}` : '';
    tickWho.textContent = `${m.name}${srcTag}${m.paid ? ` · ${m.paid}` : ''}`;
    tickTxt.textContent = m.text || '(attachment)';
    if (tickSlide && step !== 0) {
      tickSlide.classList.remove('ctk-swap');
      void tickSlide.offsetWidth;
      tickSlide.classList.add('ctk-swap');
    }
    if (tickStageBtn) {
      const feat = api.getFeatured?.();
      const isFeat = !!(feat && feat.id === m.id);
      tickStageBtn.disabled = !api.isHost?.();
      tickStageBtn.textContent = isFeat ? 'On air' : 'Stage';
      tickStageBtn.classList.toggle('is-on', isFeat);
    }
  }

  function renderAiDirector() {
    const rec = getAiRecData();
    if (!rec) return;
    if (aiCtxEl) aiCtxEl.textContent = rec.ctx;
    if (aiRecNameEl) aiRecNameEl.textContent = rec.isActive ? `${rec.name} (active)` : `${rec.name} recommended`;
    if (aiRecReasonEl) aiRecReasonEl.textContent = rec.reason;
    if (aiApplyBtn) {
      aiApplyBtn.dataset.sceneId = rec.id;
      aiApplyBtn.disabled = !api.isHost?.() || rec.isActive;
      aiApplyBtn.textContent = rec.isActive ? 'Active' : 'Apply';
      aiApplyBtn.classList.toggle('is-active', rec.isActive);
    }
  }

  function renderTransport() {
    const live = api.getLiveStatus?.() || {};
    const peers = api.inStudio?.() ? (api.getPeers?.() || []) : [];
    const airLabel = live.live ? 'On air' : live.rec ? 'Recording' : 'Off air';
    const vCount = Number(live.viewers) || 0;
    const activeSc = (api.getSceneList?.() || []).find((s) => s.id === api.activeSceneId?.());
    if (showTitleEl) showTitleEl.textContent = live.title || 'Stream Remote';
    if (statusMetaEl) {
      statusMetaEl.textContent = `${airLabel} · ${vCount} watching`;
      statusMetaEl.classList.toggle('is-live', !!live.live);
    }
    if (airLed) {
      airLed.classList.toggle('is-live', !!live.live);
      airLed.classList.toggle('is-rec', !live.live && !!live.rec);
    }
    if (floatLed) {
      floatLed.classList.toggle('is-live', !!live.live);
      floatLed.classList.toggle('is-rec', !live.live && !!live.rec);
    }
    if (layoutReadout && activeSc) layoutReadout.textContent = activeSc.name;
    if (floatMeta) {
      floatMeta.textContent = `${airLabel} · ${peers.length} cam${peers.length === 1 ? '' : 's'}`;
      floatMeta.classList.toggle('is-live', !!live.live);
    }
    const setKey = (key, on, labelOn, labelOff, hot = false) => {
      const btn = transportEl?.querySelector(`[data-ctrl="${key}"]`);
      if (!btn) return;
      btn.setAttribute('aria-pressed', String(!!on));
      btn.classList.toggle('is-on', !!on);
      btn.classList.toggle('is-hot', !!on && hot);
      const lbl = btn.querySelector('span') || btn;
      if (labelOn && labelOff) lbl.textContent = on ? labelOn : labelOff;
    };
    setKey('mic', !!live.micOn, 'Mic on', 'Mic muted');
    setKey('cam', !!live.camOn, 'Cam on', 'Cam off');
    setKey('rec', !!live.rec, 'Stop rec', 'Record', true);
    setKey('live', !!live.live, 'End live', 'Go live', true);
    setKey('captions', !!live.captionsOn, 'CC on', 'Captions');
  }

  function renderScenes() {
    if (!scenesEl) return;
    const list = (api.getSceneList?.() || []).slice(0, 8);
    const activeId = api.activeSceneId?.() || '';
    const sig = list.map((s) => `${s.id}:${s.name}:${s.id === activeId ? 1 : 0}`).join('|');
    if (scenesEl.dataset.sig === sig) return;
    scenesEl.dataset.sig = sig;
    scenesEl.textContent = '';
    for (const sc of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctrl-scene-btn' + (sc.id === activeId ? ' is-active' : '');
      btn.dataset.ly = sc.layout || sc.id;
      const led = document.createElement('i');
      led.className = 'ctrl-led';
      led.setAttribute('aria-hidden', 'true');
      const txt = document.createElement('span');
      txt.textContent = sc.name;
      btn.append(led, txt);
      btn.setAttribute('aria-pressed', String(sc.id === activeId));
      btn.addEventListener('click', () => handleCommand('scene', { id: sc.id }));
      scenesEl.append(btn);
    }
  }

  function renderPendingSupers() {
    if (!supersSec || !supersList) return;
    const list = api.getPendingSupers?.() || [];
    supersSec.hidden = list.length === 0;
    if (supersCount) supersCount.textContent = String(list.length);
    const sig = list.map((x) => `${x.id}:${x.amount}:${x.text}`).join('|');
    if (supersList.dataset.sig === sig) return;
    supersList.dataset.sig = sig;
    supersList.textContent = '';
    for (const item of list) {
      const row = document.createElement('div');
      row.className = 'ctrl-super-item';
      const top = document.createElement('div');
      top.className = 'ctrl-super-top';
      const amt = document.createElement('b');
      amt.className = 'num';
      amt.textContent = `$${item.amount}`;
      const who = document.createElement('span');
      who.textContent = `${item.name}${item.bounty ? ' · Bounty' : ''}`;
      top.append(amt, who);
      const msg = document.createElement('p');
      msg.textContent = item.text || '(no message)';
      const acts = document.createElement('div');
      acts.className = 'ctrl-super-acts';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn sm primary';
      ok.textContent = 'Confirm & air';
      ok.addEventListener('click', () => handleCommand('confirmSuper', { id: item.id }));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'btn sm ghost';
      no.textContent = 'Dismiss';
      no.addEventListener('click', () => handleCommand('dismissSuper', { id: item.id }));
      acts.append(ok, no);
      row.append(top, msg, acts);
      supersList.append(row);
    }
  }

  function renderMultiCam() {
    const peers = api.inStudio?.() ? (api.getPeers?.() || []) : [];
    const stageIds = new Set(api.getState?.()?.stage || []);
    const onStageCount = peers.filter((p) => stageIds.has(p.id)).length;
    if (metaEl) {
      metaEl.textContent = peers.length
        ? `${peers.length} camera${peers.length === 1 ? '' : 's'} · ${onStageCount} on stage`
        : 'Waiting for feeds';
    }

    if (!peers.length) {
      gridEl.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'mc-empty';
      empty.textContent = 'Join or start a studio to monitor and switch camera feeds here.';
      gridEl.append(empty);
      return;
    }
    gridEl.querySelector('.mc-empty')?.remove();

    const keep = new Set(peers.map((p) => p.id));
    for (const el of $$('.mc-tile', gridEl)) {
      if (!keep.has(el.dataset.id)) el.remove();
    }

    for (const p of peers) {
      let tile = gridEl.querySelector(`.mc-tile[data-id="${CSS.escape(p.id)}"]`);
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'mc-tile';
        tile.dataset.id = p.id;

        const vbox = document.createElement('div');
        vbox.className = 'mc-video-box';
        const video = document.createElement('video');
        video.playsInline = true;
        video.autoplay = true;
        video.muted = true;
        const ini = document.createElement('div');
        ini.className = 'mc-ini';
        ini.hidden = true;
        const iniSpan = document.createElement('span');
        ini.append(iniSpan);
        const stateEl = document.createElement('span');
        stateEl.className = 'mc-state';
        const vu = document.createElement('div');
        vu.className = 'mc-vu';
        vu.setAttribute('aria-hidden', 'true');
        vu.append(document.createElement('i'));
        vbox.append(video, ini, stateEl, vu);

        const foot = document.createElement('div');
        foot.className = 'mc-foot';
        const nameEl = document.createElement('span');
        nameEl.className = 'mc-name';
        const btns = document.createElement('div');
        btns.className = 'mc-btns';
        const stageBtn = document.createElement('button');
        stageBtn.type = 'button';
        stageBtn.className = 'mc-btn mc-stage-btn';
        stageBtn.addEventListener('click', () => handleCommand('stage', { id: p.id }));
        const muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'mc-btn mc-mute-btn';
        muteBtn.title = 'Mute guest';
        muteBtn.textContent = 'Mute';
        muteBtn.addEventListener('click', () => {
          handleCommand('mute', { id: p.id });
          api.toast?.(`Muted ${p.name}.`);
        });
        btns.append(stageBtn, muteBtn);
        foot.append(nameEl, btns);
        tile.append(vbox, foot);
        gridEl.append(tile);
      }

      const v = $('video', tile);
      const ini = $('.mc-ini', tile);
      const iniSpan = $('span', ini);
      const stateEl = $('.mc-state', tile);
      const nameEl = $('.mc-name', tile);
      const stageBtn = $('.mc-stage-btn', tile);
      const muteBtn = $('.mc-mute-btn', tile);

      if (p.me) {
        const ov = api.outVideo?.();
        const curTrack = v.srcObject?.getVideoTracks?.()[0];
        if (ov && curTrack !== ov) {
          v.srcObject = new MediaStream([ov]);
          v.play().catch(() => {});
        } else if (!ov && v.srcObject) {
          v.srcObject = null;
        }
        v.classList.toggle('mirror', !!api.getMirror?.());
      } else if (p.peer?.stream) {
        if (v.srcObject !== p.peer.stream) {
          v.srcObject = p.peer.stream;
          v.play().catch(() => {});
        }
      }

      const camActive = !!p.cam && (p.me ? !!api.outVideo?.() : !!(p.peer?.stream?.getVideoTracks?.().length));
      ini.hidden = camActive;
      if (iniSpan) iniSpan.textContent = makeInitials(p.name);

      const onStage = stageIds.has(p.id);
      tile.classList.toggle('on-stage', onStage);
      if (stateEl) {
        stateEl.textContent = onStage ? 'On stage' : 'Backstage';
        stateEl.classList.toggle('on', onStage);
      }
      if (nameEl) {
        nameEl.textContent = p.name + (p.isHost ? ' (Host)' : p.me ? ' (You)' : '');
      }
      if (stageBtn) {
        stageBtn.textContent = onStage ? 'Take off' : 'On stage';
        stageBtn.classList.toggle('on', onStage);
        stageBtn.disabled = !api.isHost?.();
      }
      if (muteBtn) {
        muteBtn.hidden = !!p.me;
        muteBtn.disabled = !api.isHost?.() || !p.mic;
      }
    }
  }

  function renderController() {
    updateCompanionHref();
    ensureBroadcastChannel();
    if (!isDeckVisible()) return;
    renderTransport();
    renderSuperBar();
    renderTicker(0);
    renderAiDirector();
    renderMultiCam();
    renderScenes();
    renderPendingSupers();
  }

  function tickVu() {
    if (!isDeckVisible()) return;
    const peers = api.inStudio?.() ? (api.getPeers?.() || []) : [];
    const byId = new Map(peers.map((p) => [p.id, p]));
    for (const tile of $$('.mc-tile', gridEl)) {
      const p = byId.get(tile.dataset.id);
      const bar = $('.mc-vu i', tile);
      if (!bar) continue;
      const pct = p && p.mic ? Math.min(100, Math.round((p.level || 0) * 650)) : 0;
      bar.style.width = pct + '%';
    }
    renderSuperBar();
    renderAiDirector();
    broadcastSnapshot(false);
  }

  // Super Chat bar, Rotating Ticker, AI Director, Transport & Banner listeners
  superAirBtn?.addEventListener('click', () => {
    if (!currentSuperItem) return;
    if (currentSuperItem.status === 'pending') {
      handleCommand('confirmSuper', { id: currentSuperItem.id });
    } else {
      handleCommand('featureComment', {
        msg: { id: 'sc-' + currentSuperItem.id, src: 'watch', name: currentSuperItem.name, text: currentSuperItem.text || 'Sent a Super Chat!', paid: `$${currentSuperItem.amount}` },
      });
    }
  });
  superDismissBtn?.addEventListener('click', () => {
    if (!currentSuperItem) return;
    handleCommand('dismissSuper', { id: currentSuperItem.id });
  });
  tickPrevBtn?.addEventListener('click', () => renderTicker(-1));
  tickNextBtn?.addEventListener('click', () => renderTicker(1));
  tickPauseBtn?.addEventListener('click', () => {
    tickPaused = !tickPaused;
    tickPauseBtn.setAttribute('aria-pressed', String(tickPaused));
    tickPauseBtn.textContent = tickPaused ? '▶' : '⏸';
  });
  tickStageBtn?.addEventListener('click', () => {
    if (!currentTickerMsg) return;
    const feat = api.getFeatured?.();
    if (feat && feat.id === currentTickerMsg.id) {
      handleCommand('featureComment', { clear: true });
    } else {
      handleCommand('featureComment', { msg: currentTickerMsg });
    }
  });
  aiApplyBtn?.addEventListener('click', () => {
    const id = aiApplyBtn.dataset.sceneId;
    if (id) handleCommand('scene', { id });
  });
  aiActionsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ai-act]');
    if (!btn) return;
    handleCommand('aiAction', { kind: btn.dataset.aiAct });
  });
  bannerPresetsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-banner]');
    if (!btn) return;
    if (bannerInput) bannerInput.value = btn.dataset.banner || '';
    handleCommand('banner', { text: btn.dataset.banner || '' });
  });

  if (!tickTimer) {
    tickTimer = setInterval(() => {
      if (!tickPaused && isDeckVisible()) renderTicker(1);
    }, 4500);
  }

  // Transport & banner buttons inside the Stream Controller (work both docked AND popped out)
  transportEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctrl]');
    if (!btn) return;
    handleCommand(btn.dataset.ctrl);
  });
  bannerShowBtn?.addEventListener('click', () => {
    const txt = (bannerInput?.value || '').trim();
    if (!txt) return api.toast?.('Type a banner message first.');
    handleCommand('banner', { text: txt });
  });
  bannerHideBtn?.addEventListener('click', () => {
    handleCommand('banner', { text: '' });
  });
  bannerInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      bannerShowBtn?.click();
    }
  });

  function replayDeckVideos() {
    for (const v of deck.querySelectorAll('video')) { v.play?.().catch(() => {}); }
  }

  function clampFloatPos(left, top) {
    if (!floatWin) return { left: 16, top: 72 };
    const rect = floatWin.getBoundingClientRect();
    const w = rect.width || 384;
    const h = rect.height || 520;
    const maxL = Math.max(8, window.innerWidth - w - 8);
    const maxT = Math.max(8, window.innerHeight - Math.min(h, 140) - 8);
    return {
      left: Math.round(Math.max(8, Math.min(maxL, left))),
      top: Math.round(Math.max(8, Math.min(maxT, top))),
    };
  }

  function applyFloatPos(pos) {
    if (!floatWin) return;
    const clamped = clampFloatPos(pos.left, pos.top);
    floatWin.style.left = `${clamped.left}px`;
    floatWin.style.top = `${clamped.top}px`;
    floatWin.style.right = 'auto';
    floatWin.style.bottom = 'auto';
    return clamped;
  }

  function restoreFloatPos() {
    if (!floatWin) return;
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        applyFloatPos(saved);
        return;
      }
    } catch {}
    const defW = Math.min(390, window.innerWidth - 24);
    applyFloatPos({ left: Math.max(12, window.innerWidth - defW - 84), top: 72 });
  }

  // Draggable header for the always-on-top floating Stream Controller window
  if (floatDrag && floatWin) {
    let dragging = false;
    let startX = 0, startY = 0, origL = 0, origT = 0;
    floatDrag.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('button, a, input')) return;
      dragging = true;
      const rect = floatWin.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origL = rect.left;
      origT = rect.top;
      floatWin.classList.add('is-dragging');
      try { floatDrag.setPointerCapture(e.pointerId); } catch {}
    });
    floatDrag.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applyFloatPos({ left: origL + (e.clientX - startX), top: origT + (e.clientY - startY) });
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      floatWin.classList.remove('is-dragging');
      try { floatDrag.releasePointerCapture(e.pointerId); } catch {}
      const rect = floatWin.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) })); } catch {}
    };
    floatDrag.addEventListener('pointerup', endDrag);
    floatDrag.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => {
      if (mode !== 'float' || floatWin.hidden) return;
      const rect = floatWin.getBoundingClientRect();
      applyFloatPos({ left: rect.left, top: rect.top });
    });
  }

  function bringDeckBack() {
    mode = 'docked';
    if (deck.parentNode !== mount) mount.append(deck);
    if (floatWin) {
      floatWin.hidden = true;
      floatWin.classList.remove('is-min');
    }
    if (pipWin) {
      const w = pipWin;
      pipWin = null;
      try { w.close(); } catch {}
    }
    if (poppedNote) poppedNote.hidden = true;
    if (popFloatBtn) popFloatBtn.textContent = 'Pop out floating window';
    if (popPipBtn) popPipBtn.textContent = 'OS window';
    railToggle?.classList.remove('is-popped');
    replayDeckVideos();
    renderController();
  }

  function openFloatingWindow() {
    if (!floatWin || !floatBody) return;
    if (pipWin) {
      const w = pipWin;
      pipWin = null;
      try { w.close(); } catch {}
    }
    mode = 'float';
    floatWin.hidden = false;
    floatWin.classList.remove('is-min');
    if (deck.parentNode !== floatBody) floatBody.append(deck);
    restoreFloatPos();
    if (poppedNote) poppedNote.hidden = false;
    if (poppedMsg) poppedMsg.textContent = 'Floating Stream Controller is open — drag it anywhere and switch tabs freely.';
    if (popFloatBtn) popFloatBtn.textContent = 'Floating (open)';
    railToggle?.classList.add('is-popped');
    replayDeckVideos();
    renderController();
  }

  async function openDocumentPip() {
    if (pipWin && !pipWin.closed) {
      try { pipWin.focus(); } catch {}
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      openFloatingWindow();
      api.toast?.('Opened draggable floating Stream Controller.');
      return;
    }
    try {
      const w = await window.documentPictureInPicture.requestWindow({ width: 420, height: 680 });
      pipWin = w;
      mode = 'pip';
      if (floatWin) floatWin.hidden = true;
      w.document.title = 'Gather Stream Controller';
      w.document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'dark');
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const clone = w.document.createElement('link');
        clone.rel = 'stylesheet';
        clone.href = link.href;
        w.document.head.append(clone);
      }
      const padStyle = w.document.createElement('style');
      padStyle.textContent = 'html,body{margin:0;padding:0;min-height:100vh;background:var(--bg,#0b1020);color:var(--ink,#f1f5f9);overflow-y:auto;}body{padding:12px;box-sizing:border-box;}';
      w.document.head.append(padStyle);
      w.document.body.append(deck);
      replayDeckVideos();
      if (poppedNote) poppedNote.hidden = false;
      if (poppedMsg) poppedMsg.textContent = 'Controller is popped out in an OS always-on-top window.';
      if (popPipBtn) popPipBtn.textContent = 'Focus OS window';
      railToggle?.classList.add('is-popped');
      w.addEventListener('pagehide', bringDeckBack, { once: true });
      renderController();
    } catch {
      openFloatingWindow();
      api.toast?.('Opened draggable floating Stream Controller (OS PiP unavailable in embedded view).');
    }
  }

  popFloatBtn?.addEventListener('click', () => (mode === 'float' ? bringDeckBack() : openFloatingWindow()));
  popPipBtn?.addEventListener('click', openDocumentPip);
  popBackBtn?.addEventListener('click', bringDeckBack);
  floatDockBtn?.addEventListener('click', bringDeckBack);
  floatMinBtn?.addEventListener('click', () => {
    if (!floatWin) return;
    const min = floatWin.classList.toggle('is-min');
    floatMinBtn.setAttribute('aria-label', min ? 'Expand floating controller' : 'Minimize floating controller');
    floatMinBtn.dataset.tip = min ? 'Expand' : 'Minimize';
  });
  if (!('documentPictureInPicture' in window) && popPipBtn) {
    popPipBtn.hidden = true;
  }

  if (!vuTimer) vuTimer = setInterval(() => { renderTransport(); tickVu(); }, 260);

  onStudioChange(renderController);
  api.onStateSync?.(renderController);
  railToggle?.addEventListener('click', () => setTimeout(renderController, 30));
  renderController();
}

// ---------------------------------------------------------------- 18. GUEST-ONLY MOOD CHECK (10-MIN RECHARTS MINI-GRAPH + 3-MIN SILENCE ALERT)
function initGuestMoodCheck(api) {
  const wrap = $('#guestMoodCheck');
  const toggleBtn = $('#guestMoodToggle');
  const grid = $('#guestMoodGrid');
  if (!wrap || !grid) return;

  const SILENCE_ALERT_SEC = 180; // 3 minutes (confirmed preference)
  const MAX_SAMPLES = 60; // 60 * 10s = 10-minute rolling window
  const history = new Map(); // guestId -> { name, samples: [{t, level}], lastActiveAt, joinedAt }

  let collapsed = false;
  toggleBtn?.addEventListener('click', () => {
    collapsed = !collapsed;
    grid.hidden = collapsed;
    toggleBtn.textContent = collapsed ? 'Show' : 'Hide';
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });

  function ensureGuest(p, now) {
    let rec = history.get(p.id);
    if (!rec) {
      rec = {
        name: p.name || 'Guest',
        samples: [{ t: now, level: p.mic ? Math.min(100, Math.round((p.level || 0) * 650)) : 0 }],
        lastActiveAt: now,
        joinedAt: now,
      };
      history.set(p.id, rec);
    } else {
      rec.name = p.name || rec.name;
    }
    return rec;
  }

  function formatSilence(sec) {
    if (sec < 12) return 'Active now';
    if (sec < 60) return `Quiet ${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `Silent ${m}m ${String(s).padStart(2, '0')}s`;
  }

  function sampleAndRender() {
    if (!api.isHost?.()) return;
    const now = Date.now();
    const peers = api.inStudio?.() ? (api.getPeers?.() || []) : [];
    const guests = peers.filter((p) => !p.isHost && !p.me);
    const stageIds = new Set(api.getState?.()?.stage || []);

    const activeIds = new Set(guests.map((g) => g.id));
    for (const id of history.keys()) {
      if (!activeIds.has(id)) history.delete(id);
    }

    if (!guests.length) {
      grid.innerHTML = '<div class="gmood-empty">No guests connected yet. Private 10-minute mic activity graphs appear here once guests join.</div>';
      return;
    }
    grid.querySelector('.gmood-empty')?.remove();

    for (const el of $$('.gmood-card', grid)) {
      if (!activeIds.has(el.dataset.id)) el.remove();
    }

    for (const p of guests) {
      const rec = ensureGuest(p, now);
      const level = p.mic ? Math.min(100, Math.round((p.level || 0) * 650)) : 0;
      if (level >= 8) rec.lastActiveAt = now;

      const lastSample = rec.samples[rec.samples.length - 1];
      if (!lastSample || now - lastSample.t >= 9500) {
        rec.samples.push({ t: now, level });
        if (rec.samples.length > MAX_SAMPLES) rec.samples.splice(0, rec.samples.length - MAX_SAMPLES);
      } else {
        lastSample.level = Math.max(lastSample.level, level);
      }

      const silentSec = Math.max(0, Math.floor((now - rec.lastActiveAt) / 1000));
      const isSilentAlert = silentSec >= SILENCE_ALERT_SEC;
      const onStage = stageIds.has(p.id);

      let card = grid.querySelector(`.gmood-card[data-id="${CSS.escape(p.id)}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'gmood-card';
        card.dataset.id = p.id;
        card.innerHTML = `
          <div class="gmood-top">
            <div class="gmood-who">
              <b class="gmood-name"></b>
              <span class="gmood-stage"></span>
            </div>
            <span class="gmood-timer num"></span>
          </div>
          <div class="gmood-chart" aria-label="10-minute microphone activity chart"></div>
          <div class="gmood-foot">
            <span class="gmood-alert" hidden>Silent 3+ min</span>
            <span class="gmood-ok">Mic trend · last 10 min</span>
            <button type="button" class="btn sm ghost gmood-act"></button>
          </div>
        `;
        $('.gmood-act', card).addEventListener('click', () => {
          if (!api.isHost?.()) return;
          if (!stageIds.has(p.id)) {
            api.toggleStage?.(p.id);
            api.toast?.(`Brought ${p.name} on stage.`);
          } else {
            api.toast?.(`${p.name} is already on stage — consider bringing them into the conversation.`);
          }
        });
        grid.append(card);
      }

      card.classList.toggle('is-silent', isSilentAlert);
      $('.gmood-name', card).textContent = p.name;
      $('.gmood-stage', card).textContent = onStage ? 'On stage' : 'Backstage';
      $('.gmood-timer', card).textContent = formatSilence(silentSec);
      $('.gmood-alert', card).hidden = !isSilentAlert;
      $('.gmood-ok', card).hidden = isSilentAlert;
      const actBtn = $('.gmood-act', card);
      actBtn.textContent = onStage ? 'Check in' : 'Bring on stage';
      actBtn.hidden = !isSilentAlert && onStage;

      const chartEl = $('.gmood-chart', card);
      if (chartEl && window.gatherMoodChart?.renderGuest) {
        window.gatherMoodChart.renderGuest(chartEl, rec.samples, isSilentAlert, p.id);
      }
    }
  }

  onSpeechOrChat((ev) => {
    if (!ev?.from || ev.source !== 'caption') return;
    const rec = history.get(ev.from);
    if (rec) {
      rec.lastActiveAt = Date.now();
      const last = rec.samples[rec.samples.length - 1];
      if (last) last.level = Math.max(last.level, 55);
    }
  });

  onStudioChange(sampleAndRender);
  setInterval(sampleAndRender, 10000);
  sampleAndRender();
}

// ---------------------------------------------------------------- 19. SMART HIGHLIGHTS AI AGENT + AI TRIGGER LIBRARY
function initSmartHighlightsAndTriggers(api) {
  // ---- A. SMART HIGHLIGHTS AI AGENT (MONITOR SPEAKER TRANSITIONS → 30S CLIPS → MEDIA LIBRARY)
  const shCount = $('#shCount');
  const shAddAllBtn = $('#shAddAllBtn');
  const shCaptureBtn = $('#shCaptureBtn');
  const shEvalNowBtn = $('#shEvalNowBtn');
  const shAgentToggle = $('#shAgentToggle');
  const shAgentSens = $('#shAgentSens');
  const shAutoSaveLib = $('#shAutoSaveLib');
  const shAgentStatus = $('#shAgentStatus');
  const shList = $('#shList');
  const shEmpty = $('#shEmpty');

  const sessionStart = Date.now();
  const highlights = []; // { id, speaker, snippet, reason, ts, elapsedMs, durationSec, peak, added, clipState, clipId, clipBlob, libraryItemId, fromAgent }
  const pendingMomentByClipId = new Map();

  // Persistent agent preferences
  let agentEnabled = store.get('shAgentEnabled', true);
  let agentSensitivity = store.get('shAgentSens', 'balanced');
  let autoSaveToLibrary = store.get('shAutoSaveLib', true);

  if (shAgentToggle) {
    shAgentToggle.checked = !!agentEnabled;
    shAgentToggle.addEventListener('change', () => {
      agentEnabled = !!shAgentToggle.checked;
      store.set('shAgentEnabled', agentEnabled);
      setAgentStatus(agentEnabled ? `Monitoring speaker activity · ${transitionLog.length} transition${transitionLog.length === 1 ? '' : 's'}` : 'Agent paused');
    });
  }
  if (shAgentSens) {
    shAgentSens.value = ['high', 'balanced', 'selective'].includes(agentSensitivity) ? agentSensitivity : 'balanced';
    shAgentSens.addEventListener('change', () => {
      agentSensitivity = shAgentSens.value;
      store.set('shAgentSens', agentSensitivity);
    });
  }
  if (shAutoSaveLib) {
    shAutoSaveLib.checked = !!autoSaveToLibrary;
    shAutoSaveLib.addEventListener('change', () => {
      autoSaveToLibrary = !!shAutoSaveLib.checked;
      store.set('shAutoSaveLib', autoSaveToLibrary);
    });
  }

  // Real-time speaker transition telemetry
  const transitionLog = []; // { from, to, gapMs, overlap, energy, at }
  const recentChatTs = [];
  let prevActiveSpeaker = null; // { id, name, lastHeardAt, peakLevel }
  let lastEvalAt = 0;
  let lastAutoClipAt = 0;
  let evaluating = false;

  const SENS_CFG = {
    high: { speakThresh: 0.055, minEnergy: 0.08, maxGapMs: 4500, evalCooldownMs: 12000, clipCooldownMs: 22000 },
    balanced: { speakThresh: 0.065, minEnergy: 0.11, maxGapMs: 3600, evalCooldownMs: 16000, clipCooldownMs: 35000 },
    selective: { speakThresh: 0.085, minEnergy: 0.16, maxGapMs: 2600, evalCooldownMs: 22000, clipCooldownMs: 55000 },
  };
  const cfg = () => SENS_CFG[agentSensitivity] || SENS_CFG.balanced;

  function setAgentStatus(text, tone = '') {
    if (!shAgentStatus) return;
    shAgentStatus.textContent = text;
    shAgentStatus.classList.toggle('is-active', tone === 'active');
    shAgentStatus.classList.toggle('is-err', tone === 'err');
  }

  function getChatVelocity() {
    const cutoff = Date.now() - 30_000;
    while (recentChatTs.length && recentChatTs[0] < cutoff) recentChatTs.shift();
    return recentChatTs.length;
  }

  function renderHighlights() {
    if (!shList) return;
    if (shCount) shCount.textContent = `${highlights.length} moment${highlights.length === 1 ? '' : 's'}`;
    if (shEmpty) shEmpty.hidden = highlights.length > 0;
    shList.innerHTML = '';

    for (const h of highlights) {
      const li = document.createElement('li');
      li.className = 'sh-card' + (h.added ? ' is-added' : '');
      li.innerHTML = `
        <div class="sh-head">
          <b class="sh-speaker"></b>
          <span class="sh-time num"></span>
        </div>
        <p class="sh-snip"></p>
        <div class="sh-foot">
          <span class="sh-dur num"></span>
          <span class="sh-card-acts">
            <button type="button" class="btn sm sh-present" hidden>Present</button>
            <button type="button" class="btn sm ghost sh-del" aria-label="Remove highlight">Remove</button>
          </span>
        </div>
      `;
      $('.sh-speaker', li).textContent = h.speaker;
      $('.sh-time', li).textContent = fmtClock(h.elapsedMs);
      $('.sh-snip', li).textContent = h.snippet;

      const durEl = $('.sh-dur', li);
      if (h.clipState === 'capturing') {
        durEl.textContent = `Capturing 30s clip…${h.reason ? ` · ${h.reason}` : ''}`;
      } else if (h.added) {
        durEl.textContent = `Saved to library · ${h.durationSec}s${h.clipBlob ? ' video' : ''}`;
      } else {
        durEl.textContent = `${h.durationSec}s clip${h.reason ? ` · ${h.reason}` : ''}`;
      }

      const presBtn = $('.sh-present', li);
      if (h.clipBlob || h.libraryItemId) {
        presBtn.hidden = false;
        presBtn.addEventListener('click', () => {
          if (h.libraryItemId) {
            const found = (api.getLibrary?.() || []).find((it) => it.id === h.libraryItemId);
            if (found) return api.presentLibrary?.(found);
          }
          if (h.clipBlob) {
            api.presentVideoBlob?.(h.clipBlob, `${h.speaker || 'Smart Highlight'}.webm`);
          }
        });
      }

      $('.sh-del', li).addEventListener('click', () => {
        const idx = highlights.findIndex((x) => x.id === h.id);
        if (idx >= 0) {
          highlights.splice(idx, 1);
          renderHighlights();
          window.gatherCloud?.deleteHighlight?.(h.id).catch(() => {});
        }
      });
      shList.append(li);
    }
    document.dispatchEvent(new CustomEvent('gather:clips-updated'));
  }

  async function renderHighlightCardBlob(h) {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const ctx = c.getContext('2d');
    const brandColor = api.getBrand?.()?.color || '#3b82f6';

    ctx.fillStyle = '#090d1a';
    ctx.fillRect(0, 0, 1280, 720);
    try {
      const stageCanvas = api.getCanvas?.();
      if (stageCanvas && stageCanvas.width > 0 && stageCanvas.height > 0) {
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.drawImage(stageCanvas, 0, 0, 1280, 720);
        ctx.restore();
      }
    } catch {}

    const grad = ctx.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, 'rgba(9, 13, 26, 0.88)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0.92)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    ctx.fillStyle = brandColor;
    ctx.font = '700 22px system-ui, -apple-system, sans-serif';
    ctx.fillText(`SMART HIGHLIGHT  ·  ${fmtClock(h.elapsedMs)}  ·  ${h.durationSec}s`, 84, 126);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 54px system-ui, -apple-system, sans-serif';
    ctx.fillText(String(h.speaker || 'Highlight').slice(0, 34), 84, 210);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 34px system-ui, -apple-system, sans-serif';
    const words = String(h.snippet || '').split(/\s+/);
    let line = '', y = 290;
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (ctx.measureText(cand).width > 1100 && line) {
        ctx.fillText(line, 84, y);
        line = w;
        y += 48;
        if (y > 580) break;
      } else line = cand;
    }
    if (line && y <= 580) ctx.fillText(line, 84, y);

    return new Promise((resolve) => c.toBlob((blob) => resolve(blob), 'image/png'));
  }

  /** Capture a short live stage WebM video fallback when the rolling 30s buffer hasn't filled its first segment yet. */
  async function captureLiveStageFallbackBlob(durationMs = 2200) {
    const stageCanvas = api.getCanvas?.();
    if (!stageCanvas?.captureStream || !window.MediaRecorder) return null;
    const mime = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return null;
    try {
      const vs = stageCanvas.captureStream(24);
      const mix = api.getMixStream?.();
      const stream = new MediaStream([...vs.getVideoTracks(), ...(mix ? mix.getAudioTracks() : [])]);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const done = new Promise((resolve) => { rec.onstop = resolve; });
      rec.start();
      await new Promise((r) => setTimeout(r, durationMs));
      if (rec.state === 'recording') rec.stop();
      await done;
      vs.getVideoTracks().forEach((t) => t.stop());
      return chunks.length ? new Blob(chunks, { type: mime.split(';')[0] }) : null;
    } catch {
      return null;
    }
  }

  async function saveHighlightToMediaLibrary(h, videoBlob = null) {
    if (!api.addLibraryBlob) return null;
    const blob = videoBlob || h.clipBlob || await renderHighlightCardBlob(h);
    if (!blob) return null;
    const isVideo = !!(videoBlob || h.clipBlob) || String(blob.type || '').startsWith('video/');
    const labelBase = String(h.title || h.speaker || 'Smart Highlight').trim();
    const itemName = `Highlight · ${labelBase} (${fmtClock(h.elapsedMs)})`.slice(0, 80);
    const saved = await api.addLibraryBlob({
      name: itemName,
      kind: isVideo ? 'video' : 'image',
      blob,
      type: isVideo ? (blob.type || 'video/webm') : 'image/png',
    });
    if (saved) {
      h.added = true;
      h.libraryItemId = saved.id;
      if (isVideo) h.clipBlob = blob;
      h.clipState = 'ready';
      renderHighlights();
      window.gatherCloud?.saveHighlight?.(h).catch(() => {});
    }
    return saved;
  }

  function addHighlight({ speaker, title = '', snippet, reason = '', durationSec = 30, peak = 0.85, clipState = 'ready', clipId = '', fromAgent = false }) {
    const cleanSpeaker = String(speaker || api.getMyName?.() || 'Speaker').trim().slice(0, 60);
    const cleanTitle = String(title || '').trim().slice(0, 52);
    const cleanSnippet = String(snippet || 'High-engagement speaker moment').trim().slice(0, 155);
    const entry = {
      id: 'sh-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      speaker: cleanSpeaker,
      title: cleanTitle,
      snippet: cleanTitle && !cleanSnippet.toLowerCase().startsWith(cleanTitle.toLowerCase())
        ? `${cleanTitle} — ${cleanSnippet}`.slice(0, 155)
        : cleanSnippet,
      reason: String(reason || '').trim().slice(0, 40),
      ts: Date.now(),
      elapsedMs: Math.max(0, Date.now() - sessionStart),
      durationSec: Math.max(5, Math.min(60, Math.round(Number(durationSec) || 30))),
      peak,
      added: false,
      clipState,
      clipId,
      clipBlob: null,
      libraryItemId: '',
      fromAgent,
    };
    highlights.unshift(entry);
    if (highlights.length > 15) highlights.length = 15;
    renderHighlights();
    window.gatherCloud?.saveHighlight?.(entry).catch(() => {});
    return entry;
  }

  /** Trigger a 30-second clip capture tied to a Smart Highlight entry, then auto-save as a video item in Media Library. */
  async function generate30sSmartHighlight({ speaker, title, snippet, reason = 'Speaker transition', peak = 0.9, fromAgent = true, forceSaveToLib = autoSaveToLibrary }) {
    const clipLabel = String(title || speaker || '30s Highlight').slice(0, 56);
    const clipsApi = window.__gatherClips;
    const moment = clipsApi?.mark ? clipsApi.mark(clipLabel, 'ai-agent') : null;

    if (moment && moment.state === 'capturing') {
      const entry = addHighlight({
        speaker,
        title,
        snippet,
        reason,
        durationSec: 30,
        peak,
        clipState: 'capturing',
        clipId: moment.id,
        fromAgent,
      });
      pendingMomentByClipId.set(moment.id, { entry, forceSaveToLib });
      setAgentStatus(`Capturing 30s clip: ${clipLabel}…`, 'active');
      api.toast?.(`AI Highlight Agent detected “${clipLabel}” — capturing 30s clip.`, { ms: 3200 });
      return entry;
    }

    // Buffer wasn't running yet (e.g., host just opened studio or triggered on demand):
    // capture a live stage WebM clip directly (or fallback card) and save right to Media Library.
    const entry = addHighlight({
      speaker,
      title,
      snippet,
      reason,
      durationSec: 30,
      peak,
      clipState: 'capturing',
      fromAgent,
    });
    setAgentStatus(`Capturing highlight clip: ${clipLabel}…`, 'active');

    let blob = null;
    const recentBlobs = clipsApi?.recent ? clipsApi.recent(30_000) : [];
    if (recentBlobs.length) {
      blob = new Blob(recentBlobs, { type: recentBlobs[0]?.type || 'video/webm' });
    } else {
      blob = await captureLiveStageFallbackBlob(1800);
    }

    if (blob && blob.size) {
      entry.clipBlob = blob;
      entry.clipState = 'ready';
    } else {
      entry.clipState = 'ready';
    }

    if (forceSaveToLib) {
      await saveHighlightToMediaLibrary(entry, blob);
      setAgentStatus(`Saved “${clipLabel}” to Media library`, 'active');
      api.toast?.(`AI Highlight Agent saved “${clipLabel}” to Smart Highlights & Media library.`);
    } else {
      renderHighlights();
      setAgentStatus(`Added “${clipLabel}” to Smart Highlights`, 'active');
    }
    return entry;
  }

  // Receive settled 30-second WebM clips from clips.js rolling buffer (25s before + 5s after = 30s)
  window.__gatherOnAiHighlightClipReady = async (m) => {
    if (!m || m.kind !== 'ai-agent') return;
    const pending = pendingMomentByClipId.get(m.id);
    if (!pending) return;
    pendingMomentByClipId.delete(m.id);
    const { entry, forceSaveToLib } = pending;

    try {
      let blob = null;
      if (Array.isArray(m.blobs) && m.blobs.length) {
        blob = new Blob(m.blobs, { type: m.blobs[0]?.type || 'video/webm' });
      }
      entry.durationSec = m.dur || 30;
      entry.clipBlob = blob;
      entry.clipState = 'ready';

      if (forceSaveToLib) {
        await saveHighlightToMediaLibrary(entry, blob);
        setAgentStatus(`Saved 30s clip to Media library · ${transitionLog.length} transitions`, 'active');
        api.toast?.(`30s Smart Highlight “${entry.title || entry.speaker}” saved to Media library.`);
      } else {
        renderHighlights();
        setAgentStatus(`30s clip ready · ${transitionLog.length} transitions`);
      }

      // Also sync to Google Drive Cloud Clips folder silently if Drive is connected
      if (blob && window.gatherCloud?.hasDriveToken?.() && typeof window.__gatherCaptureCloudClip === 'function') {
        window.__gatherCaptureCloudClip({
          id: m.id,
          label: entry.title || entry.speaker || '30s Smart Highlight',
          durationSec: entry.durationSec,
          capturedAt: entry.ts,
          aspect: '16:9',
        }, blob).catch(() => {});
      }
    } catch (err) {
      entry.clipState = 'ready';
      renderHighlights();
      setAgentStatus(err?.message || 'Could not finalize 30s highlight clip', 'err');
    }
  };

  /** Ask the server-side Gemini AI Highlight Agent (/api/ai mode: 'highlight-eval') to evaluate the speaker transition. */
  async function evaluateTransitionsWithAI({ manual = false } = {}) {
    if (evaluating) return null;
    const now = Date.now();
    const c = cfg();
    if (!manual && (!agentEnabled || !api.inStudio?.() || !api.isHost?.())) return null;
    if (!manual && (now - lastEvalAt < c.evalCooldownMs || now - lastAutoClipAt < c.clipCooldownMs)) return null;

    const recentTransitions = transitionLog.slice(-6);
    const peers = (api.getPeers?.() || []).map((p) => ({ name: p.name || 'Speaker', level: Number(p.level) || 0, mic: !!p.mic }));
    const transcript = (api.getTranscript?.() || []).slice(-10);

    if (!manual && !recentTransitions.length) return null;

    evaluating = true;
    lastEvalAt = now;
    setAgentStatus('AI agent evaluating speaker transition…', 'active');

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'highlight-eval',
          transitions: recentTransitions.length
            ? recentTransitions
            : [{ from: peers[0]?.name || api.getMyName?.() || 'Host', to: peers[1]?.name || 'Stage', gapMs: 400, overlap: false, energy: Math.max(0.25, peers[0]?.level || 0.3) }],
          activeSpeakers: peers.filter((p) => p.mic),
          transcript,
          chatVelocity: getChatVelocity(),
          title: api.getState?.()?.title || 'Live Studio',
          sensitivity: agentSensitivity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `AI Highlight Agent returned ${res.status}.`);
      }

      const latest = recentTransitions.at(-1);
      const speakerLabel = latest && latest.from && latest.to && latest.from !== latest.to
        ? `${latest.from} → ${latest.to}`
        : (latest?.to || peers.sort((a, b) => b.level - a.level)[0]?.name || api.getMyName?.() || 'Host');

      if (data.shouldClip || manual) {
        lastAutoClipAt = Date.now();
        await generate30sSmartHighlight({
          speaker: speakerLabel,
          title: data.title || 'High-Engagement Turn',
          snippet: data.summary || 'High-engagement speaker transition captured by AI Highlight Agent.',
          reason: data.reason || 'Speaker handoff',
          peak: Math.max(0.5, (Number(data.score) || 75) / 100),
          fromAgent: true,
          forceSaveToLib: autoSaveToLibrary,
        });
      } else {
        setAgentStatus(`Monitoring · last handoff skipped (${data.reason || 'low engagement'})`);
      }
      return data;
    } catch (err) {
      const msg = err?.message || 'AI Highlight Agent could not reach Gemini.';
      setAgentStatus(msg, 'err');
      if (manual) api.toast?.(msg, { err: true });
      return null;
    } finally {
      evaluating = false;
    }
  }

  function recordSpeakerTransition(fromName, toName, { gapMs = 0, overlap = false, energy = 0.25 } = {}) {
    const now = Date.now();
    const rec = {
      from: String(fromName || 'Speaker A').slice(0, 40),
      to: String(toName || 'Speaker B').slice(0, 40),
      gapMs: Math.max(0, Math.round(gapMs)),
      overlap: !!overlap,
      energy: Math.max(0, Math.min(1, Number(energy) || 0)),
      at: now,
    };
    transitionLog.push(rec);
    if (transitionLog.length > 20) transitionLog.shift();

    const c = cfg();
    const recentCount = transitionLog.filter((t) => now - t.at <= 30_000).length;
    if (agentEnabled) {
      setAgentStatus(`Monitoring speaker activity · ${transitionLog.length} transition${transitionLog.length === 1 ? '' : 's'}`);
    }

    // High-engagement speaker transition heuristic triggers the Gemini AI agent evaluation:
    // - rapid handoff with energetic entry, OR
    // - lively overlapping banter between 2 speakers, OR
    // - 2+ back-and-forth transitions within 30s, OR
    // - speaker handoff accompanied by a burst of audience chat/reactions.
    const highEngagementCandidate =
      rec.overlap ||
      (rec.gapMs <= c.maxGapMs && rec.energy >= c.minEnergy) ||
      recentCount >= 2 ||
      getChatVelocity() >= 3;

    if (agentEnabled && highEngagementCandidate) {
      evaluateTransitionsWithAI({ manual: false });
    }
    return rec;
  }

  // Real-time speaker activity sampler (every 500ms)
  setInterval(() => {
    if (!agentEnabled || !api.inStudio?.() || !api.isHost?.()) return;
    const c = cfg();
    const now = Date.now();
    const peers = (api.getPeers?.() || []).filter((p) => p.mic);
    const active = peers
      .filter((p) => (Number(p.level) || 0) >= c.speakThresh)
      .sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0));

    if (!active.length) return;
    const primary = active[0];
    const secondary = active[1];
    const isOverlap = !!(secondary && (Number(secondary.level) || 0) >= c.speakThresh * 1.1);

    if (!prevActiveSpeaker) {
      prevActiveSpeaker = { id: primary.id, name: primary.name || 'Speaker', lastHeardAt: now, peakLevel: Number(primary.level) || 0 };
      return;
    }

    if (primary.id !== prevActiveSpeaker.id) {
      const gapMs = Math.max(0, now - prevActiveSpeaker.lastHeardAt);
      const fromName = prevActiveSpeaker.name;
      const toName = primary.name || 'Speaker';
      const energy = Math.max(Number(primary.level) || 0, prevActiveSpeaker.peakLevel || 0);
      prevActiveSpeaker = { id: primary.id, name: toName, lastHeardAt: now, peakLevel: Number(primary.level) || 0 };
      if (gapMs <= 8000) {
        recordSpeakerTransition(fromName, toName, { gapMs, overlap: isOverlap, energy });
      }
    } else {
      prevActiveSpeaker.lastHeardAt = now;
      prevActiveSpeaker.peakLevel = Math.max(prevActiveSpeaker.peakLevel, Number(primary.level) || 0);
      if (isOverlap && secondary) {
        recordSpeakerTransition(primary.name || 'Speaker', secondary.name || 'Guest', {
          gapMs: 0,
          overlap: true,
          energy: Math.max(Number(primary.level) || 0, Number(secondary.level) || 0),
        });
      }
    }
  }, 500);

  // Track spoken captions & chat bursts for speaker transition engagement detection
  let lastCaptionSpeaker = '';
  let lastCaptionAt = 0;
  onSpeechOrChat((ev) => {
    if (!ev?.text) return;
    const now = Date.now();
    if (ev.source === 'chat') {
      recentChatTs.push(now);
      return;
    }
    if (ev.source === 'caption') {
      const who = String(ev.speaker || 'Speaker').trim();
      if (lastCaptionSpeaker && who && who !== lastCaptionSpeaker && now - lastCaptionAt < 12_000) {
        recordSpeakerTransition(lastCaptionSpeaker, who, {
          gapMs: Math.min(3500, now - lastCaptionAt),
          overlap: now - lastCaptionAt < 1200,
          energy: ev.text.length >= 40 ? 0.35 : 0.22,
        });
      }
      lastCaptionSpeaker = who;
      lastCaptionAt = now;
    }
  });

  shEvalNowBtn?.addEventListener('click', async () => {
    shEvalNowBtn.disabled = true;
    const orig = shEvalNowBtn.textContent;
    shEvalNowBtn.textContent = 'Checking…';
    try {
      await evaluateTransitionsWithAI({ manual: true });
    } finally {
      shEvalNowBtn.disabled = false;
      shEvalNowBtn.textContent = orig;
    }
  });

  shCaptureBtn?.addEventListener('click', async () => {
    const peers = api.getPeers?.() || [];
    const active = peers.slice().sort((a, b) => (b.level || 0) - (a.level || 0))[0];
    const lastLine = (api.getTranscript?.() || []).slice(-1)[0];
    shCaptureBtn.disabled = true;
    try {
      await generate30sSmartHighlight({
        speaker: active?.name || lastLine?.speaker || api.getMyName?.() || 'Host',
        title: lastLine?.speaker ? `${lastLine.speaker} Highlight` : 'Studio Highlight',
        snippet: lastLine?.text ? `“${lastLine.text.slice(0, 110)}”` : '30-second studio highlight clip captured on demand.',
        reason: 'Manual capture',
        peak: 1,
        fromAgent: false,
        forceSaveToLib: autoSaveToLibrary,
      });
    } finally {
      shCaptureBtn.disabled = false;
    }
  });

  shAddAllBtn?.addEventListener('click', async () => {
    if (!highlights.length) {
      shCaptureBtn?.click();
      return;
    }
    const pending = highlights.filter((h) => !h.added && h.clipState !== 'capturing');
    if (!pending.length) {
      api.toast?.('All Smart Highlights are already in your Media Library.');
      return;
    }
    shAddAllBtn.disabled = true;
    const origTxt = shAddAllBtn.textContent;
    shAddAllBtn.textContent = `Adding ${pending.length}…`;
    let addedCount = 0;
    try {
      for (const h of pending) {
        const saved = await saveHighlightToMediaLibrary(h, h.clipBlob || null);
        if (saved) addedCount++;
      }
      renderHighlights();
      api.toast?.(`Added ${addedCount} Smart Highlight${addedCount === 1 ? '' : 's'} to your Media Library.`);
    } catch {
      api.toast?.('Could not save highlights to the Media Library.', { err: true });
    } finally {
      shAddAllBtn.disabled = false;
      shAddAllBtn.textContent = origTxt;
    }
  });

  // Expose Highlight Agent API for diagnostics and integration checks
  window.__gatherHighlightAgent = {
    getState: () => ({
      enabled: agentEnabled,
      sensitivity: agentSensitivity,
      autoSaveToLibrary,
      transitions: transitionLog.length,
      highlights: highlights.length,
      evaluating,
    }),
    recordTransition: (from, to, opts) => recordSpeakerTransition(from, to, opts),
    evaluateNow: () => evaluateTransitionsWithAI({ manual: true }),
    generate30sSmartHighlight,
    getHighlights: () => highlights.slice(),
  };
  window.__gatherGetSmartHighlights = () => highlights.slice();

  $('#shOpenPlaylistBtn')?.addEventListener('click', () => {
    api.openTab?.('highlights');
  });

  setAgentStatus(agentEnabled ? 'Monitoring speaker activity · 0 transitions' : 'Agent paused');
  renderHighlights();

  // ---- B. AI TRIGGER LIBRARY (CUSTOM PHRASES → AUTO-APPLY WITH QUICK UNDO TOAST)
  const trigCount = $('#trigCount');
  const trigPhrase = $('#trigPhrase');
  const trigActionType = $('#trigActionType');
  const trigTargetSel = $('#trigTargetSel');
  const trigBannerText = $('#trigBannerText');
  const trigAddBtn = $('#trigAddBtn');
  const trigList = $('#trigList');
  if (!trigPhrase || !trigActionType || !trigList) return;

  const TRIG_KEY = 'gather:aiTriggers';
  const TRIG_COOLDOWN_MS = 5000;
  const lastFired = new Map();

  let triggers = [];
  try {
    const saved = JSON.parse(localStorage.getItem(TRIG_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) triggers = saved;
  } catch {}
  if (!triggers.length) {
    triggers = [
      { id: 't-wrap', phrase: "that's a wrap", actionType: 'scene', targetId: 'b-solo', targetLabel: 'Solo', enabled: true },
      { id: 't-slides', phrase: 'show slides', actionType: 'scene', targetId: 'present', targetLabel: 'Present', enabled: true },
    ];
  }

  const saveTriggers = () => {
    try { localStorage.setItem(TRIG_KEY, JSON.stringify(triggers)); } catch {}
  };

  function populateTriggerTargets() {
    if (!trigTargetSel) return;
    const kind = trigActionType.value;
    if (kind === 'banner') {
      trigTargetSel.hidden = true;
      if (trigBannerText) trigBannerText.hidden = false;
      return;
    }
    trigTargetSel.hidden = false;
    if (trigBannerText) trigBannerText.hidden = true;

    const prev = trigTargetSel.value;
    trigTargetSel.innerHTML = '';
    if (kind === 'scene') {
      const scenes = api.getSceneList?.() || [];
      for (const sc of scenes) {
        const opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        trigTargetSel.append(opt);
      }
    } else if (kind === 'media') {
      const lib = api.getLibrary?.() || [];
      if (!lib.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No media in library yet';
        trigTargetSel.append(opt);
      } else {
        for (const it of lib) {
          const opt = document.createElement('option');
          opt.value = it.id;
          opt.textContent = it.name;
          trigTargetSel.append(opt);
        }
      }
    }
    if (prev && [...trigTargetSel.options].some((o) => o.value === prev)) trigTargetSel.value = prev;
  }

  function fireTrigger(t, isTest = false) {
    if (!api.isHost?.()) return;
    const now = Date.now();
    if (!isTest && now - (lastFired.get(t.id) || 0) < TRIG_COOLDOWN_MS) return;
    lastFired.set(t.id, now);

    if (t.actionType === 'scene') {
      const prevSceneId = api.activeSceneId?.() || '';
      const list = api.getSceneList?.() || [];
      const target = list.find((s) => s.id === t.targetId) || list[0];
      if (!target) return;
      api.applyScene?.(target);
      const undo = () => {
        if (prevSceneId) api.applySceneById?.(prevSceneId);
        api.toast?.('Undid AI Trigger scene switch.');
      };
      api.toast?.(`AI Trigger “${t.phrase}” → ${target.name}`, { action: ['Undo', undo], ms: 8000 });
    } else if (t.actionType === 'media') {
      const it = (api.getLibrary?.() || []).find((x) => x.id === t.targetId);
      if (!it) {
        api.toast?.(`Media item for “${t.phrase}” was not found in your library.`, { err: true });
        return;
      }
      api.presentLibrary?.(it);
      api.toast?.(`AI Trigger “${t.phrase}” → Playing ${it.name}`);
    } else if (t.actionType === 'banner') {
      const prevBanner = api.getState?.()?.banner || null;
      api.setBanner?.(t.targetLabel || t.phrase);
      const undo = () => {
        api.setStage?.({ banner: prevBanner });
        api.toast?.('Removed triggered banner.');
      };
      api.toast?.(`AI Trigger “${t.phrase}” → Banner live`, { action: ['Undo', undo], ms: 8000 });
    }
  }

  function renderTriggers() {
    const activeCount = triggers.filter((t) => t.enabled).length;
    if (trigCount) trigCount.textContent = `${activeCount} active`;
    trigList.innerHTML = '';

    for (const t of triggers) {
      const li = document.createElement('li');
      li.className = 'trig-row' + (t.enabled ? '' : ' is-off');
      li.innerHTML = `
        <div class="trig-main">
          <div class="trig-phrase">“<span></span>”</div>
          <div class="trig-action"></div>
        </div>
        <div class="trig-acts">
          <button type="button" class="btn sm ghost trig-test">Test</button>
          <input type="checkbox" class="toggle sm trig-en" aria-label="Enable trigger">
          <button type="button" class="btn sm ghost trig-del" aria-label="Delete trigger">×</button>
        </div>
      `;
      $('.trig-phrase span', li).textContent = t.phrase;
      const prefix = t.actionType === 'scene' ? 'Scene' : t.actionType === 'media' ? 'Media' : 'Banner';
      $('.trig-action', li).textContent = `${prefix} → ${t.targetLabel || t.targetId}`;
      const chk = $('.trig-en', li);
      chk.checked = !!t.enabled;
      chk.addEventListener('change', () => {
        t.enabled = !!chk.checked;
        saveTriggers();
        renderTriggers();
        window.gatherCloud?.saveTrigger?.(t).catch(() => {});
      });
      $('.trig-test', li).addEventListener('click', () => fireTrigger(t, true));
      $('.trig-del', li).addEventListener('click', () => {
        triggers = triggers.filter((x) => x.id !== t.id);
        saveTriggers();
        renderTriggers();
        window.gatherCloud?.deleteTrigger?.(t.id).catch(() => {});
      });
      trigList.append(li);
    }
  }

  trigActionType.addEventListener('change', populateTriggerTargets);

  trigAddBtn?.addEventListener('click', () => {
    const phrase = trigPhrase.value.trim();
    if (!phrase) {
      api.toast?.('Enter a trigger phrase first (e.g. "that\'s a wrap").', { err: true });
      trigPhrase.focus();
      return;
    }
    const actionType = trigActionType.value;
    let targetId = '';
    let targetLabel = '';
    if (actionType === 'banner') {
      targetLabel = (trigBannerText?.value || '').trim() || phrase;
      targetId = targetLabel;
    } else {
      targetId = trigTargetSel?.value || '';
      targetLabel = trigTargetSel?.selectedOptions?.[0]?.textContent || targetId;
      if (!targetId) {
        api.toast?.(actionType === 'media' ? 'Add an item to your Media Library first.' : 'Choose a target scene.', { err: true });
        return;
      }
    }
    const created = {
      id: 't-' + Date.now(),
      phrase,
      actionType,
      targetId,
      targetLabel,
      enabled: true,
    };
    triggers.unshift(created);
    trigPhrase.value = '';
    if (trigBannerText) trigBannerText.value = '';
    saveTriggers();
    renderTriggers();
    window.gatherCloud?.saveTrigger?.(created).catch(() => {});
    api.toast?.(`Added AI trigger “${phrase}”.`);
  });

  // Firestore real-time persistence for AI Trigger Library & Smart Highlights
  let seededCloudTriggersUid = '';
  let seededCloudHighlightsUid = '';
  if (window.gatherCloud?.subscribe) {
    window.gatherCloud.subscribe((snap, reason) => {
      if (!snap.user) {
        seededCloudTriggersUid = '';
        seededCloudHighlightsUid = '';
        return;
      }
      if (reason === 'triggers' || reason === 'auth' || reason === 'init') {
        const remote = Array.isArray(snap.triggers) ? snap.triggers : [];
        if (remote.length) {
          triggers = remote.map((r) => ({
            id: r.id,
            phrase: r.phrase,
            actionType: r.actionType || 'scene',
            targetId: r.targetId || '',
            targetLabel: r.targetLabel || r.targetId || '',
            enabled: r.enabled !== false,
          }));
          saveTriggers();
          renderTriggers();
        } else if (reason === 'triggers' && seededCloudTriggersUid !== snap.user.uid) {
          seededCloudTriggersUid = snap.user.uid;
          for (const t of triggers) {
            window.gatherCloud.saveTrigger(t).catch(() => {});
          }
        }
      }
      if (reason === 'highlights' || reason === 'auth' || reason === 'init') {
        const remoteHl = Array.isArray(snap.highlights) ? snap.highlights : [];
        if (remoteHl.length) {
          highlights.length = 0;
          for (const r of remoteHl.slice(0, 15)) {
            highlights.push({
              id: r.id,
              speaker: r.speaker || 'Speaker',
              snippet: r.snippet || 'Highlight moment',
              ts: Date.now(),
              elapsedMs: Number(r.elapsedMs) || 0,
              durationSec: Number(r.durationSec) || 15,
              peak: 0.9,
              added: !!r.added,
            });
          }
          renderHighlights();
        } else if (reason === 'highlights' && seededCloudHighlightsUid !== snap.user.uid && highlights.length) {
          seededCloudHighlightsUid = snap.user.uid;
          for (const h of highlights) {
            window.gatherCloud.saveHighlight(h).catch(() => {});
          }
        }
      }
    });
  }

  // Passive phrase detection on live speech captions & studio chat messages
  onSpeechOrChat((ev) => {
    if (!ev?.text || !api.isHost?.() || !api.inStudio?.()) return;
    const hay = String(ev.text).toLowerCase();
    for (const t of triggers) {
      if (!t.enabled || !t.phrase) continue;
      if (hay.includes(t.phrase.toLowerCase())) {
        fireTrigger(t, false);
        break;
      }
    }
  });

  onStudioChange(populateTriggerTargets);
  onLibraryChange(populateTriggerTargets);
  populateTriggerTargets();
  renderTriggers();
}

// ---------------------------------------------------------------- 20. CLOUD CLIPS FOLDER (MEDIA LIBRARY + GOOGLE DRIVE AUTO-SYNC + FIRESTORE)
function initCloudClips(api) {
  const folderEl = $('#cloudClipsFolder');
  const countEl = $('#cloudClipsCount');
  const autoSyncSw = $('#cloudClipsAutoSync');
  const statusEl = $('#cloudClipsDriveStatus');
  const syncAllBtn = $('#cloudClipsSyncAllBtn');
  const connectBtn = $('#cloudClipsConnectBtn');
  const connectLbl = $('#cloudClipsConnectLbl');
  const listEl = $('#cloudClipsList');
  const emptyEl = $('#cloudClipsEmpty');
  const delDlg = $('#driveDelDlg');
  const delMsg = $('#driveDelMsg');
  const delConfirm = $('#driveDelConfirm');
  if (!folderEl || !listEl) return;

  const DB_NAME = 'gather-cloud-clips';
  const STORE_NAME = 'clips';
  let clipDbPromise = null;
  let localClips = []; // [{ id, label, fileName, aspect, durationSec, sizeBytes, mimeType, capturedAt, syncStatus, driveFileId, driveWebViewLink, driveFolderId, blob?, progress? }]
  let cloudClipsRemote = [];
  let pendingDeleteClip = null;
  const activeUploads = new Set();

  function openClipDb() {
    if (clipDbPromise) return clipDbPromise;
    clipDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return clipDbPromise;
  }

  async function idbGetAll() {
    try {
      const db = await openClipDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  }

  async function idbPut(rec) {
    try {
      const db = await openClipDb();
      const clean = { ...rec };
      delete clean.progress;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(clean);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
  }

  async function idbDelete(id) {
    try {
      const db = await openClipDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
  }

  function getMergedClips() {
    const map = new Map();
    for (const r of cloudClipsRemote) {
      map.set(r.id, { ...r, hasLocalBlob: false });
    }
    for (const l of localClips) {
      const prev = map.get(l.id) || {};
      map.set(l.id, {
        ...prev,
        ...l,
        driveFileId: l.driveFileId || prev.driveFileId || '',
        driveWebViewLink: l.driveWebViewLink || prev.driveWebViewLink || '',
        driveFolderId: l.driveFolderId || prev.driveFolderId || '',
        syncStatus: activeUploads.has(l.id)
          ? 'syncing'
          : (l.driveFileId || prev.driveFileId ? 'synced' : (l.syncStatus || prev.syncStatus || 'local')),
        hasLocalBlob: !!l.blob,
      });
    }
    return [...map.values()].sort((a, b) => (Number(b.capturedAt) || 0) - (Number(a.capturedAt) || 0));
  }

  function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function updateDriveBar() {
    const snap = window.gatherCloud?.getSnapshot?.() || {};
    const merged = getMergedClips();
    const pendingCount = merged.filter((c) => c.hasLocalBlob && c.syncStatus !== 'synced' && c.syncStatus !== 'syncing').length;

    if (snap.driveConnected) {
      const who = snap.user?.email || snap.user?.displayName || 'Google Drive';
      if (statusEl) statusEl.textContent = `Auto-saving 30s clips to Drive “Cloud Clips” (${who})`;
      if (connectLbl) connectLbl.textContent = 'Reconnect';
      if (connectBtn) connectBtn.title = 'Refresh Google Drive connection';
    } else if (snap.user) {
      if (statusEl) statusEl.textContent = 'Signed in — connect Google Drive to auto-upload Cloud Clips';
      if (connectLbl) connectLbl.textContent = 'Connect Drive';
    } else {
      if (statusEl) statusEl.textContent = 'Connect Google Drive to auto-save 30s clips';
      if (connectLbl) connectLbl.textContent = 'Connect Google Drive';
    }

    if (syncAllBtn) {
      syncAllBtn.hidden = pendingCount === 0;
      syncAllBtn.textContent = pendingCount > 1 ? `Sync ${pendingCount} clips` : 'Sync pending';
    }
  }

  function renderCloudClips() {
    const items = getMergedClips();
    if (countEl) countEl.textContent = String(items.length);
    if (emptyEl) emptyEl.hidden = items.length > 0;
    listEl.innerHTML = '';

    for (const c of items) {
      const li = document.createElement('li');
      li.className = 'ccf-row';
      const when = new Date(c.capturedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const st = c.syncStatus || 'local';
      const badgeText = st === 'synced'
        ? 'Drive'
        : st === 'syncing'
          ? (typeof c.progress === 'number' ? `Syncing ${Math.round(c.progress * 100)}%` : 'Syncing…')
          : st === 'error'
            ? 'Retry'
            : 'Local';

      li.innerHTML = `
        <div class="ccf-row-top">
          <div class="ccf-info">
            <b class="ccf-name"></b>
            <small class="ccf-meta"></small>
          </div>
          <span class="ccf-badge is-${st}"></span>
        </div>
        <div class="ccf-row-acts">
          <button type="button" class="btn sm primary ccf-present">Present</button>
          <a class="btn sm ccf-drive" target="_blank" rel="noopener noreferrer" hidden>Open in Drive</a>
          <button type="button" class="btn sm ccf-sync" hidden>Sync</button>
          <button type="button" class="btn sm ghost ccf-dl" aria-label="Download clip">Save</button>
          <button type="button" class="btn sm ghost ccf-del" aria-label="Delete clip">×</button>
        </div>
      `;
      $('.ccf-name', li).textContent = c.label || c.fileName || '30s Clip';
      $('.ccf-meta', li).textContent = `${c.durationSec || 30}s · ${when}${c.sizeBytes ? ` · ${fmtSize(c.sizeBytes)}` : ''}`;
      $('.ccf-badge', li).textContent = badgeText;

      const presentBtn = $('.ccf-present', li);
      if (c.hasLocalBlob && c.blob) {
        presentBtn.onclick = () => api.presentVideoBlob?.(c.blob, c.label || 'Cloud Clip');
      } else if (c.driveWebViewLink) {
        presentBtn.textContent = 'View';
        presentBtn.onclick = () => api.offerOpen?.(c.driveWebViewLink, c.label || 'Cloud Clip');
      } else {
        presentBtn.disabled = true;
      }

      const driveLink = $('.ccf-drive', li);
      if (c.driveWebViewLink) {
        driveLink.href = c.driveWebViewLink;
        driveLink.hidden = false;
      }

      const syncBtn = $('.ccf-sync', li);
      if (c.hasLocalBlob && st !== 'synced' && st !== 'syncing') {
        syncBtn.hidden = false;
        syncBtn.onclick = () => syncSingleClip(c.id, true);
      }

      const dlBtn = $('.ccf-dl', li);
      if (c.hasLocalBlob && c.blob) {
        dlBtn.onclick = () => {
          const u = URL.createObjectURL(c.blob);
          const a = document.createElement('a');
          a.href = u;
          a.download = c.fileName || `${c.id}.webm`;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(u), 10_000);
        };
      } else {
        dlBtn.hidden = true;
      }

      $('.ccf-del', li).onclick = () => requestDeleteClip(c);
      listEl.append(li);
    }
    updateDriveBar();
    document.dispatchEvent(new CustomEvent('gather:clips-updated'));
  }
  window.__gatherGetCloudClips = () => getMergedClips();

  function requestDeleteClip(clip) {
    pendingDeleteClip = clip;
    if (delDlg && delMsg && delConfirm) {
      const inDrive = !!clip.driveFileId;
      delMsg.textContent = inDrive
        ? `Permanently delete “${clip.label || clip.fileName}” from your Media Library and from your Google Drive Cloud Clips folder?`
        : `Remove “${clip.label || clip.fileName}” from your Media Library Cloud Clips folder?`;
      delDlg.showModal();
    } else {
      performDeleteClip(clip);
    }
  }

  async function performDeleteClip(clip) {
    if (!clip) return;
    if (delConfirm) delConfirm.disabled = true;
    try {
      if (clip.driveFileId && window.gatherCloud?.hasDriveToken?.()) {
        try {
          await window.gatherCloud.deleteDriveFile(clip.driveFileId);
        } catch (err) {
          api.toast?.(err?.message || 'Could not remove file from Google Drive.', { err: true });
        }
      }
      localClips = localClips.filter((x) => x.id !== clip.id);
      cloudClipsRemote = cloudClipsRemote.filter((x) => x.id !== clip.id);
      await idbDelete(clip.id);
      window.gatherCloud?.deleteCloudClipRecord?.(clip.id).catch(() => {});
      renderCloudClips();
      api.toast?.(`Deleted “${clip.label || 'Cloud Clip'}”.`);
    } finally {
      pendingDeleteClip = null;
      if (delConfirm) delConfirm.disabled = false;
      if (delDlg?.open) delDlg.close();
    }
  }

  delConfirm?.addEventListener('click', () => {
    if (pendingDeleteClip) performDeleteClip(pendingDeleteClip);
  });
  delDlg?.addEventListener('close', () => {
    pendingDeleteClip = null;
  });

  async function syncSingleClip(clipId, promptConnect = false) {
    const rec = localClips.find((x) => x.id === clipId);
    if (!rec || !rec.blob || activeUploads.has(clipId)) return false;

    if (!window.gatherCloud?.hasDriveToken?.()) {
      if (!promptConnect) return false;
      try {
        await window.gatherCloud.signInWithGoogle({ requestDrive: true });
      } catch (err) {
        api.toast?.(err?.message || 'Google Drive sign-in was cancelled.', { err: true });
        return false;
      }
      if (!window.gatherCloud?.hasDriveToken?.()) {
        api.toast?.('Google Drive access was not granted.', { err: true });
        return false;
      }
    }

    activeUploads.add(clipId);
    rec.syncStatus = 'syncing';
    rec.progress = 0;
    renderCloudClips();
    window.gatherCloud?.saveCloudClipRecord?.(rec).catch(() => {});

    try {
      const uploaded = await window.gatherCloud.uploadCloudClipToDrive(
        rec.blob,
        rec.fileName,
        (p) => {
          rec.progress = p;
          renderCloudClips();
        },
      );
      rec.syncStatus = 'synced';
      rec.driveFileId = uploaded.id;
      rec.driveWebViewLink = uploaded.webViewLink;
      rec.driveFolderId = uploaded.folderId;
      delete rec.progress;
      await idbPut(rec);
      await window.gatherCloud?.saveCloudClipRecord?.(rec).catch(() => {});
      api.toast?.(`“${rec.label}” synced to Google Drive / Cloud Clips.`);
      return true;
    } catch (err) {
      rec.syncStatus = 'error';
      delete rec.progress;
      await idbPut(rec);
      window.gatherCloud?.saveCloudClipRecord?.(rec).catch(() => {});
      api.toast?.(err?.message || 'Could not sync clip to Google Drive.', { err: true });
      return false;
    } finally {
      activeUploads.delete(clipId);
      renderCloudClips();
    }
  }

  async function syncAllPendingClips(promptConnect = false) {
    const pending = localClips.filter((c) => c.blob && c.syncStatus !== 'synced' && !activeUploads.has(c.id));
    if (!pending.length) return;
    if (!window.gatherCloud?.hasDriveToken?.()) {
      if (!promptConnect) return;
      try {
        await window.gatherCloud.signInWithGoogle({ requestDrive: true });
      } catch (err) {
        api.toast?.(err?.message || 'Google Drive connection cancelled.', { err: true });
        return;
      }
    }
    for (const c of pending) {
      await syncSingleClip(c.id, false);
    }
  }

  async function captureCloudClip(meta, blob) {
    if (!blob || !blob.size) return null;
    const ts = Number(meta?.capturedAt || meta?.ts) || Date.now();
    const stamp = new Date(ts).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const id = String(meta?.id || `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
    const label = String(meta?.label || '30s Clip').trim().slice(0, 80);
    const fileName = String(meta?.fileName || `gather-clip-${stamp}.webm`).slice(0, 120);
    const rec = {
      id,
      label,
      fileName,
      aspect: meta?.aspect === '9:16' ? '9:16' : '16:9',
      durationSec: Math.max(1, Math.round(Number(meta?.durationSec || meta?.dur) || 30)),
      sizeBytes: blob.size,
      mimeType: blob.type || 'video/webm',
      capturedAt: ts,
      syncStatus: 'local',
      driveFileId: '',
      driveWebViewLink: '',
      driveFolderId: '',
      blob,
    };

    localClips = [rec, ...localClips.filter((x) => x.id !== id)].slice(0, 40);
    await idbPut(rec);
    renderCloudClips();
    window.gatherCloud?.saveCloudClipRecord?.(rec).catch(() => {});

    const autoSync = autoSyncSw ? autoSyncSw.checked : true;
    if (autoSync && window.gatherCloud?.hasDriveToken?.()) {
      syncSingleClip(rec.id, false);
    } else if (autoSync) {
      api.toast?.(`Saved “${label}” to Cloud Clips. Connect Google Drive to auto-sync.`);
    } else {
      api.toast?.(`Saved “${label}” to Cloud Clips.`);
    }
    return rec;
  }

  window.__gatherCaptureCloudClip = captureCloudClip;

  window.__gatherOnClipReady = async (m) => {
    if (!m || m.state !== 'ready') return;
    try {
      let blob = null;
      if (Array.isArray(m.blobs) && m.blobs.length) {
        blob = new Blob(m.blobs, { type: m.blobs[0]?.type || 'video/webm' });
      } else if (window.__gatherClips?.exportClip) {
        blob = await window.__gatherClips.exportClip(m, '16:9');
      }
      if (!blob || !blob.size) return;
      await captureCloudClip({
        id: `clip_${m.id || Date.now().toString(36)}`,
        label: m.label || '30s Highlight',
        durationSec: m.dur || 30,
        capturedAt: m.ts || Date.now(),
        aspect: '16:9',
      }, blob);
    } catch (err) {
      console.warn('[cloudClips] auto-capture note:', err?.message || err);
    }
  };

  if (autoSyncSw) {
    autoSyncSw.checked = store.get('autoSyncCloudClips', true);
    autoSyncSw.addEventListener('change', () => {
      store.set('autoSyncCloudClips', autoSyncSw.checked);
      window.gatherCloud?.updateProfilePrefs?.({ autoSyncCloudClips: autoSyncSw.checked }).catch(() => {});
      if (autoSyncSw.checked && window.gatherCloud?.hasDriveToken?.()) {
        syncAllPendingClips(false);
      }
    });
  }

  connectBtn?.addEventListener('click', async () => {
    if (!window.gatherCloud?.signInWithGoogle) {
      api.toast?.('Cloud sync module is still loading.', { err: true });
      return;
    }
    connectBtn.disabled = true;
    try {
      await window.gatherCloud.signInWithGoogle({ requestDrive: true });
      api.toast?.('Connected to Google Drive “Cloud Clips” folder.');
      updateDriveBar();
      if (!autoSyncSw || autoSyncSw.checked) {
        syncAllPendingClips(false);
      }
    } catch (err) {
      api.toast?.(err?.message || 'Could not connect Google Drive.', { err: true });
    } finally {
      connectBtn.disabled = false;
    }
  });

  syncAllBtn?.addEventListener('click', () => syncAllPendingClips(true));

  if (window.gatherCloud?.subscribe) {
    window.gatherCloud.subscribe((snap, reason) => {
      if (reason === 'profile' && snap.profile && typeof snap.profile.autoSyncCloudClips === 'boolean' && autoSyncSw) {
        autoSyncSw.checked = snap.profile.autoSyncCloudClips;
        store.set('autoSyncCloudClips', autoSyncSw.checked);
      }
      if (reason === 'cloudClips' || reason === 'auth' || reason === 'init') {
        cloudClipsRemote = Array.isArray(snap.cloudClips) ? snap.cloudClips : [];
        renderCloudClips();
      } else if (reason === 'drive-token' || reason === 'syncing') {
        updateDriveBar();
        if (reason === 'drive-token' && snap.driveConnected && (!autoSyncSw || autoSyncSw.checked)) {
          syncAllPendingClips(false);
        }
      }
    });
  }

  idbGetAll().then((rows) => {
    localClips = Array.isArray(rows) ? rows : [];
    renderCloudClips();
  });
}

// ---------------------------------------------------------------- 21. GEMINI LIVE STUDIO CONTROLLER (VOICE + 1 FPS STAGE VIDEO + TRANSLATE + CAPTIONS)
function initGeminiLive(api) {
  const modeSeg = $('#gemLiveMode');
  const videoRow = $('#gemLiveVideoRow');
  const videoSw = $('#gemLiveVideo');
  const langRow = $('#gemLiveLangRow');
  const langSel = $('#gemLiveLang');
  const stageCapSw = $('#gemLiveStageCap');
  const toggleBtn = $('#gemLiveBtn');
  const badgeEl = $('#gemLiveBadge');
  const logEl = $('#gemLiveLog');
  if (!modeSeg || !toggleBtn) return;

  let activeMode = 'cohost';

  function setModeUI(mode) {
    activeMode = mode;
    $$('button[data-glmode]', modeSeg).forEach((b) => {
      const on = b.dataset.glmode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (videoRow) videoRow.hidden = mode !== 'cohost';
    if (langRow) langRow.hidden = mode !== 'translate';
  }

  modeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-glmode]');
    if (!b) return;
    setModeUI(b.dataset.glmode);
  });

  function appendLog(role, text) {
    if (!logEl || !text) return;
    logEl.hidden = false;
    if (role === 'interim') {
      let cur = $('.gl-line.is-interim', logEl);
      if (!cur) {
        cur = document.createElement('div');
        cur.className = 'gl-line is-interim';
        logEl.append(cur);
      }
      cur.textContent = text;
    } else {
      $('.gl-line.is-interim', logEl)?.remove();
      const row = document.createElement('div');
      row.className = `gl-line is-${role}`;
      const who = role === 'assistant' ? (api.getAiName?.() || 'Sam') : (api.getMyName?.() || 'You');
      row.innerHTML = `<b></b> <span></span>`;
      $('b', row).textContent = `${who}:`;
      $('span', row).textContent = text;
      logEl.append(row);
      while (logEl.children.length > 24) logEl.firstElementChild.remove();
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  const client = createGeminiLiveClient({
    getCanvas: () => api.getCanvas?.(),
    onStatus: (st, mode) => {
      if (st === 'connecting') {
        if (badgeEl) badgeEl.textContent = 'Connecting…';
        toggleBtn.textContent = 'Stop Gemini Live';
        toggleBtn.classList.remove('primary');
        toggleBtn.classList.add('danger');
      } else if (st === 'live') {
        const lbl = mode === 'translate' ? 'Live Translate' : mode === 'transcribe' ? 'Live Captions' : 'Live Co-Host';
        if (badgeEl) badgeEl.textContent = lbl;
        toggleBtn.textContent = 'Stop Gemini Live';
        toggleBtn.classList.remove('primary');
        toggleBtn.classList.add('danger');
      } else {
        if (badgeEl) badgeEl.textContent = 'Ready';
        toggleBtn.textContent = 'Start Gemini Live';
        toggleBtn.classList.remove('danger');
        toggleBtn.classList.add('primary');
      }
    },
    onTranscript: ({ role, text }) => {
      appendLog(role, text);
      if (!text) return;
      const speaker = role === 'assistant' ? (api.getAiName?.() || 'Sam') : (api.getMyName?.() || 'Host');
      const isFinal = role !== 'interim';
      if (stageCapSw?.checked) {
        api.showCaption?.(`gemini-live-${role}`, speaker, text, isFinal);
        if (isFinal) api.sendCaption?.(text, true);
      } else if (isFinal) {
        api.addSrtEvent?.({ speaker, text, source: role === 'assistant' ? 'ai' : 'caption' });
      }
    },
    onError: (msg) => {
      api.toast?.(msg || 'Gemini Live error.', { err: true });
    },
  });

  window.__gatherGeminiLive = client;

  toggleBtn.addEventListener('click', async () => {
    if (client.running) {
      client.stop();
      api.toast?.('Gemini Live stopped.');
      return;
    }
    const voice = $('#aiVoiceName')?.value || 'Zephyr';
    const lang = langSel?.value || 'es';
    const shareVideo = videoSw ? videoSw.checked : true;
    const name = api.getAiName?.() || 'Sam';
    const title = api.getState?.()?.title || 'Live Studio';
    try {
      await client.start({ mode: activeMode, voice, lang, name, title, shareVideo });
    } catch (err) {
      api.toast?.(err?.message || 'Could not start Gemini Live.', { err: true });
    }
  });

  setModeUI('cohost');
}

// ---------------------------------------------------------------- 22. SYNCHRONIZED TRANSCRIPT & CAPTIONS SRT EXPORT (AI PANEL)
function initTranscriptSrtExport(api) {
  const countEl = $('#srtCount');
  const syncSel = $('#srtSyncOrigin');
  const incCap = $('#srtIncCap');
  const incChat = $('#srtIncChat');
  const incAi = $('#srtIncAi');
  const incSpk = $('#srtIncSpk');
  const previewEl = $('#srtPreview');
  const emptyEl = $('#srtEmpty');
  const downloadBtn = $('#srtDownloadBtn');
  const copyBtn = $('#srtCopyBtn');
  if (!downloadBtn || !syncSel) return;

  function formatSrtTime(ms) {
    const clamped = Math.max(0, Math.round(Number(ms) || 0));
    const hours = Math.floor(clamped / 3_600_000);
    const mins = Math.floor((clamped % 3_600_000) / 60_000);
    const secs = Math.floor((clamped % 60_000) / 1000);
    const millis = clamped % 1000;
    const p2 = (n) => String(n).padStart(2, '0');
    const p3 = (n) => String(n).padStart(3, '0');
    return `${p2(hours)}:${p2(mins)}:${p2(secs)},${p3(millis)}`;
  }

  function wrapSubtitleLines(text, maxChars = 42) {
    const clean = String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const words = clean.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (!cur) {
        cur = w;
      } else if (cur.length + 1 + w.length <= maxChars) {
        cur += ' ' + w;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function getFilteredEvents() {
    const bundle = api.getSrtEvents?.() || { events: [], anchors: {} };
    const allow = new Set();
    if (!incCap || incCap.checked) allow.add('caption');
    if (!incChat || incChat.checked) allow.add('chat');
    if (!incAi || incAi.checked) allow.add('ai');
    const events = (bundle.events || []).filter((ev) => ev?.text && allow.has(ev.source || 'caption'));
    return { events, anchors: bundle.anchors || {} };
  }

  function resolveBaseMs(events, anchors) {
    const mode = syncSel.value || 'auto';
    const firstStart = events.length ? Number(events[0].startMs) || 0 : 0;
    if (mode === 'first') return firstStart;
    if (mode === 'recording') return Number(anchors.recStartAt) || firstStart;
    if (mode === 'session') return Number(anchors.sessionStartAt) || firstStart;
    // Auto: prioritize active recording start, then live stream start, else align cleanly to first cue
    return Number(anchors.recStartAt) || Number(anchors.liveStartAt) || firstStart;
  }

  function buildSrt() {
    const { events, anchors } = getFilteredEvents();
    if (!events.length) return { srt: '', cueCount: 0, spanMs: 0 };

    const baseMs = resolveBaseMs(events, anchors);
    const includeSpeaker = !incSpk || incSpk.checked;

    // Normalize relative cue windows so cues are strictly monotonic and non-overlapping
    const cues = [];
    for (const ev of events) {
      let relStart = Math.max(0, (Number(ev.startMs) || baseMs) - baseMs);
      let relEnd = Math.max(relStart + 500, (Number(ev.endMs) || (ev.startMs + 2500)) - baseMs);
      if (cues.length) {
        const prev = cues[cues.length - 1];
        if (relStart < prev.start) relStart = prev.start;
        if (prev.end > relStart - 40) {
          prev.end = Math.max(prev.start + 400, relStart - 40);
          if (relStart < prev.end) relStart = prev.end + 20;
          if (relEnd < relStart + 500) relEnd = relStart + 500;
        }
      }
      const prefix = includeSpeaker && ev.speaker ? `${ev.speaker}: ` : '';
      const wrapped = wrapSubtitleLines(prefix + ev.text, 42);
      if (!wrapped.length) continue;
      // Split very long utterances into 2-line chunks for NLE & YouTube compatibility
      const chunks = [];
      for (let i = 0; i < wrapped.length; i += 2) {
        chunks.push(wrapped.slice(i, i + 2).join('\r\n'));
      }
      if (chunks.length === 1) {
        cues.push({ start: relStart, end: relEnd, body: chunks[0] });
      } else {
        const totalDur = Math.max(chunks.length * 1000, relEnd - relStart);
        const step = Math.floor(totalDur / chunks.length);
        chunks.forEach((body, idx) => {
          const s = relStart + idx * step;
          const e = idx === chunks.length - 1 ? relStart + totalDur : Math.max(s + 500, s + step - 40);
          cues.push({ start: s, end: e, body });
        });
      }
    }

    const blocks = cues.map((c, idx) => (
      `${idx + 1}\r\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\r\n${c.body}`
    ));
    const srt = blocks.join('\r\n\r\n') + '\r\n';
    const spanMs = cues.length ? cues[cues.length - 1].end : 0;
    return { srt, cueCount: cues.length, spanMs };
  }

  function renderSrtPanel() {
    const { srt, cueCount, spanMs } = buildSrt();
    if (countEl) {
      countEl.textContent = cueCount
        ? `${cueCount} cue${cueCount === 1 ? '' : 's'} · ${fmtClock(spanMs)}`
        : '0 cues';
    }
    if (emptyEl) emptyEl.hidden = cueCount > 0;
    if (previewEl) {
      previewEl.hidden = cueCount === 0;
      if (cueCount > 0) {
        // Show the latest cues in the compact preview so hosts can verify live sync immediately
        const blocks = srt.trim().split(/\r?\n\r?\n/);
        previewEl.textContent = blocks.slice(-6).join('\n\n');
        previewEl.scrollTop = previewEl.scrollHeight;
      } else {
        previewEl.textContent = '';
      }
    }
    downloadBtn.disabled = cueCount === 0;
    if (copyBtn) copyBtn.disabled = cueCount === 0;
  }

  function makeFileName() {
    const rawTitle = String(api.getState?.()?.title || 'gather-studio-transcript').trim().toLowerCase();
    const slug = rawTitle.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'gather-transcript';
    const date = new Date().toISOString().slice(0, 10);
    return `${slug}-${date}.srt`;
  }

  function downloadSrt() {
    const { srt, cueCount } = buildSrt();
    if (!cueCount) {
      api.toast?.('No transcript or caption events captured yet.', { err: true });
      return false;
    }
    // Prepend UTF-8 BOM for maximum compatibility with Premiere Pro, Resolve, and Windows editors
    const blob = new Blob(['\uFEFF', srt], { type: 'application/x-subrip;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = makeFileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    api.toast?.(`Exported ${cueCount} synchronized subtitle cue${cueCount === 1 ? '' : 's'} (.srt).`);
    return true;
  }

  downloadBtn.addEventListener('click', downloadSrt);

  copyBtn?.addEventListener('click', async () => {
    const { srt, cueCount } = buildSrt();
    if (!cueCount) return;
    try {
      await navigator.clipboard.writeText(srt);
      api.toast?.(`Copied ${cueCount} SRT cue${cueCount === 1 ? '' : 's'} to clipboard.`);
    } catch {
      api.toast?.('Could not copy to clipboard — use Export .srt instead.', { err: true });
    }
  });

  [syncSel, incCap, incChat, incAi, incSpk].forEach((el) => {
    el?.addEventListener('change', renderSrtPanel);
  });

  window.__gatherOnSrtChange = renderSrtPanel;
  window.__gatherSrtExport = {
    buildSrt,
    downloadSrt,
    render: renderSrtPanel,
    addEvent: (ev) => api.addSrtEvent?.(ev),
    clear: () => api.clearSrtEvents?.(),
  };

  renderSrtPanel();
}

// ---------------------------------------------------------------- 23. AUDIENCE COMMAND HUB (LIVE KPIs + 1-CLICK AUDIENCE TOOLS)
function initAudienceCommandHub(api) {
  const hub = $('#audCmdHub');
  if (!hub) return;
  const kpiViewers = $('#audKpiViewers');
  const kpiSupers = $('#audKpiSupers');
  const kpiPoll = $('#audKpiPoll');
  const copyBtn = $('#audQuickCopy');
  const qrBtn = $('#audQuickQr');
  const hypeBtn = $('#audQuickHype');
  const welcomeBtn = $('#audQuickWelcome');
  const clearFeatBtn = $('#audQuickClearFeat');

  function syncHub() {
    const live = api.getLiveStatus?.() || {};
    const supers = api.getRecentSupers?.() || [];
    const poll = api.getActivePoll?.();
    const feat = api.getFeatured?.();
    if (kpiViewers) kpiViewers.textContent = String(Number(live.viewers) || 0);
    if (kpiSupers) kpiSupers.textContent = String(supers.length);
    if (kpiPoll) kpiPoll.textContent = poll && poll.open ? 'Live' : 'Ready';
    if (clearFeatBtn) clearFeatBtn.hidden = !feat;
  }

  copyBtn?.addEventListener('click', () => $('#wpCopy')?.click());
  qrBtn?.addEventListener('click', () => $('#wpCard')?.click());
  hypeBtn?.addEventListener('click', () => {
    ['🔥', '🎉', '❤️', '👏'].forEach((em, idx) => {
      setTimeout(() => {
        api.reactFloat?.(em);
        try { api.wsSend?.({ type: 'react', emoji: em }); } catch {}
      }, idx * 100);
    });
    api.toast?.('Fired hype burst to viewers!');
  });
  welcomeBtn?.addEventListener('click', () => {
    if (!api.isHost?.()) return;
    const title = api.getLiveStatus?.()?.title || 'Welcome to the live stream';
    api.setBanner?.(`Welcome in! ${title} — drop a hello in chat!`, '');
    api.toast?.('Welcome banner is live on stream.');
  });
  clearFeatBtn?.addEventListener('click', () => {
    api.featureMessage?.(null);
    api.toast?.('Cleared featured message from stage.');
    syncHub();
  });

  onStudioChange(syncHub);
  api.onStateSync?.(syncHub);
  setInterval(syncHub, 2500);
  syncHub();
}

// Smart Highlights Playlist Editor extracted to public/smart-highlights.js

export function initStudioTools(api) {
  initPreLiveChecklist(api);
  initBrandRedesign(api);
  initOverlaysUpgrades(api);
  initAiWorkflowUpgrade(api);
  initShowPowerTools(api);
  initDirectStageEditing(api);
  initShopAndGetPaid(api);
  initLogoCropper(api);
  initGamingPanel(api);
  initGreenRoomChecklist(api);
  initAiSceneSuggest(api);
  initAiScoreboardVision(api);
  initAiRecap(api);
  initChatReactions(api);
  initSceneAi(api);
  initMultiCamPreview(api);
  initGuestMoodCheck(api);
  initSmartHighlightsAndTriggers(api);
  initCloudClips(api);
  initSmartHighlightsPlaylist(api);
  initGeminiLive(api);
  initTranscriptSrtExport(api);
  initAudienceCommandHub(api);
}



