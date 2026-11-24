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
          applyBrand({ overlayHidden: false });
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
}
