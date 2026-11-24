// gather — the studio assistant: answers questions and runs the studio, plus AI thumbnails and the stream voice.
// Uses the provider the host chose, with the host's own API key.
// Keys arrive with each request and are never stored or logged here.
const Anthropic = require('@anthropic-ai/sdk');
const { store } = require('./store');

const PROVIDERS = {
  claude: { label: 'Claude', model: 'claude-opus-5-5' },
  openai: { label: 'ChatGPT', model: 'gpt-5.5' },
  gemini: { label: 'Gemini', model: '' }, // newest Flash, found at run time (see geminiLatest)
  grok: { label: 'Grok', model: 'grok-4.7' },
};

class AIError extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---- house allowance: the assistant works for hosts without their own key ---------------------------------------
// The site owner can set HOUSE_AI_PROVIDER (claude, openai, gemini or grok) + HOUSE_AI_KEY. Each studio then gets
// HOUSE_AI_DAILY assistant requests a day (default 25), and each network address three studios' worth, so a stray
// script can't run up the owner's bill. Hosts with their own key never touch it.
const HOUSE = { provider: String(process.env.HOUSE_AI_PROVIDER || '').trim().toLowerCase(), key: process.env.HOUSE_AI_KEY, model: process.env.HOUSE_AI_MODEL || '', daily: Math.max(1, Number(process.env.HOUSE_AI_DAILY) || 25) };
// No house key set, but the host gives the server a Gemini key (Google AI Studio does, as GEMINI_API_KEY): Sam uses it,
// within the same daily allowance. HOUSE_AI_PROVIDER=off keeps Sam to hosts' own keys.
if (!HOUSE.key && !HOUSE.provider && String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()) {
  Object.assign(HOUSE, { provider: 'gemini', key: String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY).trim() });
}
function houseInfo() { return HOUSE.key && PROVIDERS[HOUSE.provider] ? { provider: HOUSE.provider, daily: HOUSE.daily } : null; }
// Built-in Google images: Google AI Studio gives apps a server-side GEMINI_API_KEY (or the house key is a Gemini one),
// so hosts can make covers, logos and overlays with no key of their own. HOUSE_IMAGE_DAILY images per visitor a day.
const IMG_HOUSE = {
  key: String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || (HOUSE.provider === 'gemini' ? HOUSE.key || '' : '')).trim(),
  daily: Math.max(1, Number(process.env.HOUSE_IMAGE_DAILY) || 12),
};
function houseImages() { return IMG_HOUSE.key ? { provider: 'gemini', daily: IMG_HOUSE.daily } : null; }
// The house voice: a natural voice every host gets without a key of their own. ElevenLabs (most human) when
// ELEVENLABS_API_KEY is set, else OpenAI with OPENAI_API_KEY (or the house AI key when the house provider is OpenAI).
const VOICE = {
  eleven: String(process.env.ELEVENLABS_API_KEY || '').trim(),
  openai: String(process.env.OPENAI_API_KEY || (HOUSE.provider === 'openai' ? HOUSE.key || '' : '')).trim(),
  daily: Math.max(1, Number(process.env.HOUSE_VOICE_DAILY) || 80),
};
function houseVoice() { return VOICE.eleven ? { provider: 'elevenlabs', daily: VOICE.daily } : VOICE.openai ? { provider: 'openai', daily: VOICE.daily } : null; }
// The caller's address as the platform saw it. A client-sent X-Forwarded-For is only trusted on Vercel, which sets it.
function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-vercel-forwarded-for'] || h['x-real-ip'] || (process.env.VERCEL ? String(h['x-forwarded-for'] || '').split(',')[0] : '') || req.socket?.remoteAddress || 'unknown').trim();
}
/** Count one house request; returns how many the studio has left today, or throws 429. */
async function spendHouse(req, studio, id, tok, kind = 'house', limit = HOUSE.daily) {
  const day = new Date().toISOString().slice(0, 10);
  const code = String(studio || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  if (!code) throw new AIError(400, 'Enter a studio to use the free AI allowance.');
  // Only the host of a studio that exists right now spends the allowance, so made-up studio codes can't drain it.
  const [raw, host] = await store.pipe([['HGET', `g:${code}:m`, String(id || '')], ['GET', `g:${code}:host`]]);
  let me = null; try { me = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch {}
  if (!me || !tok || me.tok !== tok || host !== me.id) throw new AIError(403, 'The free AI allowance is for the host of an open studio.');
  const ks = `ai:${kind}:s:${code}:${day}`, ki = `ai:${kind}:ip:${clientIp(req)}:${day}`;
  const [ns, , ni] = await store.pipe([['INCR', ks], ['EXPIRE', ks, 90000], ['INCR', ki], ['EXPIRE', ki, 90000]]);
  if (Number(ns) > limit || Number(ni) > limit * 3) throw new AIError(429, kind === 'voice' ? `That’s today’s free voice allowance used up (${limit} replies). Add an OpenAI key in the AI settings to keep the voice, or come back tomorrow.` : `That’s today’s free AI allowance used up (${limit} requests). Add your own key in the AI settings to keep going, or come back tomorrow.`);
  return limit - Number(ns);
}

function cleanMessages(list) {
  // Only plain text turns from the page; alternate roles, start with the user, max 30 turns.
  const out = [];
  for (const m of (Array.isArray(list) ? list : []).slice(-30)) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const text = String(m?.text ?? '').slice(0, 8000);
    if (!text.trim()) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].text += '\n\n' + text;
    else out.push({ role, text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') throw new AIError(400, 'Ask a question first.');
  return out;
}

// ---- Gemini models: Google retires them (gemini-2.5-flash went "no longer available to new users"), so nothing is
// hard-coded. With no model chosen, ask the key's model list for the newest Flash (text) or newest image-capable model;
// if Google says a model is retired or unknown, refresh the list and retry once. GEMINI_TEXT_MODEL / GEMINI_IMAGE_MODEL pin one.
const GEMINI_PIN = { text: String(process.env.GEMINI_TEXT_MODEL || '').trim(), image: String(process.env.GEMINI_IMAGE_MODEL || '').trim() };
const GEMINI_SEEN = { text: '', image: '' };
const GEMINI_FALLBACK = { text: 'gemini-3.8-flash', image: 'gemini-3.8-flash-image' };
const geminiVer = (n) => Number((String(n).match(/gemini-(\d+(?:\.\d+)?)/) || [0, '0'])[1]);
async function geminiLatest(apiKey, kind, refresh = false) {
  if (GEMINI_PIN[kind]) return GEMINI_PIN[kind];
  if (GEMINI_SEEN[kind] && !refresh) return GEMINI_SEEN[kind];
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(8000) });
    const names = r.ok ? ((await r.json())?.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name || '').replace(/^models\//, '')) : [];
    const newest = (keep, drop) => names.filter((n) => keep.test(n) && !drop.test(n)).sort((a, b) => geminiVer(b) - geminiVer(a) || a.length - b.length)[0];
    const text = newest(/^gemini-[\d.]+-flash$/, /^$/) || newest(/^gemini-[\d.]+-flash/, /image|lite|tts|audio|live|embed|exp|preview/) || newest(/^gemini-[\d.]+-flash/, /image|tts|audio|live|embed/);
    const image = newest(/^gemini-[\d.]+-flash.*image/, /tts|audio|live/) || newest(/^gemini-.*image/, /tts|audio|live/);
    if (text) GEMINI_SEEN.text = text;
    if (image) GEMINI_SEEN.image = image;
  } catch {}
  return GEMINI_SEEN[kind] || GEMINI_FALLBACK[kind];
}
const geminiRetired = (status, msg) => status === 404 || /no longer available|not found|not recogni[sz]e|is not supported for generateContent|has been deprecated|unknown model/i.test(msg);
/** generateContent with the right model: the one asked for, else the newest; a retired one is swapped once. */
async function geminiGenerate(apiKey, model, kind, payload, timeout = 60_000) {
  let m = String(model || '').trim() || await geminiLatest(apiKey, kind);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout),
    });
    if (res.ok) return { json: await res.json(), model: m };
    const body = await res.text();
    if (attempt === 0 && geminiRetired(res.status, body)) {
      const next = await geminiLatest(apiKey, kind, true);
      if (next && next !== m) { m = next; continue; }
    }
    throw await providerError(new Response(body, { status: res.status }), 'Gemini', m);
  }
}

