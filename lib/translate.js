// Live translation for captions and watch chat. Uses the house Gemini key when one is configured;
// without one, or on any failure, it returns the original texts so the page keeps working.
// Shared by server.js (local / self-hosted) and api/translate.js (Vercel).
const CACHE = new Map();
const CACHE_MAX = 600;

// The house key is the owner's money: cap how many uncached translations one address can ask for per minute.
const PER_MINUTE = Number(process.env.TRANSLATE_PER_MINUTE) || 30;
const hits = new Map();
function allow(ip) {
  const now = Date.now();
  const key = String(ip || 'anon');
  const h = hits.get(key);
  if (!h || now - h.t > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(key, { t: now, n: 1 });
    return true;
  }
  h.n += 1;
  return h.n <= PER_MINUTE;
}

function houseKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || (process.env.HOUSE_AI_PROVIDER === 'gemini' ? process.env.HOUSE_AI_KEY || '' : '')).trim();
}

async function translate(body, { ip } = {}) {
  const texts = (Array.isArray(body?.texts) ? body.texts : [body?.text]).map((t) => String(t || '').trim().slice(0, 320)).filter(Boolean).slice(0, 12);
  const lang = String(body?.lang || '').replace(/[^a-zA-Z-]/g, '').slice(0, 16);
  if (!texts.length || !lang || lang === 'orig') return { translations: texts };
  const out = new Array(texts.length);
  const todo = [];
  texts.forEach((t, i) => {
    const ck = `${lang}:${t}`;
    if (CACHE.has(ck)) out[i] = CACHE.get(ck);
    else todo.push({ i, t, ck });
  });
  if (!todo.length) return { translations: out };
  const key = houseKey();
  const fallback = (extra) => { todo.forEach(({ i, t }) => { out[i] = t; }); return { translations: out, ...extra }; };
  if (!key) return fallback({ offline: true });
  if (!allow(ip)) return fallback({ limited: true });
  try {
    const model = String(process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash').trim();
    const prompt = `Translate each JSON string in the array into language "${lang}". Preserve names, emojis, and tone. Return ONLY a JSON array of strings of the exact same length.\n${JSON.stringify(todo.map((x) => x.t))}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) {
      const j = await r.json();
      const raw = (j?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length === todo.length) {
        todo.forEach(({ i, t, ck }, idx) => {
          const tr = String(arr[idx] || t).slice(0, 400);
          out[i] = tr;
          if (CACHE.size > CACHE_MAX) CACHE.clear();
          CACHE.set(ck, tr);
        });
        return { translations: out };
      }
    }
  } catch {}
  return fallback();
}

module.exports = { translate };
