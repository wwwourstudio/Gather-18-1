// gather — local / self-hosted server. Serves public/ and the same /api/studio handler
// that runs on Vercel. Uses Upstash Redis if KV_REST_API_URL/TOKEN are set, else in-memory.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Load local .env / .env.local files if present (runtime env / Secrets panel values always take precedence).
for (const envName of ['.env.local', '.env']) {
  const envPath = path.join(__dirname, envName);
  try {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] !== undefined && process.env[key] !== '') continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      } else {
        val = val.replace(/\s+#.*$/, '').trim();
      }
      if (val) process.env[key] = val;
    }
  } catch {}
}

const { handle, useBuiltInRelay } = require('./lib/studio');
const { handleAI } = require('./lib/ai');
const { importBrandFromUrl } = require('./lib/brand-import');
const accountHandler = require('./api/account');
const { translate } = require('./lib/translate');
const { enforceUsGeo } = require('./lib/geo');
const { createGeminiLiveBridge, redactSecrets } = require('./lib/gemini');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const PUBLIC_DIST = path.join(PUBLIC, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.wasm']);
const STATIC_CACHE_MAX = 96;
const staticCache = new Map();

function getCachedStatic(filePath, stat) {
  const key = `${filePath}|${stat.size}|${Math.trunc(stat.mtimeMs)}`;
  let entry = staticCache.get(key);
  if (entry) {
    // Refresh LRU order
    staticCache.delete(key);
    staticCache.set(key, entry);
    return entry;
  }
  const raw = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  entry = {
    raw,
    br: null,
    gz: null,
    etag,
    contentType,
    compressible: COMPRESSIBLE_EXT.has(ext) && raw.length >= 1024,
  };
  staticCache.set(key, entry);
  if (staticCache.size > STATIC_CACHE_MAX) {
    const oldest = staticCache.keys().next().value;
    if (oldest) staticCache.delete(oldest);
  }
  return entry;
}

function resolveStaticFile(relPath) {
  const srcFile = path.normalize(path.join(PUBLIC, relPath));
  if (srcFile !== PUBLIC && !srcFile.startsWith(PUBLIC + path.sep)) return null;
  let srcStat;
  try {
    srcStat = fs.statSync(srcFile);
    if (!srcStat.isFile()) return null;
  } catch {
    return null;
  }
  const ext = path.extname(srcFile).toLowerCase();
  // Transparently serve esbuild-minified public/dist/<name> for top-level JS/CSS when up-to-date.
  if ((ext === '.js' || ext === '.css') && path.dirname(srcFile) === PUBLIC) {
    const distFile = path.join(PUBLIC_DIST, path.basename(srcFile));
    try {
      const distStat = fs.statSync(distFile);
      if (distStat.isFile() && distStat.mtimeMs >= srcStat.mtimeMs - 500) {
        return { file: distFile, stat: distStat };
      }
    } catch {}
  }
  return { file: srcFile, stat: srcStat };
}

function serveStaticFile(req, res, u, relPath) {
  const resolved = resolveStaticFile(relPath);
  if (!resolved) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  let entry;
  try {
    entry = getCachedStatic(resolved.file, resolved.stat);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const ext = path.extname(resolved.file).toLowerCase();
  const hasVersion = /^[A-Za-z0-9._-]{1,32}$/.test(u.searchParams.get('v') || '');
  const isVendor = relPath.startsWith('/vendor/');
  const cacheControl = (hasVersion || isVendor)
    ? 'public, max-age=31536000, immutable'
    : (ext === '.html' || ext === '.js' || ext === '.mjs' || ext === '.css')
      ? 'no-cache'
      : 'public, max-age=86400';

  const isStudioPath = u.pathname.startsWith('/s/') || u.pathname.startsWith('/c/');
  const permissionsPolicy = isStudioPath
    ? 'camera=(self), microphone=(self), display-capture=(self)'
    : 'camera=(), microphone=()';

  const baseHeaders = {
    'Content-Type': entry.contentType,
    'Cache-Control': cacheControl,
    ETag: entry.etag,
    Vary: 'Accept-Encoding',
    'Permissions-Policy': permissionsPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, baseHeaders);
    return res.end();
  }

  const ae = String(req.headers['accept-encoding'] || '');
  let body = entry.raw;
  if (entry.compressible) {
    if (/\bbr\b/i.test(ae)) {
      if (!entry.br) {
        entry.br = zlib.brotliCompressSync(entry.raw, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
        });
      }
      body = entry.br;
      baseHeaders['Content-Encoding'] = 'br';
    } else if (/\bgzip\b/i.test(ae)) {
      if (!entry.gz) {
        entry.gz = zlib.gzipSync(entry.raw, { level: 6 });
      }
      body = entry.gz;
      baseHeaders['Content-Encoding'] = 'gzip';
    }
  }

  baseHeaders['Content-Length'] = body.length;
  res.writeHead(200, baseHeaders);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function json(res, status, obj) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req, res, limitBytes, onReady) {
  let raw = '';
  let tooLarge = false;
  req.on('data', (c) => {
    if (tooLarge) return;
    raw += c;
    if (raw.length > limitBytes) {
      tooLarge = true;
      json(res, 413, { error: 'Request payload too large.' });
      req.resume();
    }
  });
  req.on('end', () => {
    if (tooLarge || res.writableEnded) return;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch {}
    Promise.resolve(onReady(body)).catch((e) => {
      if (!e?.status) console.error(redactSecrets(e?.message || e));
      json(res, e?.status || 500, { error: redactSecrets(e?.status ? e.message : 'The server hit an unexpected error.') });
    });
  });
}

