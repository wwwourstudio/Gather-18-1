import { busy, replaceKids } from './ui.js';
import { googleConfigured, setYouTubeThumbnail } from './google.js';

// AI designer: one window for covers, backdrops, logos and overlays, and the broadcast dialog's targets.
// Created by app.js through createDesigner(app): `app` carries the studio state and helpers this part uses.
export function createDesigner(app) {
  const {
    $, $$, store, autoTitle, S, myId, normalizeHex, hexLuminance, toast, newCode, copy, cssId, setStage,
    stageFont, hexA, setAssetData, compressImage, AI_NAME, acct, acctApi, rawSet, pushSettings,
    needAccountThen, savedBrandImgs, buildBgSvg, fmtLocal, renderUpcoming, downloadIcs, wiz, tc, tg, wErr,
    wWhen, parseHashtags, syncWizAiBar, renderKitVisualPreviews, rasterizeSvg, buildLogoSvg, buildOverlaySvg,
    openWizard, renderWizard, openEnter
  } = app;
  // ---------------------------------------------------------------- AI designer: one window for covers, backdrops, logos and overlays
  // Prompt, style, up to three reference images (screenshots, mock-ups, photos: drag, paste or browse), a big preview,
  // history and "Use this". Gemini's image model by default: the server's built-in Google key when there is one (Google
  // AI Studio provides it), else the host's own key; ChatGPT and Grok keys work too. The broadcast dialog and the Look tab
  // both open it, each with its own targets and its own way of using the result.
  const AI_IMG_PROVS = ['gemini', 'openai', 'grok'];
  const AID_TARGETS = {
    cover: { label: 'Cover', purpose: 'thumb', ar: '16 / 9' },
    backdrop: { label: 'Backdrop', purpose: 'backdrop', ar: '16 / 9' },
    logo: { label: 'Logo', purpose: 'logo', ar: '1 / 1' },
    overlay: { label: 'Overlay', purpose: 'overlay', ar: '16 / 9' },
  };
  const AID_STYLES = {
    cover: ['Cinematic studio', 'Neon night', 'Clean minimal', 'Bold gradient', 'Retro VHS', 'Natural daylight'],
    backdrop: ['Cozy studio', 'Neon city night', 'Soft gradient', 'Retro arcade', 'Lush greenery', 'Deep space'],
    logo: ['Monogram', 'Geometric mark', 'Mascot', 'Badge', 'Neon sign'],
    overlay: ['Corner brackets', 'Thin glow frame', 'Neon edge', 'Glass panel', 'Sports broadcast'],
  };
  const AID = {
    target: 'cover', targets: ['cover', 'logo', 'overlay'], onUse: null, title: () => '', kind: () => 'live show',
    refs: [], prompt: {}, style: { cover: 'Cinematic studio', backdrop: 'Cozy studio', logo: 'Monogram', overlay: 'Corner brackets' },
    results: { cover: [], backdrop: [], logo: [], overlay: [] }, pick: { cover: null, backdrop: null, logo: null, overlay: null }, busy: false,
  };
  function aiImageSource() {
    const prov = store.get('aiImgProv', 'gemini'), key = store.get('aiKey:' + prov, '');
    if (key && AI_IMG_PROVS.includes(prov)) return { provider: prov, apiKey: key, label: `${AI_NAME[prov] || prov} · your key` };
    const g = store.get('aiKey:gemini', '');
    if (g) return { provider: 'gemini', apiKey: g, label: 'Gemini · your key' };
    if (S.houseImages) return { provider: 'gemini', apiKey: '', label: `Gemini · built-in (${S.houseImages.daily} a day)` };
    return null;
  }
  /** Text (titles, hashtags, descriptions): your AI key, else a Gemini key, else the built-in Google key. */
  function activeWizAi() {
    const prov = S.aiProv || store.get('aiProv', 'gemini'), key = store.get('aiKey:' + prov, '');
    if (key) return { prov, key };
    const g = store.get('aiKey:gemini', '');
    if (g) return { prov: 'gemini', key: g };
    return { prov: 'gemini', key: '', house: !!S.houseImages };
  }
  const imgToDataUrl = (src, max = 768) => new Promise((resolve) => {
    const go = (im) => { const w0 = im.naturalWidth || im.width, h0 = im.naturalHeight || im.height, k = Math.min(1, max / Math.max(w0, h0)); const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.84)); };
    if (typeof src === 'string') loadImg(src).then(go).catch(() => resolve('')); else go(src);
  });
  // AI images come back as big PNGs; the studio's asset store takes about 900 KB. Opaque art becomes JPEG, see-through
  // art (overlays) WebP, stepping quality down until it fits.
  function fitCanvas(c, alpha) {
    for (const q of [0.9, 0.82, 0.72, 0.6, 0.5]) { const d = c.toDataURL(alpha ? 'image/webp' : 'image/jpeg', q); if (d.length < 850_000) return d; }
    return c.toDataURL(alpha ? 'image/webp' : 'image/jpeg', 0.4);
  }
  async function fitImage(data, w = 1280, h = 720) {
    const im = await loadImg(data), c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(im, 0, 0, w, h); return fitCanvas(c, false);
  }
  // An overlay must let the video through: keep the art in a band around the edges and cut a soft hole in the middle.
  async function cutOverlay(data) {
    const im = await loadImg(data), W = 1280, H = 720, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g2 = c.getContext('2d'); g2.drawImage(im, 0, 0, W, H);
    g2.globalCompositeOperation = 'destination-out';
    const x = W * 0.075, y = H * 0.1, w = W - x * 2, h = H - y * 2, r = 22, f = 26;
    g2.filter = `blur(${f / 2}px)`; g2.fillStyle = '#000'; g2.beginPath(); g2.roundRect(x, y, w, h, r); g2.fill();
    g2.filter = 'none'; g2.beginPath(); g2.roundRect(x + f / 2, y + f / 2, w - f, h - f, r); g2.fill();
    return fitCanvas(c, true);
  }
  async function squareLogo(data) {
    const im = await loadImg(data), c = document.createElement('canvas'); c.width = c.height = 512;
    const sq = Math.min(im.naturalWidth, im.naturalHeight);
    c.getContext('2d').drawImage(im, (im.naturalWidth - sq) / 2, (im.naturalHeight - sq) / 2, sq, sq, 0, 0, 512, 512);
    return c.toDataURL('image/png');
  }
  /** The image engine everything uses: returns a ready-to-use data URL for the target. */
  async function designImage(t, prompt, refs = []) {
    const src = aiImageSource();
    if (!src) throw Object.assign(new Error('Add a Gemini key (free at aistudio.google.com) to design with AI. ChatGPT and Grok keys work too.'), { needKey: true });
    const finalPrompt = t === 'logo' ? `${prompt}. Strict 1:1 square icon/emblem layout, centered composition with balanced padding, crisp vector-style edges.` : prompt;
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'image', provider: src.provider, apiKey: src.apiKey, prompt: finalPrompt, purpose: AID_TARGETS[t].purpose, ...(refs.length ? { refs } : {}) }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.data) throw new Error(j.error || 'The image request failed. Try again.');
    return t === 'overlay' ? cutOverlay(j.data) : t === 'logo' ? squareLogo(j.data) : fitImage(j.data);
  }
  /** No key and no built-in one: the drawn templates, so a click never dead-ends. */
  async function templateImage(t) {
    const col = S.state.brand.color, title = AID.title() || S.name || 'Live';
    if (t === 'logo') return rasterizeSvg(buildLogoSvg(col, title), 512, 512);
    if (t === 'overlay') return rasterizeSvg(buildOverlaySvg(col, S.state.streamType || wiz.streamType || 'live', title), 1280, 720);
    return rasterizeSvg(buildBgSvg(col, AID.prompt[t] || title), 1280, 720);
  }
  const aidPromptFor = (t) => AID.prompt[t] ?? `${{ cover: 'Cover art', backdrop: 'A studio backdrop', logo: 'A 1:1 square emblem logo', overlay: 'A stage frame' }[t]} for “${AID.title() || 'my show'}”, a ${AID.kind()}`;
  function aidRender() {
    const t = AID.target, src = aiImageSource();
    replaceKids($('#aidTarget'), ...AID.targets.map((k) => {
      const b = document.createElement('button'); b.type = 'button'; b.role = 'tab'; b.textContent = AID_TARGETS[k].label;
      b.classList.toggle('on', k === t); b.setAttribute('aria-selected', String(k === t));
      b.onclick = () => { AID.target = k; aidRender(); };
      return b;
    }));
    if (document.activeElement !== $('#aidPrompt')) $('#aidPrompt').value = aidPromptFor(t);
    $('#aidPrompt').placeholder = `Describe the ${AID_TARGETS[t].label.toLowerCase()} you want`;
    replaceKids($('#aidChips'), ...AID_STYLES[t].map((st) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'wiz-ai-chip' + (AID.style[t] === st ? ' on' : ''); b.textContent = st;
      b.setAttribute('aria-pressed', String(AID.style[t] === st)); b.onclick = () => { AID.style[t] = AID.style[t] === st ? '' : st; aidRender(); };
      return b;
    }));
    // references
    const tiles = AID.refs.map((r, i) => {
      const d = document.createElement('div'); d.className = 'aid-ref';
      const im = document.createElement('img'); im.src = r; im.alt = `Reference ${i + 1}`;
      const x = document.createElement('button'); x.type = 'button'; x.className = 'aid-ref-x'; x.setAttribute('aria-label', `Remove reference ${i + 1}`); x.textContent = '×';
      x.onclick = () => { AID.refs.splice(i, 1); aidRender(); };
      d.append(im, x); return d;
    });
    if (AID.refs.length < 3) {
      const add = document.createElement('button'); add.type = 'button'; add.className = 'aid-ref-add';
      add.innerHTML = '<svg class="i sm" aria-hidden="true"><use href="/icons.svg#i-upload"/></svg><span>Add image</span><small>drop · paste · browse</small>';
      add.onclick = () => $('#aidFile').click(); tiles.push(add);
    }
    replaceKids($('#aidRefs'), ...tiles);
    const mine = savedBrandImgs().logo || wiz.logoData;
    $('#aidUseLogo').hidden = !mine || AID.refs.length >= 3;
    // preview + history
    const pick = AID.pick[t];
    $('#aidPreview').style.aspectRatio = AID_TARGETS[t].ar;
    $('#aidPreview').dataset.t = t;
    $('#aidImg').hidden = !pick; if (pick) $('#aidImg').src = pick;
    $('#aidEmpty').hidden = !!pick || AID.busy;
    $('#aidBusy').hidden = !AID.busy;
    const hist = AID.results[t];
    $('#aidHistory').hidden = !hist.length;
    replaceKids($('#aidHistory'), ...hist.map((d, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'aid-hist' + (d === pick ? ' on' : ''); b.style.aspectRatio = AID_TARGETS[t].ar;
      b.setAttribute('aria-label', `Result ${i + 1}`); b.innerHTML = `<img alt="" src="${d}">`; b.onclick = () => { AID.pick[t] = d; aidRender(); };
      return b;
    }));
    $('#aidWho').textContent = src ? src.label : 'No AI key yet';
    $('#aidWho').classList.toggle('warn', !src);
    $('#aidGo').disabled = AID.busy;
    $('#aidGo').querySelector('span').textContent = AID.busy ? 'Designing…' : pick ? `Generate another ${AID_TARGETS[t].label.toLowerCase()}` : `Generate ${AID_TARGETS[t].label.toLowerCase()}`;
    $('#aidTemplate').hidden = !!src;
    $('#aidUse').disabled = !pick || AID.busy;
    $('#aidUse').textContent = `Use this ${AID_TARGETS[t].label.toLowerCase()}`;
  }
  function openDesigner({ target, targets, onUse, title, kind, keys } = {}) {
    AID.targets = targets || AID.targets; AID.target = target && AID.targets.includes(target) ? target : AID.targets[0];
    AID.onUse = onUse || null; AID.title = title || (() => S.state.title || ''); AID.kind = kind || (() => ({ live: 'live talk show', shopping: 'live shopping show', gamer: 'gaming stream' }[S.state.streamType] || 'live show'));
    aidKeys(!!keys || false);
    aidRender();
    if (!$('#aidDlg').open) $('#aidDlg').showModal();
    setTimeout(() => (keys ? $('#aidKey') : $('#aidPrompt')).focus(), 60);
  }
  function aidKeys(open) {
    $('#aidKeyBar').hidden = !open; $('#aidKeyBtn').setAttribute('aria-expanded', String(open));
    if (!open) return;
    const prov = store.get('aiImgProv', 'gemini');
    $('#aidProv').value = prov; $('#aidKey').value = store.get('aiKey:' + prov, '');
    $('#aidKeyNote').textContent = prov === 'gemini' ? 'Get a free Gemini key at aistudio.google.com/apikey. It stays in this browser.' : 'It stays in this browser.';
  }
  async function aidAddFiles(files) {
    for (const f of [...files].filter((x) => x.type.startsWith('image/')).slice(0, 3 - AID.refs.length)) {
      const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => res(''); r.readAsDataURL(f); });
      const small = url ? await imgToDataUrl(url) : '';
      if (small) AID.refs.push(small);
    }
    aidRender();
  }
  $('#aidFile').addEventListener('change', (e) => { aidAddFiles(e.target.files); e.target.value = ''; });
  $('#aidRefs').addEventListener('dragover', (e) => { e.preventDefault(); $('#aidRefs').classList.add('over'); });
  $('#aidRefs').addEventListener('dragleave', () => $('#aidRefs').classList.remove('over'));
  $('#aidRefs').addEventListener('drop', (e) => { e.preventDefault(); $('#aidRefs').classList.remove('over'); aidAddFiles(e.dataTransfer.files); });
  $('#aidDlg').addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); aidAddFiles(fs); toast('Reference image added.'); } });
  $('#aidUseLogo').addEventListener('click', async () => { const d = savedBrandImgs().logo || wiz.logoData; if (d && AID.refs.length < 3) { AID.refs.push(await imgToDataUrl(d)); aidRender(); } });
  $('#aidPrompt').addEventListener('input', () => { AID.prompt[AID.target] = $('#aidPrompt').value; });
  $('#aidPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#aidGo').click(); } });
  $('#aidKeyBtn').addEventListener('click', () => aidKeys($('#aidKeyBar').hidden));
  $('#aidProv').addEventListener('change', () => { store.set('aiImgProv', $('#aidProv').value); aidKeys(true); aidRender(); syncWizAiBar(); });
  $('#aidKeySave').addEventListener('click', () => {
    const prov = $('#aidProv').value, key = $('#aidKey').value.trim();
    if (!key) return toast('Paste your key first.', { err: true });
    store.set('aiImgProv', prov); store.set('aiKey:' + prov, key);
    aidKeys(false); aidRender(); syncWizAiBar(); toast(`${AI_NAME[prov] || prov} key saved in this browser.`);
  });
  $('#aidGo').addEventListener('click', async () => {
    const t = AID.target;
    const prompt = [$('#aidPrompt').value.trim() || aidPromptFor(t), AID.style[t] ? `Style: ${AID.style[t]}` : '', $('#aidBrand').checked && S.state.brand.color ? `Accent colour ${S.state.brand.color}` : ''].filter(Boolean).join('. ');
    AID.busy = true; aidRender();
    try {
      const data = await designImage(t, prompt, AID.refs);
      AID.results[t] = [data, ...AID.results[t]].slice(0, 6); AID.pick[t] = data;
    } catch (err) { if (err.needKey) aidKeys(true); toast(err.message, { err: true }); }
    finally { AID.busy = false; aidRender(); }
  });
  $('#aidTemplate').addEventListener('click', async () => {
    const t = AID.target, data = await templateImage(t);
    AID.results[t] = [data, ...AID.results[t]].slice(0, 6); AID.pick[t] = data; aidRender();
  });
  $('#aidUse').addEventListener('click', async () => {
    const t = AID.target, d = AID.pick[t]; if (!d || !AID.onUse) return;
    busy($('#aidUse'));
    try { await AID.onUse(t, d); $('#aidDlg').close(); toast(`${AID_TARGETS[t].label} applied.`); }
    catch (err) { toast(err.message, { err: true }); }
    finally { busy($('#aidUse'), false); }
  });

  // The broadcast dialog's targets and how it uses a result.
  async function wizApply(t, data) {
    if (t === 'cover') { wiz.upload = null; wiz.aiBg = await loadImg(data); drawThumb(); thumbState(); return; }
    const imgs = savedBrandImgs();
    if (t === 'logo') { wiz.logoData = data; imgs.logo = data; } else { wiz.overlayData = data; imgs.overlay = data; }
    try { rawSet('brandImgs', imgs); } catch {}
    renderKitVisualPreviews();
  }
  const wizDesigner = (target, extra = {}) => openDesigner({
    target, targets: ['cover', 'logo', 'overlay'], onUse: wizApply,
    title: () => $('#wTitle')?.value.trim() || (S.name ? `${S.name}’s show` : ''), kind: () => ({ live: 'live talk show', shopping: 'live shopping show', gamer: 'gaming stream' }[wiz.streamType] || 'live show'), ...extra,
  });
  $('#wThumbAiBtn')?.addEventListener('click', () => wizDesigner('cover'));
  $('#wLogoAiBtn')?.addEventListener('click', () => wizDesigner('logo'));
  $('#wOverlayAiBtn')?.addEventListener('click', () => wizDesigner('overlay'));

  async function generateWizKit(withVisuals) {
    const { prov, key, house } = activeWizAi();
    if (!key && !house) { wizDesigner('cover', { keys: true }); return toast('Add an AI key (a free Gemini key works) to write titles and make the kit.', { err: true }); }
    const btn = withVisuals ? $('#wAiKitBtn') : $('#wAiCopyBtn');
    busy(btn);
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'kit', provider: prov, apiKey: key, model: key ? store.get('aiModel:' + prov, '') : '', topic: $('#wTitle').value.trim() || $('#wDesc').value.trim(), streamType: wiz.streamType }) });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(raw.error || `AI request failed (${res.status}).`);
      const kit = raw.kit || raw; // the server sends { kit: { title, description, hashtags, headline, accentColor, …Prompt } }
      kit.color = kit.color || kit.accentColor;
      if (kit.title) $('#wTitle').value = kit.title;
      if (kit.description) $('#wDesc').value = kit.description;
      if (Array.isArray(kit.hashtags) && kit.hashtags.length) $('#wTags').value = kit.hashtags.join(', ');
      if (kit.headline) { $('#wHeadline').value = kit.headline; $('#wHeadline').dataset.touched = '1'; }
      if (normalizeHex(kit.color)) setStage({ brand: { color: normalizeHex(kit.color) } });
      if (withVisuals) {
        const jobs = [['cover', kit.thumbPrompt], ['logo', kit.logoPrompt], ['overlay', kit.overlayPrompt]];
        const got = aiImageSource() ? await Promise.allSettled(jobs.map(([t, pr]) => designImage(t, pr || aidPromptFor(t)))) : [];
        for (let i = 0; i < jobs.length; i++) {
          const t = jobs[i][0], data = got[i]?.status === 'fulfilled' ? got[i].value : t === 'cover' ? null : await templateImage(t);
          if (data) { AID.results[t] = [data, ...AID.results[t]].slice(0, 6); AID.pick[t] = data; await wizApply(t, data); }
        }
      }
      drawThumb();
      toast(withVisuals ? 'Your stream kit is ready: title, tags, cover, logo and overlay.' : 'Title, description and hashtags written.');
    } catch (err) { toast(err.message || 'AI kit generation failed.', { err: true }); }
    finally { busy(btn, false); syncWizAiBar(); }
  }
  $('#wAiCopyBtn')?.addEventListener('click', () => generateWizKit(false));
  $('#wAiKitBtn')?.addEventListener('click', () => generateWizKit(true));
  $('#wLogoPick')?.addEventListener('click', () => $('#wLogoFile').click());
  $('#wLogoFile')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    wiz.logoData = await compressImage(f); const imgs = savedBrandImgs(); imgs.logo = wiz.logoData; try { rawSet('brandImgs', imgs); } catch {}
    renderKitVisualPreviews(); toast('Brand logo uploaded.');
  });
  $('#wLogoClear')?.addEventListener('click', () => {
    wiz.logoData = ''; const imgs = savedBrandImgs(); delete imgs.logo; rawSet('brandImgs', imgs);
    renderKitVisualPreviews();
  });
  $('#wOverlayPick')?.addEventListener('click', () => $('#wOverlayFile').click());
  $('#wOverlayFile')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    wiz.overlayData = await compressImage(f); const imgs = savedBrandImgs(); imgs.overlay = wiz.overlayData; try { rawSet('brandImgs', imgs); } catch {}
    renderKitVisualPreviews(); toast('Stage overlay uploaded.');
  });
  $('#wOverlayClear')?.addEventListener('click', () => {
    wiz.overlayData = ''; const imgs = savedBrandImgs(); delete imgs.overlay; rawSet('brandImgs', imgs);
    renderKitVisualPreviews();
  });

  $$('#wStyle button').forEach((b) => b.addEventListener('click', () => { wiz.style = b.dataset.ws; renderWizard(); drawThumb(); }));
  $('#wHeadline').oninput = drawThumb;
  $('#wTitle').addEventListener('input', () => { if (!$('#wHeadline').dataset.touched) $('#wHeadline').value = $('#wTitle').value; drawThumb(); renderKitVisualPreviews(); });
  $('#wHeadline').addEventListener('input', () => { $('#wHeadline').dataset.touched = '1'; });
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  $('#wSnap').onclick = async () => {
    const v = $(`#card-${cssId(myId())} video`) || $('#previewVideo');
    if (!v?.videoWidth) return toast('Turn your camera on in the green room first, or upload a photo.', { err: true });
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0); wiz.photo = await loadImg(c.toDataURL('image/jpeg', .9)); wiz.upload = null; drawThumb(); thumbState();
  };
  $('#wPhotoPick').onclick = () => $('#wPhotoFile').click();
  $('#wPhotoFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { wiz.photo = await loadImg(await compressImage(f)); wiz.upload = null; drawThumb(); thumbState(); } };
  $('#wUploadPick').onclick = () => $('#wUploadFile').click();
  $('#wUploadFile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { wiz.upload = await loadImg(await compressImage(f)); drawThumb(); thumbState(); } };
  $('#wUploadClear').onclick = () => { wiz.upload = null; drawThumb(); thumbState(); };
  /** The thumbnail card shows whether it's your own upload (used exactly as is) or one made here. */
  function thumbState() {
    const up = !!wiz.upload;
    $('#wThumbBadge').hidden = !up; $('#wUploadClear').hidden = !up;
    $('#wThumbMake').classList.toggle('dim', up);
  }
  const thumbBlob = () => new Promise((res) => tc.toBlob((b) => res(b), 'image/jpeg', 0.9));
  $('#wThumbDl').onclick = async () => {
    const b = await thumbBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = (($('#wTitle')?.value || 'thumbnail').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'thumbnail') + '.jpg'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Thumbnail saved. Upload it on Twitch, Kick or anywhere else.');
  };
  $('#wThumbYt').onclick = async () => {
    if (!googleConfigured()) return toast('YouTube isn’t set up on this site yet. Download the thumbnail and add it in YouTube Studio.', { err: true });
    const btn = $('#wThumbYt'); busy(btn);
    try { const t = await setYouTubeThumbnail(await thumbBlob()); toast(`Thumbnail set on YouTube for “${t}”.`); }
    catch (e) { toast(e.message || 'YouTube didn’t take the thumbnail.', { err: true, ms: 7000 }); }
    finally { busy(btn, false); }
  };
  function cover(gx, img, x, y, w, h) {
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
    gx.save(); gx.beginPath(); gx.rect(x, y, w, h); gx.clip(); gx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); gx.restore();
  }
  function drawThumb() {
    const Wt = 1280, Ht = 720, accent = S.state.brand.color || '#3b82f6', F = stageFont();
    const ink = hexLuminance(accent) > 0.42 ? '#070c1a' : '#ffffff';
    tg.clearRect(0, 0, Wt, Ht);
    if (wiz.upload) { cover(tg, wiz.upload, 0, 0, Wt, Ht); return; }
    if (wiz.aiBg) cover(tg, wiz.aiBg, 0, 0, Wt, Ht);
    else { const gr = tg.createLinearGradient(0, 0, Wt, Ht); gr.addColorStop(0, '#090c14'); gr.addColorStop(.55, hexA(accent, .28)); gr.addColorStop(1, hexA(accent, .62)); tg.fillStyle = gr; tg.fillRect(0, 0, Wt, Ht); }
    const head = ($('#wHeadline').value || $('#wTitle').value || 'Your stream title').trim();
    const st = wiz.style;
    if (wiz.photo) {
      if (st === 'split') cover(tg, wiz.photo, Wt * .5, 0, Wt * .5, Ht);
      else if (st === 'center') { tg.save(); tg.globalAlpha = .35; cover(tg, wiz.photo, 0, 0, Wt, Ht); tg.restore(); }
      else { cover(tg, wiz.photo, Wt * .48, 0, Wt * .52, Ht); const fade = tg.createLinearGradient(Wt * .48, 0, Wt * .62, 0); fade.addColorStop(0, 'rgba(8,12,24,1)'); fade.addColorStop(1, 'rgba(8,12,24,0)'); tg.fillStyle = fade; tg.fillRect(Wt * .48, 0, Wt * .14, Ht); }
    }
    if (st !== 'center') { const sh = tg.createLinearGradient(0, 0, Wt * .62, 0); sh.addColorStop(0, 'rgba(7,12,26,.82)'); sh.addColorStop(1, 'rgba(7,12,26,0)'); tg.fillStyle = sh; tg.fillRect(0, 0, Wt * .62, Ht); }
    const maxW = st === 'center' ? Wt - 160 : Wt * .46;
    let size = 98;
    tg.font = `900 ${size}px ${F}`;
    let lines = [];
    for (;;) {
      tg.font = `900 ${size}px ${F}`;
      const words = head.toUpperCase().split(/\s+/); lines = []; let cur = '';
      for (const w of words) { const test = cur ? cur + ' ' + w : w; if (tg.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
      if (cur) lines.push(cur);
      if (lines.length <= 4 || size <= 48) break;
      size -= 8;
    }
    const lh = size * 1.04, total = lines.length * lh;
    tg.textAlign = st === 'center' ? 'center' : 'left'; tg.textBaseline = 'alphabetic';
    const x0 = st === 'center' ? Wt / 2 : 70, y0 = (Ht - total) / 2 + size * .85;
    lines.forEach((l, i) => {
      tg.lineWidth = size * .12; tg.strokeStyle = 'rgba(0,0,0,.6)'; tg.lineJoin = 'round'; tg.strokeText(l, x0, y0 + i * lh);
      tg.fillStyle = i === lines.length - 1 ? accent : '#ffffff'; tg.fillText(l, x0, y0 + i * lh);
    });
    tg.fillStyle = accent; tg.fillRect(st === 'center' ? Wt / 2 - 60 : 72, y0 + (lines.length - 1) * lh + 26, 120, 8);
    // Subtle stream type pill on thumbnail
    const typeLbl = { live: 'LIVE SHOW', shopping: 'LIVE SHOPPING', gamer: 'GAMER STREAM' }[wiz.streamType] || 'LIVE SHOW';
    tg.font = '800 20px Inter, sans-serif';
    const pw = tg.measureText(typeLbl).width + 32;
    const px = st === 'center' ? (Wt - pw) / 2 : 70;
    tg.fillStyle = accent; tg.beginPath(); tg.roundRect(px, 54, pw, 38, 8); tg.fill(); // on the cover canvas (rr() draws on the stage's)
    tg.fillStyle = ink; tg.fillText(typeLbl, px + 16, 80);
  }

  function saveWizDefaults(quiet = false) {
    const title = $('#wTitle').value.trim();
    const hashtags = parseHashtags($('#wTags')?.value || '');
    const notifyPrefs = {
      email: $('#wNotifyEmail')?.checked !== false,
      r24h: $('#wNotify24h')?.checked !== false,
      r15m: $('#wNotify15m')?.checked !== false,
    };
    const sp = store.get('streamPrefs', {});
    const qual = $('#wOptQuality')?.value || S.prefs.quality || '720';
    S.prefs.quality = qual;
    if ($('#qualitySelect')) $('#qualitySelect').value = qual;
    store.set('quality', qual);
    store.set('streamPrefs', {
      ...sp,
      autoRec: !!$('#wOptAutoRec')?.checked,
      countdown: !!$('#wOptCountdown')?.checked,
      privacy: $('#wOptPrivacy')?.value || 'public',
    });
    store.set('streamType', wiz.streamType);
    store.set('hashtags', hashtags);
    if (title) store.set('title', title);
    store.set('notifyPrefs', notifyPrefs);
    store.set('onboardingDone', true);
    store.set('destTemplates', app.liveDests().map((d) => ({ kind: d.kind, url: d.url, watch: d.watch, on: d.on })));
    if (acct.user) pushSettings();
    if (!quiet) toast(acct.user ? 'Stream defaults saved to your account.' : 'Stream defaults saved locally.');
  }
  $('#wSaveDefaults')?.addEventListener('click', () => saveWizDefaults(false));

  async function proceedWizLaunch() {
    wErr('');
    const title = $('#wTitle').value.trim() || autoTitle();
    const hashtags = parseHashtags($('#wTags')?.value || '');
    const notifyPrefs = {
      email: $('#wNotifyEmail')?.checked !== false,
      r24h: $('#wNotify24h')?.checked !== false,
      r15m: $('#wNotify15m')?.checked !== false,
    };
    const destinations = [...new Set(app.liveDests().filter((d) => d.on).map((d) => d.kind))];
    const thumb = tc.toDataURL('image/jpeg', .86);
    const body = {
      title, description: $('#wDesc').value.trim(), invites: $('#wInvites').value,
      destinations, streamType: wiz.streamType, hashtags, notifyPrefs,
      thumb, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, duration: Number($('#wDur').value || 60),
      privacy: $('#wOptPrivacy')?.value || 'public',
    };
    if (wiz.mode === 'later') {
      if (!acct.user) return needAccountThen(() => { $('#wizDlg').showModal(); proceedWizLaunch(); });
      const when = wWhen();
      if (!when || when < Date.now() + 60e3) return wErr('Pick a start time in the future.');
      if (when > Date.now() + 29 * 864e5) return wErr('You can schedule up to 29 days ahead.');
    }
    busy($('#wGo'));
    try {
      saveWizDefaults(true);
      const imgs = savedBrandImgs();
      const logoAsset = imgs.logo ? 'local-brand-logo' : '';
      const overlayAsset = imgs.overlay ? 'local-brand-overlay' : '';
      if (imgs.logo) setAssetData('local-brand-logo', imgs.logo);
      if (imgs.overlay) setAssetData('local-brand-overlay', imgs.overlay);
      const countdownPatch = $('#wOptCountdown')?.checked && wiz.mode === 'now'
        ? { countdown: { on: true, target: Date.now() + 3 * 60e3, autoLive: true, label: 'Starting soon' } }
        : {};
      setStage({ title, streamType: wiz.streamType, hashtags, ...countdownPatch, ...(logoAsset || overlayAsset ? { brand: { ...(logoAsset ? { logo: logoAsset } : {}), ...(overlayAsset ? { overlay: overlayAsset } : {}) } } : {}) });
      if (wiz.mode === 'later') {
        const r = await acctApi('streamCreate', { ...body, when: wWhen(), notify: notifyPrefs.email });
        S.streams.push(r.stream); renderUpcoming();
        $('#wSteps').hidden = true; $('#wDone').hidden = false;
        $('#wDoneWhen').textContent = fmtLocal(r.stream.when);
        $('#wDoneMail').textContent = r.stream.mail?.skipped || (r.stream.mail ? `${r.stream.mail.sent} invites sent, ${r.stream.mail.scheduled} reminders scheduled${r.stream.mail.failed ? `, ${r.stream.mail.failed} failed: ${r.stream.mail.error}` : ''}.` : 'Scheduled without guest emails.');
        wiz.done = r.stream;
      } else {
        const startNow = async () => {
          let code = newCode(), id = null;
          if (acct.user) {
            try { const r = await acctApi('streamCreate', body); code = r.stream.studio; id = r.stream.id; } catch {}
          }
          S.pendingStream = { code, id, title };
          $('#wizDlg').close();
          openEnter('create');
        };
        if (S.requireAccount && !acct.user) {
          $('#wizDlg').close();
          return needAccountThen(() => { openWizard('now'); startNow(); });
        }
        await startNow();
      }
    } catch (err) { wErr(err.message); }
    finally { busy($('#wGo'), false); }
  }
  $('#wGo').onclick = proceedWizLaunch;
  $('#wDoneCopy').onclick = () => wiz.done && copy(`${location.origin}/s/${wiz.done.studio}`, 'Invite link copied.');
  $('#wDoneCal').onclick = () => wiz.done && downloadIcs(wiz.done);
  $('#wDoneClose').onclick = () => $('#wizDlg').close();

  return { aiImageSource, openDesigner, aidAddFiles, loadImg, cover, drawThumb };
}