async function providerError(res, label, model) {
  let detail = '';
  try { const j = await res.json(); detail = j?.error?.message || j?.message || ''; } catch {}
  if (res.status === 401 || res.status === 403) return new AIError(401, `${label} rejected the API key. Check it in the AI panel.`);
  if (res.status === 404) return new AIError(400, `${label} does not recognise the model "${model}". ${detail}`.trim());
  if (res.status === 429) return new AIError(429, `${label} is rate limiting this key, or the account is out of credit. ${detail}`.trim());
  return new AIError(502, `${label} error ${res.status}. ${detail}`.trim());
}

// ---- images (thumbnails, logos, overlays) ---------------------------------------------------------
const IMAGE_MODELS = { openai: 'gpt-image-1', grok: 'grok-2-image', gemini: '' }; // Gemini: newest image model, found at run time
const REF_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
async function generateImage({ provider, apiKey, prompt, model, purpose = 'thumb', aspectRatio, ref, refs }) {
  prompt = String(prompt || '').trim().slice(0, 1500);
  if (!prompt) throw new AIError(400, 'Describe the visual you want.');
  if (!apiKey || String(apiKey).length < 10) throw new AIError(400, 'Add your own API key first. Studio kit generation uses your personal key.');
  if (provider === 'claude') throw new AIError(400, 'Claude doesn’t make images. Pick ChatGPT, Gemini or Grok for AI visuals.');
  const kind = ['thumb', 'logo', 'overlay', 'backdrop'].includes(purpose) ? purpose : 'thumb';
  const ar = aspectRatio === '1:1' || kind === 'logo' ? '1:1' : '16:9';
  const styleHint = kind === 'logo'
    ? 'Clean modern broadcast channel logo mark, one centered symbol on a plain dark background, flat vector style, crisp edges, no words, no random letters, no watermark.'
    : kind === 'overlay'
      ? 'A decorative frame for a live video: all the detail sits in a band around the outer edges and corners, and the whole middle is plain flat black (it will be cut out for the video). No text, no watermark.'
      : kind === 'backdrop'
        ? 'Wide 16:9 studio backdrop behind live cameras: atmospheric depth, soft lighting, nothing busy in the middle where people appear, no text, no letters, no watermark.'
        : 'Wide 16:9 broadcast cover background, editorial lighting, high contrast, rich depth, leave calm space on the left for a headline, no text, no letters, no watermark.';
  // Reference pictures (your photo, logo, screenshots or design mock-ups): up to 3, each under ~1.2 MB as a data URL.
  const refImgs = [...(Array.isArray(refs) ? refs : []), ...(ref ? [ref] : [])].slice(0, 3).map((x) => (typeof x === 'string' && x.length < 1_600_000 ? x.match(REF_RE) : null)).filter(Boolean);
  const full = `${prompt}. ${styleHint}${refImgs.length ? ` Use the ${refImgs.length > 1 ? `${refImgs.length} attached images` : 'attached image'} as the reference for layout, subject, colours and style; follow the design they show.` : ''}`;
  const useModel = String(model || IMAGE_MODELS[provider] || '').slice(0, 80);
  let res, b64;
  if (provider === 'openai' || provider === 'grok') {
    const base = provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    const body = provider === 'openai'
      ? { model: useModel, prompt: full, size: ar === '1:1' ? '1024x1024' : '1536x1024', n: 1 }
      : { model: useModel, prompt: full, n: 1, response_format: 'b64_json' };
    res = await fetch(base + '/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw await providerError(res, provider === 'grok' ? 'Grok' : 'ChatGPT', useModel);
    const j = await res.json();
    b64 = j?.data?.[0]?.b64_json;
    if (!b64 && j?.data?.[0]?.url) { const img = await fetch(j.data[0].url); b64 = Buffer.from(await img.arrayBuffer()).toString('base64'); }
  } else if (provider === 'gemini' && /^imagen/.test(useModel)) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(useModel)}:predict`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt: full }], parameters: { sampleCount: 1, aspectRatio: ar } }),
    });
    if (!res.ok) throw await providerError(res, 'Gemini', useModel);
    b64 = (await res.json())?.predictions?.[0]?.bytesBase64Encoded;
  } else if (provider === 'gemini') {
    // Gemini's own image model: text in, image out, optionally steered by a reference picture (your photo or logo).
    const parts = [{ text: full }, ...refImgs.map((m) => ({ inlineData: { mimeType: m[1], data: m[2] } }))];
    const { json } = await geminiGenerate(apiKey, useModel, 'image', { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ar } } }, 90_000);
    const out = (json?.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data || x.inline_data?.data);
    const inl = out?.inlineData || out?.inline_data;
    if (inl?.data) return { data: `data:${inl.mimeType || inl.mime_type || 'image/png'};base64,${inl.data}`, purpose: kind };
  } else throw new AIError(400, 'Choose ChatGPT, Gemini or Grok for images.');
  if (!b64) throw new AIError(502, 'The image service returned no image. Try a different description.');
  return { data: 'data:image/png;base64,' + b64, purpose: kind };
}

// ---- BYO-key full stream kit & copy designer ---------------------------------------------------
function cleanKit(raw, streamType, topic) {
  const o = typeof raw === 'string' ? (() => { const i = raw.indexOf('{'), j = raw.lastIndexOf('}'); return i >= 0 && j > i ? JSON.parse(raw.slice(i, j + 1)) : {}; })() : (raw || {});
  const tags = (Array.isArray(o.hashtags) ? o.hashtags : String(o.hashtags || '').split(/[\s,]+/))
    .map((t) => String(t || '').trim().replace(/^#+/, '').replace(/[^a-zA-Z0-9_]/g, ''))
    .filter(Boolean).slice(0, 6).map((t) => '#' + t);
  const accent = /^#[0-9a-f]{6}$/i.test(String(o.accentColor || '')) ? String(o.accentColor) : (streamType === 'shopping' ? '#f59e0b' : streamType === 'gamer' ? '#10b981' : '#e11d48');
  return {
    title: String(o.title || topic || 'Live Broadcast').trim().slice(0, 100),
    description: String(o.description || '').trim().slice(0, 900),
    hashtags: tags,
    headline: String(o.headline || o.title || '').trim().slice(0, 60),
    accentColor: accent,
    thumbPrompt: String(o.thumbPrompt || `${topic || 'live show'} cinematic editorial studio lighting`).trim().slice(0, 400),
    logoPrompt: String(o.logoPrompt || `minimal geometric emblem for ${topic || 'live show'}`).trim().slice(0, 300),
    overlayPrompt: String(o.overlayPrompt || `sleek dark studio frame border with ${accent} edge light`).trim().slice(0, 300),
  };
}

async function generateStreamKit({ provider, apiKey, model, streamType = 'live', topic = '', notes = '', brandName = '' }) {
  const p = PROVIDERS[provider];
  if (!p) throw new AIError(400, 'Choose Claude, ChatGPT, Gemini or Grok.');
  if (!apiKey || String(apiKey).length < 10) throw new AIError(400, `Add your own ${p.label} API key to generate copy, hashtags & stream kit.`);
  const kind = ['live', 'shopping', 'gamer'].includes(streamType) ? streamType : 'live';
  const kindGuide = kind === 'shopping'
    ? 'This is a LIVE SHOPPING stream (product drops, flash deals, interactive viewer Q&A, conversion-oriented clarity).'
    : kind === 'gamer'
      ? 'This is a GAMER stream (high-energy co-play queue, predictions, fast commentary, clutch highlights).'
      : 'This is a flagship LIVE BROADCAST / talk show (interviews, panel dialogue, live audience Q&A).';
  const sys = [
    'You are an Emmy-caliber broadcast showrunner and brand designer creating a launch kit for a live creator show.',
    kindGuide,
    'Return ONLY ONE valid JSON object with exact keys:',
    '{ "title": string (<=85 chars), "description": string (2-3 crisp sentences <=360 chars), "hashtags": string[] (5 relevant "#Tag" strings), "headline": string (3-5 punchy cover words <=45 chars), "accentColor": string (vibrant legible hex "#RRGGBB"), "thumbPrompt": string (vivid 16:9 image art prompt, no text), "logoPrompt": string (minimal geometric icon emblem prompt, no text), "overlayPrompt": string (sleek dark broadcast frame edge artwork prompt, no text) }',
  ].join('\n');
  const userMsg = `Show topic/seed: ${String(topic || 'Live session').slice(0, 240)}\nCreator/brand: ${String(brandName || 'Host').slice(0, 60)}\nNotes: ${String(notes || 'None').slice(0, 400)}`;
  const useModel = String(model || p.model).trim().slice(0, 80);
  let text = '';
  if (provider === 'claude') {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
    try {
      const m = await client.messages.create({ model: useModel, max_tokens: 900, system: sys, messages: [{ role: 'user', content: userMsg }] });
      text = (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AIError(401, 'Claude rejected the API key.');
      if (e instanceof Anthropic.RateLimitError) throw new AIError(429, 'Claude is rate limiting this key.');
      throw new AIError(e.status || 502, e.message || 'Claude kit request failed.');
    }
  } else if (provider === 'gemini') {
    const { json } = await geminiGenerate(apiKey, useModel, 'text', { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: userMsg }] }], generationConfig: { responseMimeType: 'application/json' } });
    text = (json?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  } else {
    const base = provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    const res = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: userMsg }] }),
    });
    if (!res.ok) throw await providerError(res, p.label, useModel);
    text = (await res.json())?.choices?.[0]?.message?.content || '';
  }
  try { return { kit: cleanKit(text, kind, topic) }; }
  catch { return { kit: cleanKit({}, kind, topic) }; }
}

// ---- the assistant: one conversation that answers questions and runs the studio --------------------------
// Streams newline-delimited JSON events: {t:'text',d} as the reply is written, {t:'action',a} for each studio
// action, then {t:'done'} (or {t:'error',message}). Claude gets real tools plus web search; ChatGPT, Gemini and
// Grok reply with one JSON object that is mapped onto the same events.
const ACTIONS = {
  open_page: { type: 'open', description: 'Pull up a web page or video for the host to put on screen. For YouTube use a direct https://www.youtube.com/watch?v=… link you found, otherwise a YouTube search link https://www.youtube.com/results?search_query=…', props: { url: { type: 'string', description: 'https URL you found or a YouTube search URL. Never invent one.' }, label: { type: 'string', description: 'Short title, a few words' } }, required: ['url'] },
  switch_scene: { type: 'scene', description: 'Switch the stage to one of the studio’s scenes.', props: { name: { type: 'string', description: 'Exact scene name from the list' } }, required: ['name'] },
  present_media: { type: 'present', description: 'Put a file from the media library on screen.', props: { name: { type: 'string', description: 'Exact library item name' } }, required: ['name'] },
  stop_presenting: { type: 'stop', description: 'Stop whatever is being presented.', props: {}, required: [] },
  show_banner: { type: 'banner', description: 'Show a lower-third headline banner.', props: { text: { type: 'string', description: 'Headline, under 60 characters' }, sub: { type: 'string', description: 'Optional second line' } }, required: ['text'] },
  hide_banner: { type: 'hide_banner', description: 'Hide the banner.', props: {}, required: [] },
  start_countdown: { type: 'countdown', description: 'Start an on-stage countdown.', props: { minutes: { type: 'number', description: '1 to 120' } }, required: ['minutes'] },
  update_spotlight: { type: 'spotlight', description: 'Publish an AI-controlled Watch Party showcase card below the video with recap headline, key points, and an optional verified link.', props: { headline: { type: 'string', description: 'Headline under 80 characters' }, bullets: { type: 'array', items: { type: 'string' }, description: '2 to 4 concise key points' }, url: { type: 'string', description: 'Optional https:// link' }, label: { type: 'string', description: 'Optional link label' } }, required: ['headline'] },
};
/** Check a model-supplied action against its schema; returns the studio action or null. */
function cleanAction(type, input) {
  const a = { type };
  const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  if (type === 'open') { const url = str(input?.url, 600); if (!url || !/^https:\/\//i.test(url)) return null; a.url = url; a.label = str(input?.label, 80) || ''; }
  else if (type === 'scene' || type === 'present') { a.name = str(input?.name, 80); if (!a.name) return null; }
  else if (type === 'banner') { a.text = str(input?.text, 120); if (!a.text) return null; a.sub = str(input?.sub, 120) || ''; }
  else if (type === 'countdown') { const m = Number(input?.minutes); if (!(m >= 1 && m <= 120)) return null; a.minutes = Math.round(m); }
  else if (type === 'spotlight') {
    a.headline = str(input?.headline, 100);
    if (!a.headline) return null;
    a.bullets = (Array.isArray(input?.bullets) ? input.bullets : []).map((x) => str(x, 140)).filter(Boolean).slice(0, 5);
    const u = str(input?.url, 300);
    if (u && /^https:\/\//i.test(u)) a.links = [{ label: str(input?.label, 40) || u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url: u }];
  }
  else if (!['stop', 'hide_banner'].includes(type)) return null;
  return a;
}

function agentPrompt(ctx, json) {
  const name = String(ctx?.name || 'Sam').slice(0, 24);
  const scenes = (ctx?.scenes || []).slice(0, 40).map((x) => String(x).slice(0, 40));
  const library = (ctx?.library || []).slice(0, 40).map((x) => `${String(x?.name).slice(0, 50)} (${String(x?.kind).slice(0, 10)})`);
  const lines = [
    `You are ${name}, the producer and researcher for a live show in a browser studio called gather. The host talks or types to you during the show, like a producer in the booth.`,
    'Two kinds of request:',
    '- A question (facts, news, an explainer, a stat): answer it. Your reply is shown on screen to a live audience and its first sentence may be read aloud, so lead with the answer in one plain sentence, then at most a few short lines or bullets. Under about 90 words. No headings, tables or code. Name sources briefly in plain words ("per Reuters, March 2026"). If unsure, say so.',
    '- Something to do in the studio (switch scene, present a file, show a banner, a countdown, find a video or site): do it, then confirm in one short sentence.',
    'Look things up on the web whenever facts could have changed or the host asks you to find something. Never invent URLs.',
    `Scenes: ${scenes.length ? scenes.join(', ') : 'none listed'}.`,
    `Media library: ${library.length ? library.join(', ') : 'empty'}.`,
    `Right now: ${String(ctx?.now || '').slice(0, 300)}`,
  ];
  if (json) {
    lines.push('Reply with ONE JSON object and nothing else: {"reply": "your reply text", "actions": [ ... ]}. Actions (use only these):');
    for (const a of Object.values(ACTIONS)) lines.push(`{"type":"${a.type}"${Object.keys(a.props).map((k) => `,"${k}":…`).join('')}}: ${a.description}`);
  }
  return lines.join('\n');
}
function parseJsonReply(text) {
  const t = String(text || '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      const o = JSON.parse(t.slice(i, j + 1));
      const reply = String(o.reply ?? [o.say, o.show].filter(Boolean).join('\n\n')).slice(0, 4000);
      const actions = (Array.isArray(o.actions) ? o.actions : []).slice(0, 6).map((a) => cleanAction(String(a?.type || ''), a)).filter(Boolean);
      return { reply, actions };
    } catch {}
  }
  return { reply: t.slice(0, 4000), actions: [] };
}

async function agentStream({ provider, apiKey, model, messages, ctx }, emit) {
  const p = PROVIDERS[provider];
  if (!p) throw new AIError(400, 'Choose Claude, ChatGPT, Gemini or Grok in the AI panel.');
  if (!apiKey || String(apiKey).length < 10) throw new AIError(400, `Add your ${p.label} API key in the AI panel.`);
  const msgs = cleanMessages(messages);
  const useModel = String(model || p.model).trim().slice(0, 80);
  if (provider === 'claude') return agentClaude(apiKey, useModel, msgs, ctx, emit);
  const system = agentPrompt(ctx, true);
  let text = '';
  if (provider === 'gemini') {
    const { json } = await geminiGenerate(apiKey, useModel, 'text', { systemInstruction: { parts: [{ text: system }] }, contents: msgs.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), tools: [{ google_search: {} }] });
    text = (json?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  } else {
    const base = provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    const res = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: useModel, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, ...msgs.map((m) => ({ role: m.role, content: m.text }))] }),
    });
    if (!res.ok) throw await providerError(res, p.label, useModel);
    text = (await res.json())?.choices?.[0]?.message?.content || '';
  }
  const out = parseJsonReply(text);
  if (out.reply) emit({ t: 'text', d: out.reply });
  for (const a of out.actions) emit({ t: 'action', a });
}

async function agentClaude(apiKey, model, msgs, ctx, emit) {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 });
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
    ...Object.entries(ACTIONS).map(([name, a]) => ({ name, description: a.description, eager_input_streaming: true, input_schema: { type: 'object', properties: a.props, required: a.required } })),
  ];
  let messages = msgs.map((m) => ({ role: m.role, content: m.text }));
  let jsonRetries = 0, wrote = false;
  try {
    for (let turn = 0; turn < 6; turn++) {
      const stream = client.beta.messages.stream({
        model, max_tokens: 16000, system: agentPrompt(ctx, false),
        output_config: { effort: 'low' },
        tools, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        messages,
      });
      // Separate the text of successive turns (before and after a tool call) with a paragraph break.
      let first = true;
      stream.on('text', (t) => { if (first && wrote) emit({ t: 'text', d: '\n\n' }); first = false; wrote = true; emit({ t: 'text', d: t }); });
      let msg;
      try { msg = await stream.finalMessage(); jsonRetries = 0; }
      catch (e) { if (e instanceof Anthropic.APIError || jsonRetries++ >= 2) throw e; continue; } // unparseable tool input: re-issue the turn
      if (msg.stop_reason === 'refusal') { emit({ t: 'text', d: (wrote ? '\n\n' : '') + 'I can’t help with that one.' }); return; }
      if (msg.stop_reason === 'pause_turn') { messages = [...messages, { role: 'assistant', content: msg.content }]; continue; }
      const uses = msg.content.filter((b) => b.type === 'tool_use');
      if (!uses.length || msg.stop_reason !== 'tool_use') return; // end_turn, or max_tokens with no tool to run
      const results = uses.map((u) => {
        const def = ACTIONS[u.name];
        const a = def ? cleanAction(def.type, u.input) : null;
        if (a) emit({ t: 'action', a });
        return { type: 'tool_result', tool_use_id: u.id, content: a ? 'Done. It is happening in the studio now.' : 'That input was not valid; nothing happened.', is_error: !a };
      });
      messages = [...messages, { role: 'assistant', content: msg.content }, { role: 'user', content: results }];
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AIError(401, 'Claude rejected the API key. Check it in the AI panel.');
    if (e instanceof Anthropic.NotFoundError) throw new AIError(400, `Claude does not recognise the model "${model}".`);
    if (e instanceof Anthropic.RateLimitError) throw new AIError(429, 'Claude is rate limiting this key. Try again in a moment.');
    if (e instanceof Anthropic.APIError) throw new AIError(502, `Claude error ${e.status}: ${e.message}`);
    throw e;
  }
}

// ---- voice: OpenAI text-to-speech, so the producer is heard in the stream --------------------------------
// How the producer should sound: a co-host on a live show, not a phone menu.
const VOICE_STYLE = 'You are the co-host of a live stream. Sound warm, upbeat and genuinely human: relaxed and conversational, ' +
  'with natural rhythm, small pauses at commas and a smile in the voice. Speak at a lively but clear pace. Say amounts of money ' +
  'naturally (for example "$10" as "ten dollars"). Never sound robotic or like you are reading.';
// ElevenLabs' premade voices (the same IDs on every account), under the names the picker shows.
const ELEVEN_VOICES = { rachel: '21m00Tcm4TlvDq8ikWAM', sarah: 'EXAVITQu4vr4xnJGR5EM', adam: 'pNInz6obpgDQGcFmaJgB', josh: 'TxGEqnHWrfWFTfGW9XjX', antoni: 'ErXwobaYiN019PkySvjV', elli: 'MF3mGyEYCl7XYWbV9V6O' };
async function elevenSpeech(input, voice) {
  const id = ELEVEN_VOICES[voice] || ELEVEN_VOICES.rachel;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': VOICE.eleven, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: input, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
  });
  if (res.ok) return Buffer.from(await res.arrayBuffer());
  throw await providerError(res, 'ElevenLabs voice', 'eleven_turbo_v2_5');
}
async function speech({ apiKey, text, voice, house }, req) {
  const input = String(text || '').slice(0, 1500);
  if (!input.trim()) throw new AIError(400, 'Nothing to say.');
  if (house && (!apiKey || String(apiKey).length < 10)) {
    const hv = houseVoice();
    if (!hv) throw new AIError(400, 'Add a ChatGPT (OpenAI) key in the AI panel to give your producer a stream voice.');
    await spendHouse(req, house.studio, house.id, house.tok, 'voice', VOICE.daily);
    if (hv.provider === 'elevenlabs') return elevenSpeech(input, voice);
    apiKey = VOICE.openai;
  }
  if (!apiKey || String(apiKey).length < 10) throw new AIError(400, 'Add a ChatGPT (OpenAI) key in the AI panel to give your producer a stream voice.');
  const v = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'].includes(voice) ? voice : 'coral';
  for (const model of ['gpt-4o-mini-tts', 'tts-1']) {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(model === 'tts-1' ? { model, voice: ['ballad', 'verse', 'ash', 'coral', 'sage'].includes(v) ? 'nova' : v, input, response_format: 'mp3' } : { model, voice: v, input, instructions: VOICE_STYLE, response_format: 'mp3' }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 400 && res.status !== 404) throw await providerError(res, 'OpenAI voice', model);
  }
  throw new AIError(502, 'OpenAI couldn’t make speech for that.');
}

/** Shared HTTP handler for Vercel (api/ai.js) and server.js. */
async function handleAI(req, res, body) {
  if (body?.mode === 'agent' || body?.mode === 'tts') {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (body.mode === 'agent') {
        if (body.house) {
          if (!houseInfo()) throw new AIError(400, 'Add your own API key in the AI settings.');
          res.setHeader('X-AI-Left', String(await spendHouse(req, body.studio, body.id, body.tok)));
          body = { ...body, provider: HOUSE.provider, apiKey: HOUSE.key, model: HOUSE.model };
        }
        // NDJSON stream. Errors before the first event get a real status; later ones arrive as an error event.
        let started = false;
        const emit = (ev) => { if (!started) { started = true; res.statusCode = 200; res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('X-Accel-Buffering', 'no'); } res.write(JSON.stringify(ev) + '\n'); };
        try { await agentStream(body, emit); emit({ t: 'done' }); res.end(); }
        catch (e) {
          if (!started) throw e;
          if (!(e instanceof AIError)) console.error('[gather ai agent]', e);
          emit({ t: 'error', message: e instanceof AIError ? e.message : 'The AI request failed. Try again.' }); res.end();
        }
        return;
      }
      const buf = await speech(body, req); res.statusCode = 200; res.setHeader('Content-Type', 'audio/mpeg'); res.end(buf);
    } catch (e) {
      res.statusCode = e.status || 500; res.setHeader('Content-Type', 'application/json');
      if (!(e instanceof AIError)) console.error('[gather ai ' + body.mode + ']', e);
      res.end(JSON.stringify({ error: e instanceof AIError ? e.message : 'The AI request failed. Try again.' }));
    }
    return;
  }
  if (body?.mode === 'stt') { // a voice question, transcribed with the host's own OpenAI key
    res.setHeader('Cache-Control', 'no-store');
    try {
      const key = String(body.apiKey || '');
      if (key.length < 10) throw new AIError(400, 'Add a ChatGPT (OpenAI) key in the AI panel for AI transcripts.');
      const m = String(body.data || '').match(/^data:(audio\/[a-z0-9.+-]+)[^,]*;base64,([A-Za-z0-9+/=]+)$/i);
      if (!m || m[2].length > 600_000) throw new AIError(400, 'That recording can’t be transcribed.');
      const form = new FormData();
      form.append('file', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'question.' + (/mp4/.test(m[1]) ? 'm4a' : /ogg/.test(m[1]) ? 'ogg' : 'webm'));
      form.append('model', 'gpt-4o-mini-transcribe');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw await providerError(r, 'OpenAI transcription', 'gpt-4o-mini-transcribe');
      const j = await r.json();
      res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: String(j.text || '').slice(0, 2000) }));
    } catch (e) {
      res.statusCode = e.status || 500; res.setHeader('Content-Type', 'application/json');
      if (!(e instanceof AIError)) console.error('[gather ai stt]', e);
      res.end(JSON.stringify({ error: e instanceof AIError ? e.message : 'Transcription failed. Try again.' }));
    }
    return;
  }
  if (body?.mode === 'kit') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    try {
      let args = body;
      // No key of your own: the built-in Google key writes the copy too (counted with the images).
      if (!body.apiKey && IMG_HOUSE.key) {
        const day = new Date().toISOString().slice(0, 10), k = `ai:img:ip:${clientIp(req)}:${day}`;
        const [n] = await store.pipe([['INCR', k], ['EXPIRE', k, 90000]]);
        if (Number(n) > IMG_HOUSE.daily * 2) throw new AIError(429, 'That’s today’s free AI allowance. Add your own Gemini key (free at aistudio.google.com) to keep going.');
        args = { ...body, provider: 'gemini', apiKey: IMG_HOUSE.key, model: '' };
      }
      const out = await generateStreamKit(args); res.statusCode = 200; res.end(JSON.stringify(out)); }
    catch (e) { res.statusCode = e.status || 500; if (!(e instanceof AIError)) console.error('[gather ai kit]', e); res.end(JSON.stringify({ error: e instanceof AIError ? e.message : 'The stream kit request failed. Try again.' })); }
    return;
  }
  if (body?.mode === 'image') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    try {
      let args = body;
      if (!body.apiKey && IMG_HOUSE.key && (!body.provider || body.provider === 'gemini')) {
        const day = new Date().toISOString().slice(0, 10), k = `ai:img:ip:${clientIp(req)}:${day}`;
        const [n] = await store.pipe([['INCR', k], ['EXPIRE', k, 90000]]);
        if (Number(n) > IMG_HOUSE.daily) throw new AIError(429, `That’s today’s ${IMG_HOUSE.daily} free images. Add your own Gemini key (free at aistudio.google.com) to keep going.`);
        args = { ...body, provider: 'gemini', apiKey: IMG_HOUSE.key, model: '' };
      }
      const out = await generateImage(args); res.statusCode = 200; res.end(JSON.stringify(out));
    }
    catch (e) { res.statusCode = e.status || 500; if (!(e instanceof AIError)) console.error('[gather ai image]', e); res.end(JSON.stringify({ error: e instanceof AIError ? e.message : 'The image request failed. Try again.' })); }
    return;
  }
  res.statusCode = 400; res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Unknown AI request.' }));
}

// ---- Sam on the watch page: answers viewers in the public chat with the site's house key -------------------------
// Answers only: Sam never runs anything for a viewer. Short, friendly, grounded in what the show has told it.
/** "@Sam recap", "what did I miss?", "catch me up": a viewer wants the last few minutes summed up. */
const isRecap = (q) => /\b(recap|catch (me )?up|what did i miss|what (have|did) i miss|what('?s| has) happened|sum(mary| it up| up)|summari[sz]e|tl;?dr)\b/i.test(String(q || ''));
function viewerPrompt(ctx) {
  const c = ctx || {};
  const list = (a, n, m) => (Array.isArray(a) ? a : []).slice(0, n).map((x) => String(x).slice(0, m)).filter(Boolean);
  const lines = [
    `You are ${String(c.name || 'Sam').slice(0, 24)}, the AI co-host in the chat of a live show called "${String(c.title || 'the show').slice(0, 100)}" hosted by ${String(c.host || 'the streamer').slice(0, 40)} on gather.`,
    'Viewers @mention you in the public chat. Everyone sees your answer, so be warm, quick and useful: one to three short sentences, no lists unless asked, no markdown headings.',
    'You can: answer questions about the show using the facts below; sum up what has happened recently; explain how the watch page works; suggest what to say or ask; translate; answer general questions briefly.',
    'How the watch page works: the green $ in the chat box sends a paid super chat (card, Apple Pay or Google Pay, right on the page); the hand button lets you ask to join on camera or by voice, or leave a voice message; the heart sends reactions; Catch-up gives a recap; Details shows the show info and links.',
    'You cannot run anything for viewers (no buying, joining, moderating or changing the show) and you never make up facts about the host. If you do not know, say so and suggest asking the host.',
    `About the show: ${String(c.about || 'not given').slice(0, 400)}`,
    `What's next: ${String(c.next || 'not posted').slice(0, 200)}`,
  ];
  const links = list(c.links, 6, 120); if (links.length) lines.push(`Links: ${links.join(' | ')}`);
  const notices = list(c.notices, 5, 140); if (notices.length) lines.push(`Notices: ${notices.join(' | ')}`);
  const shop = list(c.shop, 8, 80); if (shop.length) lines.push(`For sale on the show: ${shop.join(' | ')}`);
  if (c.poll) lines.push(`Live poll: ${String(c.poll).slice(0, 160)}`);
  const said = list(c.captions, c.recap ? 50 : 20, 200); if (said.length) lines.push(`${c.recap ? 'Said on the show in the last 10 minutes' : 'Recently said on the show'} (captions): ${said.join(' / ')}`);
  const chat = list(c.chat, c.recap ? 40 : 15, 160); if (chat.length) lines.push(`${c.recap ? 'Chat in the last 10 minutes' : 'Recent chat'}: ${chat.join(' / ')}`);
  if (c.recap) {
    lines.push('This viewer asked for a recap. In two to four short sentences, sum up the last 10 minutes from the captions and chat above: what was talked about, anything announced, any poll, super chat or big moment. Only use what is above.');
    lines.push(said.length || chat.length ? 'End with one line on what is happening right now.' : 'There is nothing recorded from the last 10 minutes: say so kindly, then say what the show is about and what is next.');
  }
  return lines.join('\n');
}
async function viewerAnswer({ question, ctx }) {
  const house = houseInfo();
  if (!house) throw new AIError(501, 'Sam isn’t switched on for this site yet.');
  const p = HOUSE.provider, key = HOUSE.key, model = String(HOUSE.model || PROVIDERS[p].model || '').trim();
  const system = viewerPrompt(ctx), q = String(question || '').slice(0, 500);
  const maxTokens = ctx?.recap ? 450 : 350;
  let text = '';
  if (p === 'claude') {
    const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 30_000 });
    const r = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: q }] });
    text = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  } else if (p === 'gemini') {
    const { json } = await geminiGenerate(key, model, 'text', { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: q }] }], generationConfig: { maxOutputTokens: maxTokens } }, 30_000);
    text = (json?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  } else {
    const base = p === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    const res = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: q }] }),
    });
    if (!res.ok) throw await providerError(res, PROVIDERS[p].label, model);
    text = (await res.json())?.choices?.[0]?.message?.content || '';
  }
  text = String(text).replace(/^#+\s*/gm, '').trim().slice(0, ctx?.recap ? 900 : 700);
  if (!text) throw new AIError(502, 'Sam didn’t have an answer. Try asking another way.');
  return text;
}

module.exports = { handleAI, agentStream, parseJsonReply, cleanAction, houseInfo, houseVoice, houseImages, viewerAnswer, isRecap, PROVIDERS };