const ROBOTS_TXT = 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /s/\nDisallow: /c/\nDisallow: /controller\n';

const gatherServer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if ((u.pathname === '/health' || u.pathname === '/api/health') && (req.method === 'GET' || req.method === 'HEAD')) {
    return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), relay: !!builtInRelay });
  }
  if (!enforceUsGeo(req, res)) return;
  if (u.pathname === '/robots.txt' && (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(req.method === 'HEAD' ? undefined : ROBOTS_TXT);
  }
  if (u.pathname === '/api/brand-import' && req.method === 'POST') {
    return readJsonBody(req, res, 16 * 1024, async (body) => {
      try { json(res, 200, await importBrandFromUrl(body.url)); }
      catch (e) { json(res, 400, { error: e.message || 'Could not read that website.' }); }
    });
  }
  if (u.pathname === '/api/translate' && req.method === 'POST') {
    return readJsonBody(req, res, 32 * 1024, async (body) => {
      const out = await translate(body, { ip: accountHandler.ipOf(req) });
      json(res, 200, out);
    });
  }
  if (u.pathname === '/api/ai' && req.method === 'POST') {
    return readJsonBody(req, res, 3 * 1024 * 1024, (body) => handleAI(req, res, body));
  }
  if (u.pathname === '/api/account' && req.method === 'POST') {
    return readJsonBody(req, res, 2 * 1024 * 1024, (body) => {
      req.body = body;
      req.query = Object.fromEntries(u.searchParams);
      return accountHandler(req, res);
    });
  }
  if (u.pathname === '/api/studio') {
    return readJsonBody(req, res, 4 * 1024 * 1024, async (body) => {
      if (req.method === 'GET' && ['wfeed', 'wemote'].includes(u.searchParams.get('action'))) {
        body = { studio: u.searchParams.get('studio'), asset: u.searchParams.get('asset') };
      }
      try { json(res, 200, await handle(u.searchParams.get('action'), body)); }
      catch (e) {
        if (!e.status) console.error(redactSecrets(e?.message || e));
        json(res, e.status || 500, { error: redactSecrets(e.status ? e.message : `The studio server hit an error: ${e.message}`) });
      }
    });
  }
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (p === '/' || p.startsWith('/s/') || p.startsWith('/c/')) p = '/index.html';
  else if (p.startsWith('/w/')) p = '/watch.html';
  else if (p === '/controller' || p.startsWith('/controller/')) p = '/controller.html';
  else if (p === '/privacy' || p === '/terms') p += '.html';
  else if (p === '/favicon.ico') p = '/icon.png';
  serveStaticFile(req, res, u, p);
}).listen(PORT, '0.0.0.0', () => console.log(`gather studio → http://0.0.0.0:${PORT}`));
// One bad request must never drop every studio on a self-hosted server: log and keep serving.
process.on('uncaughtException', (e) => console.error('Uncaught error (server kept running):', redactSecrets(e?.message || e)));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection (server kept running):', redactSecrets(e?.message || e)));

function shutdown(sig) {
  console.log(`[server] ${sig} received, shutting down gracefully`);
  gatherServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const geminiLive = createGeminiLiveBridge();
let builtInRelay = null;

gatherServer.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/ws/gemini-live') {
    geminiLive.handleUpgrade(req, socket, head);
  } else if (p.startsWith('/relay/') && builtInRelay) {
    builtInRelay.handleUpgrade(req, socket, head, p.slice('/relay'.length));
  } else {
    socket.destroy();
  }
});

// ---------------------------------------------------------------- built-in go-live relay
// With no RELAY_URL, this server is the relay too: the studio's browser streams to wss://<this site>/relay/live and
// FFmpeg (the ffmpeg-static package, else the system's) sends it on to YouTube, Twitch, Kick… Set RELAY_URL to use a
// separate relay instead (Vercel can't run FFmpeg); GATHER_RELAY=off turns the built-in one off.
if (!process.env.RELAY_URL && !/^(0|off|false|no)$/i.test(String(process.env.GATHER_RELAY || ''))) {
  let ffmpegPath = process.env.FFMPEG_PATH || '';
  if (!ffmpegPath) { try { ffmpegPath = require('ffmpeg-static') || ''; } catch {} }
  if (!ffmpegPath) ffmpegPath = 'ffmpeg';
  const probe = require('child_process').spawn(ffmpegPath, ['-version'], { stdio: 'ignore' });
  probe.on('error', () => console.warn('[relay] FFmpeg not found: Go live stays off. Install ffmpeg-static or set RELAY_URL.'));
  probe.on('exit', (code) => {
    if (code !== 0) return console.warn('[relay] FFmpeg did not run: Go live stays off.');
    try {
      const { createRelay } = require('./relay/core');
      builtInRelay = createRelay({ secret: useBuiltInRelay(), max: Number(process.env.RELAY_MAX_STREAMS) || 3, transcode: process.env.RELAY_TRANSCODE || 'auto', ffmpeg: ffmpegPath });
      console.log('[relay] built in: Go live streams through this server (' + ffmpegPath + ')');
    } catch (e) { console.warn('[relay] could not start the built-in relay:', e.message); }
  });
}
