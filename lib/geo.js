// US-only geographic gate. Evaluates CDN / platform country headers when present
// (e.g. x-vercel-ip-country, cf-ipcountry, x-appengine-country, cloudfront-viewer-country).
// Local dev requests without proxy country headers pass through so localhost stays usable.

const COUNTRY_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'x-appengine-country',
  'cloudfront-viewer-country',
  'x-country-code',
  'x-nf-country',
];
const UNKNOWN_CODES = new Set(['', 'ZZ', 'XX', 'T1', 'UNK', 'UNKNOWN']);

function countryOf(req) {
  const h = req?.headers || {};
  for (const name of COUNTRY_HEADERS) {
    const raw = String(h[name] || '').trim().toUpperCase();
    if (raw && !UNKNOWN_CODES.has(raw) && /^[A-Z]{2}$/.test(raw)) return raw;
  }
  return '';
}

function isUsAllowed(req) {
  const code = countryOf(req);
  if (!code) return true;
  const allow = String(process.env.GATHER_ALLOW_COUNTRY || 'US')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return allow.includes(code);
}

const BLOCK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>gather — United States Only</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
      background: #060913; color: #f3f6ff;
      font-family: -apple-system, BlinkMacSystemFont, "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
    }
    .card {
      max-width: 460px; width: 100%; padding: 32px; border-radius: 16px;
      background: rgba(12, 19, 40, 0.82);
      border: 1px solid rgba(148, 175, 255, 0.2);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
      text-align: center;
    }
    .mark { font-weight: 700; font-size: 22px; letter-spacing: -0.02em; margin-bottom: 14px; }
    .mark i { color: #3b82f6; font-style: normal; }
    h1 { margin: 0 0 10px; font-size: 22px; letter-spacing: -0.02em; }
    p { margin: 0; font-size: 14px; line-height: 1.6; color: #9db0d6; }
    .tx {
      margin-top: 22px; display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px; border-radius: 8px; font-size: 12px; color: #b7c6e6;
      background: rgba(59, 130, 246, 0.14); border: 1px solid rgba(59, 130, 246, 0.34);
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="mark">gather<i>.</i></div>
    <h1>Available in the United States only</h1>
    <p>gather operates strictly within the United States. Access from outside the United States is unavailable.</p>
    <div class="tx">
      <svg width="16" height="16" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M12.2 3.2h4.2v4.1l3.7 1.3 4.6-.4 1.2 4.3-2.3 3.7-2.6 4.7-.7 3.7-3.4-1.5-4.1-4.8-3.8-.5-3.2-3.4-2.8-1.4.4-2.7 3.4.3V3.2h5.4Z" fill="#3b82f6" fill-opacity="0.24" stroke="#60a5fa" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M14.2 10.1l.8 2.2h2.3l-1.8 1.3.7 2.2-2-1.4-2 1.4.7-2.2-1.8-1.3h2.3z" fill="#f3f6ff"/>
      </svg>
      <span>Made in Texas · US Only</span>
    </div>
  </main>
</body>
</html>`;

function enforceUsGeo(req, res, opts = {}) {
  if (isUsAllowed(req)) return true;
  const urlStr = String(req?.url || '');
  const isApi = !!opts.api || urlStr.startsWith('/api/') || String(req?.headers?.accept || '').includes('application/json');
  res.statusCode = 451;
  res.setHeader('Cache-Control', 'no-store');
  if (isApi) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'gather operates in the United States only.', code: 'US_ONLY' }));
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(BLOCK_HTML);
  }
  return false;
}

module.exports = { countryOf, isUsAllowed, enforceUsGeo };
