import { replaceKids } from './ui.js';

// The AI producer (default name Sam): you talk or type to it and it runs the show, plus the one speech
// recogniser shared by captions and the wake word.
// Created by app.js through createProducer(app): `app` carries the studio state and helpers this part uses.
export function createProducer(app) {
  const {
    $, $$, store, S, isHost, toast, audioCtx, syncMedia, mixInMedia, stopPresentation, presentScreen, creds,
    setStage, participants, g, mixHex, accentOf, hexA, uid, withDefaults, AI_NAME, plainMd, elementsCopy,
    upsertAI, actChip, renderAILog, renderAIPanel, setAiSetup, autoGrow, cap, sendCaption, showCaption,
    setTab, sceneList, activeSceneId, applyScene, renderOffBg, libLoad, presentLibrary
  } = app;
  // ---------------------------------------------------------------- AI producer: name it, talk to it, it runs the show
  S.aiName = store.get('aiName', 'Sam');
  S.aiWake = store.get('aiWake', false);
  S.aiStatus = 'idle';
  const AI_STATE = { idle: 'Ready', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking' };
  function setAiStatus(st) {
    S.aiStatus = st;
    for (const id of ['#cmdBar', '#aiDock', '#aiHead']) $(id).dataset.status = st;
    $('#cmdState').textContent = AI_STATE[st];
    $('#aiMic').setAttribute('aria-pressed', st === 'listening'); $('#cmdMic').setAttribute('aria-pressed', st === 'listening');
    renderAIPanel();
  }
  function renderProducerUI() {
    const host = isHost();
    $('#cmdInput').placeholder = `Ask ${S.aiName}…`;
    $('#aiInput').placeholder = `Message ${S.aiName}…`;
    $('#aiWakeHint').textContent = `Say “Hey ${S.aiName}, …” and it acts. Chrome or Edge.`;
    for (const id of ['#cmdName', '#aiTitle', '#aiDockName']) $(id).textContent = S.aiName;
    $('#aiDock').hidden = !host || !S.studio;
    if (!host || !S.studio) setCmd(false);
    if (document.activeElement !== $('#aiName')) $('#aiName').value = S.aiName;
    $('#aiWake').checked = !!S.aiWake;
    const v = voiceMode();
    $$('#aiVoiceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.voice === v));
    $('#aiVoiceNameRow').hidden = !['gemini', 'gemini-podcast', 'openai'].includes(v);
    $('#aiVoiceTest').hidden = v === 'off';
    renderVoiceNames();
    $('#aiVoiceName').value = voiceName();
    $('#aiVoiceNote').textContent =
      v === 'gemini'
        ? 'Google Gemini 3.8 Flash Lite TTS. Everyone in the stream and recording hears it.'
        : v === 'gemini-podcast'
          ? 'Google Gemini 3.8 Flash Expressive TTS. Warm podcast co-host delivery on air.'
          : v === 'openai'
            ? (store.get('aiKey:openai', '') || S.houseVoice ? 'Natural stream voice heard by everyone.' : 'Add a ChatGPT key under Advanced, or switch to Gemini voice.')
            : v === 'browser'
              ? 'Your device’s own voice. Only you hear it.'
              : `${S.aiName} replies without speaking.`;
  }
  $('#aiName').addEventListener('input', (e) => {
    S.aiName = e.target.value.trim().slice(0, 20) || 'Sam';
    store.set('aiName', S.aiName);
    window.gatherCloud?.updateProfilePrefs?.({ aiName: S.aiName }).catch(() => {});
    renderProducerUI(); renderAILog();
  });
  $('#aiWake').onchange = (e) => { S.aiWake = e.target.checked; store.set('aiWake', S.aiWake); syncCaptions(); toast(S.aiWake ? `Say “Hey ${S.aiName}” and then what you need.` : 'Wake word off.'); };
  $$('#aiVoiceSeg button').forEach((b) => b.addEventListener('click', () => {
    store.set('aiVoice', b.dataset.voice);
    window.gatherCloud?.updateProfilePrefs?.({ aiVoice: b.dataset.voice }).catch(() => {});
    renderProducerUI();
  }));
  $('#aiVoiceName').onchange = (e) => {
    const key = geminiVoiceMode() ? 'aiVoiceName:gemini' : elevenVoice() ? 'aiVoiceName:eleven' : 'aiVoiceName';
    store.set(key, e.target.value);
    window.gatherCloud?.updateProfilePrefs?.({ aiVoiceName: e.target.value }).catch(() => {});
  };
  // Gemini 3.8 TTS is the default stream voice when available; falls back to browser voice otherwise.
  function voiceMode() {
    const saved = store.get('aiVoice', null);
    if (saved) return saved;
    if (S.houseVoice?.provider === 'gemini') return 'gemini';
    return S.houseVoice ? 'openai' : 'gemini';
  }
  function geminiVoiceMode() {
    const m = voiceMode();
    return m === 'gemini' || m === 'gemini-podcast' || (m === 'openai' && !store.get('aiKey:openai', '') && S.houseVoice?.provider === 'gemini');
  }
  function elevenVoice() { return !geminiVoiceMode() && !store.get('aiKey:openai', '') && S.houseVoice?.provider === 'elevenlabs'; }
  function voiceName() {
    if (geminiVoiceMode()) return store.get('aiVoiceName:gemini', 'Zephyr');
    return elevenVoice() ? store.get('aiVoiceName:eleven', 'rachel') : store.get('aiVoiceName', 'coral');
  }
  function renderVoiceNames() {
    const list = geminiVoiceMode()
      ? [['Zephyr', 'Zephyr · warm co-host'], ['Kore', 'Kore · crisp studio'], ['Puck', 'Puck · upbeat lively'], ['Charon', 'Charon · calm steady'], ['Fenrir', 'Fenrir · deep broadcast']]
      : elevenVoice()
        ? [['rachel', 'Rachel · warm'], ['sarah', 'Sarah · bright'], ['elli', 'Elli · young'], ['adam', 'Adam · deep'], ['josh', 'Josh · friendly'], ['antoni', 'Antoni · smooth']]
        : [['coral', 'Coral · warm'], ['sage', 'Sage · calm'], ['ash', 'Ash · clear'], ['ballad', 'Ballad · soft'], ['verse', 'Verse · lively'], ['nova', 'Nova · bright'], ['alloy', 'Alloy · neutral'], ['echo', 'Echo · low'], ['fable', 'Fable · British'], ['onyx', 'Onyx · deep'], ['shimmer', 'Shimmer · light']];
    const sel = $('#aiVoiceName'), key = list.map((x) => x[0]).join();
    if (sel.dataset.list !== key) { sel.dataset.list = key; replaceKids(sel, ...list.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; })); }
    sel.value = voiceName();
  }
  renderVoiceNames();
  $('#aiVoiceTest').onclick = () => speak(`Hi, I'm ${S.aiName}. Ready when you are.`);
  // The command bar floats over the stage only while you're using it: open it from the dock or with "/".
  function setCmd(open) {
    const bar = $('#cmdBar');
    if (bar.hidden === !open) return;
    bar.hidden = !open; $('#aiDock').setAttribute('aria-expanded', open);
    if (open) { $('#cmdInput').focus(); } else if (bar.contains(document.activeElement)) $('#aiDock').focus();
  }
  $('#aiDock').onclick = () => setCmd($('#cmdBar').hidden);
  $('#cmdClose').onclick = () => setCmd(false);
  $('#cmdBar').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setCmd(false); } });
  $('#cmdForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#cmdInput').value; $('#cmdInput').value = ''; askProducer(v); });
  function pushToTalk(target) {
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return toast('Talking to your AI needs Chrome or Edge. You can type instead.', { err: true });
    speechHub.ptt = !speechHub.ptt; speechHub.target = target;
    setAiStatus(speechHub.ptt ? 'listening' : 'idle');
    syncCaptions();
  }
  $('#cmdMic').onclick = () => pushToTalk('#cmdInput');
  $('#aiMic').onclick = () => pushToTalk('#aiInput');
  $('#cmdShow').onclick = () => {
    const p = S.pendingOpen;
    if (!p) return;
    if (p.step === 'open') {
      window.open(p.url, 'gather-share', 'popup,width=1280,height=760');
      p.step = 'share';
      $('#cmdShow').textContent = 'Now share that window';
    } else {
      S.pendingOpen = null; $('#cmdShow').hidden = true;
      presentScreen();
    }
  };
  function offerOpen(url, label) {
    S.pendingOpen = { url, label: label || url, step: 'open' };
    setCmd(true);
    $('#cmdShow').hidden = false;
    $('#cmdShow').textContent = `Open “${String(label || new URL(url).hostname).slice(0, 40)}”`;
    $('#cmdShow').dataset.tip = url;
  }
  function findScene(name) {
    const n = String(name || '').toLowerCase().trim();
    const list = sceneList();
    return list.find((s) => String(s?.name || '').toLowerCase() === n) || list.find((s) => String(s?.name || '').toLowerCase().includes(n) || n.includes(String(s?.name || '').toLowerCase()));
  }
  function findLib(name) {
    const n = String(name || '').toLowerCase().trim();
    return S.library.find((i) => String(i?.name || '').toLowerCase() === n) || S.library.find((i) => String(i?.name || '').toLowerCase().includes(n) || n.includes(String(i?.name || '').toLowerCase()));
  }
  function producerCtx() {
    const sc = sceneList().find((x) => x.id === activeSceneId());
    return {
      name: S.aiName,
      scenes: sceneList().map((s) => s.name),
      library: S.library.map((i) => ({ name: i.name, kind: i.kind })),
      now: `scene: ${sc?.name || 'custom'}; presenting: ${S.local.pres ? S.local.pres.kind + ' ' + S.local.pres.name : 'nothing'}; banner: ${S.state.banner?.text || 'none'}; people: ${participants().map((p) => p.name).join(', ')}`,
    };
  }
  async function runActions(actions) {
    for (const a of actions || []) {
      try {
        if (a.type === 'scene') { const sc = findScene(a.name); if (sc) applyScene(sc); else toast(`No scene called “${a.name}”.`); }
        else if (a.type === 'present') { const it = findLib(a.name); if (it) await presentLibrary(it); else toast(`“${a.name}” isn’t in your media library.`); }
        else if (a.type === 'stop') stopPresentation();
        else if (a.type === 'banner') setStage({ banner: { id: uid(), text: String(a.text || '').slice(0, 120), sub: String(a.sub || '').slice(0, 120) } });
        else if (a.type === 'hide_banner') setStage({ banner: null });
        else if (a.type === 'countdown') {
          const m = Math.max(1, Math.min(120, Number(a.minutes) || 5));
          const els = elementsCopy().filter((e) => !(e.type === 'timer' && e.mode === 'countdown'));
          els.push(withDefaults({ type: 'timer', mode: 'countdown', target: Date.now() + m * 60000 }));
          setStage({ elements: els });
        } else if (a.type === 'spotlight') {
          const aiSpotlight = {
            head: String(a.head || '').slice(0, 100),
            bullets: Array.isArray(a.bullets) ? a.bullets.map((x) => String(x || '').slice(0, 160)).filter(Boolean).slice(0, 6) : [],
            links: Array.isArray(a.links) ? a.links.filter((l) => l?.url).slice(0, 4) : [],
            updatedAt: Date.now(),
          };
          setStage({ aiSpotlight });
        } else if (a.type === 'open' && /^https?:\/\//i.test(String(a.url || ''))) offerOpen(String(a.url), a.label);
      } catch (e) { toast(e.message, { err: true }); }
    }
  }
  /** The first sentence or two: what gets read aloud from a longer on-screen answer. */
  function spokenPart(text) {
    const t = plainMd(text).replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.{20,260}?[.!?])(\s|$)/);
    return m ? m[1] : t.slice(0, 260);
  }
  async function askProducer(text) {
    text = String(text || '').trim();
    if (!text || S.ai.busy) return;
    if (!isHost()) return toast('Only the host can direct the AI.', { err: true });
    const own = store.get('aiKey:' + S.aiProv, ''), house = !own && !!S.houseAI && !!S.studio;
    const prov = house ? S.houseAI.provider : S.aiProv, key = own;
    if (!key && !house) { setTab('ai'); setAiSetup(true); return toast(`Add your ${AI_NAME[prov]} key so ${S.aiName} can help.`, { err: true }); }
    const history = S.ai.items.filter((i) => i.done && !i.error && (i.role === 'user' || i.role === 'assistant')).slice(-10).map((i) => ({ role: i.role, text: i.text }));
    // a fresh answer takes over the AI window, unless the host pins an older one again
    for (const it of S.ai.items) if (it.pinned) upsertAI({ id: it.id, pinned: false });
    const ans = { id: uid(), role: 'assistant', text: '', provider: prov, done: false, actions: [] };
    upsertAI({ id: uid(), role: 'user', text, provider: prov, done: true });
    upsertAI(ans);
    S.ai.busy = true; setAiStatus('thinking');
    $('#cmdReply').textContent = ''; $('#cmdReply').classList.remove('err'); replaceKids($('#cmdActs')); $('#cmdShow').hidden = true;
    let reply = '';
    const fail = (msg) => { upsertAI({ ...ans, text: msg, error: true, done: true }); $('#cmdReply').textContent = msg; $('#cmdReply').classList.add('err'); };
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(house ? { mode: 'agent', house: true, ...creds(), messages: [...history, { role: 'user', text }], ctx: producerCtx() } : { mode: 'agent', provider: prov, apiKey: key, model: store.get('aiModel:' + prov, ''), messages: [...history, { role: 'user', text }], ctx: producerCtx() }) });
      if (res.headers.get('X-AI-Left') != null) { S.houseLeft = Number(res.headers.get('X-AI-Left')); renderAIPanel(); }
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `The AI request failed (${res.status}).`); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', failed = '';
      const onEvent = async (ev) => {
        if (ev.t === 'text') { reply += ev.d; ans.text = reply; upsertAI({ id: ans.id, text: reply }); $('#cmdReply').textContent = plainMd(reply); }
        else if (ev.t === 'sources' && Array.isArray(ev.sources)) { ans.sources = ev.sources; upsertAI({ id: ans.id, sources: ev.sources }); }
        else if (ev.t === 'action' && ev.a) { ans.actions = [...ans.actions, ev.a]; upsertAI({ id: ans.id, actions: ans.actions }); $('#cmdActs').append(actChip(ev.a, false)); await runActions([ev.a]); }
        else if (ev.t === 'error') failed = ev.message || 'The AI request failed.';
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let n;
        while ((n = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, n).trim(); buf = buf.slice(n + 1); if (line) { try { await onEvent(JSON.parse(line)); } catch (e) { if (!(e instanceof SyntaxError)) throw e; } } }
        if (done) break;
      }
      if (failed) throw new Error(failed);
      if (!reply.trim()) reply = ans.actions.length ? 'Done.' : '(No answer came back.)';
      upsertAI({ id: ans.id, text: reply, sources: ans.sources || [], done: true });
      $('#cmdReply').textContent = plainMd(reply);
      S.ai.busy = false;
      await speak(spokenPart(reply));
    } catch (e) {
      fail(e.message === 'Failed to fetch' ? 'Could not reach the AI. Check your connection and try again.' : e.message);
      toast(e.message, { err: true });
    } finally { S.ai.busy = false; if (S.aiStatus === 'thinking') setAiStatus('idle'); else renderAIPanel(); }
  }
  // Stage Vision: capture the current live stage canvas and analyze it with Gemini 4 Hydrogen
  async function askStageVision(customPrompt = '') {
    if (S.ai.busy) return;
    if (!isHost()) return toast('Only the host can use stage vision.', { err: true });
    const stageCanvas = app.getCanvas?.();
    if (!stageCanvas || !stageCanvas.width) return toast('Enter the studio first to inspect the live stage.', { err: true });
    const tmp = document.createElement('canvas');
    tmp.width = 640; tmp.height = 360;
    tmp.getContext('2d').drawImage(stageCanvas, 0, 0, tmp.width, tmp.height);
    const image = tmp.toDataURL('image/jpeg', 0.78);
    const prompt = String(customPrompt || '').trim() || 'Look at my live stage right now and give quick visual feedback or a talking point.';
    const ans = { id: uid(), role: 'assistant', text: '', provider: 'gemini', done: false, actions: [] };
    upsertAI({ id: uid(), role: 'user', text: `[Stage Vision] ${prompt}`, provider: 'gemini', done: true });
    upsertAI(ans);
    S.ai.busy = true; setAiStatus('thinking');
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'vision', image, prompt, studioContext: producerCtx().now }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Stage vision failed.');
      const text = j.text || 'I checked the live stage.';
      upsertAI({ id: ans.id, text, done: true });
      S.ai.busy = false;
      await speak(spokenPart(text));
    } catch (e) {
      upsertAI({ ...ans, text: e.message || 'Stage vision failed.', error: true, done: true });
      toast(e.message || 'Stage vision failed.', { err: true });
    } finally {
      S.ai.busy = false;
      if (S.aiStatus === 'thinking') setAiStatus('idle'); else renderAIPanel();
    }
  }
  // Voice out: Gemini 3.8 TTS or OpenAI voice goes into the stream mix; browser voice is host-only.
  async function speak(text) {
    const mode = voiceMode();
    if (mode === 'off' || !text) return;
    setAiStatus('speaking');
    try {
      if (mode === 'gemini' || mode === 'gemini-podcast' || mode === 'openai') {
        const useGemini = mode === 'gemini' || mode === 'gemini-podcast' || (!store.get('aiKey:openai', '') && S.houseVoice?.provider === 'gemini');
        const key = useGemini ? store.get('aiKey:gemini', '') : store.get('aiKey:openai', '');
        const house = !key && S.studio ? { studio: S.studio, id: S.id, tok: S.tok } : null;
        if (!useGemini && !key && !S.houseVoice) throw new Error('Add a ChatGPT key under Advanced, or switch to Gemini voice.');
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'tts',
            provider: useGemini ? (mode === 'gemini-podcast' ? 'gemini-podcast' : 'gemini') : 'openai',
            expressive: mode === 'gemini-podcast',
            apiKey: key || undefined,
            house: house || undefined,
            text,
            voice: voiceName(),
          }),
        });
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'The voice request failed.'); }
        const ctx = audioCtx();
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        const src = ctx.createBufferSource(); src.buffer = buf;
        const gn = ctx.createGain(); src.connect(gn); gn.connect(ctx.destination);
        const an = ctx.createAnalyser(); an.fftSize = 512; gn.connect(an); S.aiAnalyser = an;
        const mix = mixInMedia(gn); syncMedia();
        await new Promise((r) => { src.onended = r; src.start(); });
        mix.dispose(); syncMedia(); S.aiAnalyser = null;
      } else if ('speechSynthesis' in window) {
        await deviceSpeak(text);
      }
    } catch (e) { toast(e.message, { err: true }); }
    finally { if (S.aiStatus === 'speaking') setAiStatus('idle'); }
  }
  // The device's own voice, made as good as it can be: the most natural English voice it has (Edge's "Natural"
  // neural voices, Chrome's Google voices, Apple's enhanced/premium ones), a lively pace, and one sentence at a time
  // (Chrome cuts a long utterance off after about 15 seconds).
  function bestDeviceVoice() {
    const all = speechSynthesis.getVoices().filter((x) => /^en(-|_|$)/i.test(x.lang));
    const score = (x) => (/natural|neural/i.test(x.name) ? 50 : 0) + (/premium|enhanced/i.test(x.name) ? 40 : 0) + (/^google/i.test(x.name) ? 30 : 0)
      + (/aria|jenny|guy|ava|andrew|emma|brian|samantha|serena|daniel|karen|moira/i.test(x.name) ? 15 : 0) + (/en-us/i.test(x.lang) ? 5 : 0) + (x.localService ? 0 : 3)
      - (/compact|espeak|zira|david|fred|albert|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|whisper|zarvox|wobble/i.test(x.name) ? 60 : 0);
    return all.sort((a, b) => score(b) - score(a))[0] || null;
  }
  async function deviceSpeak(text) {
    if (!speechSynthesis.getVoices().length) await new Promise((r) => { speechSynthesis.addEventListener('voiceschanged', r, { once: true }); setTimeout(r, 1200); });
    const voice = bestDeviceVoice();
    const parts = String(text).replace(/\$(\d+(?:\.\d\d)?)/g, '$1 dollars').match(/[^.!?]+[.!?]*\s*/g) || [text];
    speechSynthesis.cancel();
    for (const p of parts) {
      if (!p.trim()) continue;
      await new Promise((r) => {
        const u = new SpeechSynthesisUtterance(p.trim());
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        u.rate = 1.04; u.pitch = 1;
        u.onend = r; u.onerror = r; speechSynthesis.speak(u);
        setTimeout(r, 15000);
      });
    }
  }
  function aiVoiceLevel() {
    const an = S.aiAnalyser;
    if (!an) return S.aiStatus === 'speaking' ? .4 + .3 * Math.abs(Math.sin(performance.now() / 160)) : 0;
    const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b);
    let s = 0; for (const v of b) s += v * v; return Math.min(1, Math.sqrt(s / b.length) * 6);
  }
  function drawOrb(cx, cy, r, t) {
    const lv = aiVoiceLevel(), st = S.aiStatus;
    const pulse = st === 'thinking' ? .08 * Math.sin(t / 140) : st === 'listening' ? .06 * Math.sin(t / 260) : lv * .25;
    const rr2 = r * (1 + pulse);
    const glow = g.createRadialGradient(cx, cy, rr2 * .4, cx, cy, rr2 * 2.2);
    glow.addColorStop(0, hexA(S.state.brand.color, .45)); glow.addColorStop(1, hexA(S.state.brand.color, 0));
    g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, rr2 * 2.2, 0, Math.PI * 2); g.fill();
    const a = t / 900;
    const og = g.createLinearGradient(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2, cx - Math.cos(a) * rr2, cy - Math.sin(a) * rr2);
    og.addColorStop(0, mixHex(accentOf(), '#ffffff', 0.35)); og.addColorStop(.5, accentOf()); og.addColorStop(1, mixHex(accentOf(), '#000000', 0.35));
    g.fillStyle = og; g.beginPath(); g.arc(cx, cy, rr2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, rr2, 0, Math.PI * 2); g.stroke();
  }

  // ---------------------------------------------------------------- one speech recogniser for captions and the AI
  const speechHub = { rec: null, lang: '', ptt: false, armed: 0, target: '#cmdInput' };
  function speechWanted() {
    const c = S.state.captions || {};
    const caps = !!(S.studio && c.on && S.local.micOn && S.local.audio);
    const ai = !!S.studio && isHost() && (S.aiWake || speechHub.ptt); // never listen outside a studio
    return { caps, ai, any: caps || ai, lang: c.on ? (c.lang || 'en-US') : 'en-US' };
  }
  function syncCaptions() {
    const w = speechWanted();
    cap.want = w.caps;
    if (!w.any) { stopSpeech(); return; }
    if (speechHub.rec && speechHub.lang === w.lang) return;
    stopSpeech(); startSpeech(w.lang);
  }
  function startSpeech(lang) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { if (!cap.warned && cap.want) { cap.warned = true; toast('Your browser can’t transcribe speech, so your captions won’t show. Chrome and Edge can.'); } return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = lang; speechHub.lang = lang;
    r.onresult = (e) => {
      let interim = '', fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else interim += t; }
      const text = (fin || interim).trim();
      if (!text) return;
      if (cap.want) { showCaption(S.id, S.name || 'You', text, !!fin); sendCaption(text, !!fin); }
      if (speechHub.ptt) {
        const box = $(speechHub.target || '#cmdInput');
        box.value = text;
        if (fin) { speechHub.ptt = false; box.value = ''; autoGrow(box); syncCaptions(); setAiStatus('idle'); askProducer(fin.trim()); }
        return;
      }
      if (S.aiWake && fin) {
        const name = S.aiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = fin.trim().match(new RegExp(`^(?:hey|ok|okay|yo)?[\\s,]*${name}[\\s,.!?]*(.*)$`, 'i'));
        if (m) { if (m[1].trim()) askProducer(m[1].trim()); else { speechHub.armed = Date.now() + 7000; setAiStatus('listening'); } }
        else if (speechHub.armed > Date.now()) { speechHub.armed = 0; askProducer(fin.trim()); }
      }
    };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { cap.want = false; speechHub.ptt = false; toast('Speech recognition needs microphone permission.', { err: true }); } };
    r.onend = () => { if (speechHub.rec === r && speechWanted().any) setTimeout(() => { try { r.start(); } catch {} }, 250); };
    speechHub.rec = r;
    try { r.start(); } catch {}
  }
  function stopSpeech() { const r = speechHub.rec; speechHub.rec = null; try { r?.stop(); } catch {} }

  libLoad();
  renderOffBg();

  return { renderProducerUI, renderVoiceNames, setCmd, offerOpen, askProducer, askStageVision, drawOrb, speechHub, syncCaptions };
}
