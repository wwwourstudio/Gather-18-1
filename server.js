// gather — local / self-hosted server. Serves public/ and the same /api/studio handler
// that runs on Vercel. Uses Upstash Redis if KV_REST_API_URL/TOKEN are set, else in-memory.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle, useBuiltInRelay } = require('./lib/studio');
const { handleAI } = require('./lib/ai');
const accountHandler = require('./api/account');
const { enforceUsGeo } = require('./lib/geo');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp' };

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const gatherServer = http.createServer((req, res) => {
  if (!enforceUsGeo(req, res)) return;
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/ai' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 3 * 1024 * 1024) req.destroy(); }); // room for up to 3 reference images
    req.on('end', () => { let body = {}; try { body = JSON.parse(raw || '{}'); } catch {} handleAI(req, res, body); });
    return;
  }
  if (u.pathname === '/api/account' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { req.body = JSON.parse(raw || '{}'); } catch { req.body = {}; } req.query = Object.fromEntries(u.searchParams); accountHandler(req, res); });
    return;
  }
  if (u.pathname === '/api/studio') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4 * 1024 * 1024) req.destroy(); }); // room for studio file uploads + voice questions
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch {}
      if (req.method === 'GET' && ['wfeed', 'wemote'].includes(u.searchParams.get('action'))) body = { studio: u.searchParams.get('studio'), asset: u.searchParams.get('asset') };
      try { json(res, 200, await handle(u.searchParams.get('action'), body)); }
      catch (e) { if (!e.status) console.error(e); json(res, e.status || 500, { error: e.status ? e.message : `The studio server hit an error: ${e.message}` }); }
    });
    return;
  }
  let p;
  try { p = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (p === '/' || p.startsWith('/s/') || p.startsWith('/c/')) p = '/index.html';
  else if (p.startsWith('/w/')) p = '/watch.html';
  else if (p === '/privacy' || p === '/terms') p += '.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`gather studio → http://0.0.0.0:${PORT}`));
// One bad request must never drop every studio on a self-hosted server: log and keep serving.
process.on('uncaughtException', (e) => console.error('Uncaught error (server kept running):', e));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection (server kept running):', e));

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
      const relay = createRelay({ secret: useBuiltInRelay(), max: Number(process.env.RELAY_MAX_STREAMS) || 3, transcode: process.env.RELAY_TRANSCODE || 'auto', ffmpeg: ffmpegPath });
      gatherServer.on('upgrade', (req, socket, head) => {
        const p = new URL(req.url, 'http://x').pathname;
        if (p.startsWith('/relay/')) relay.handleUpgrade(req, socket, head, p.slice('/relay'.length));
        else socket.destroy();
      });
      console.log('[relay] built in: Go live streams through this server (' + ffmpegPath + ')');
    } catch (e) { console.warn('[relay] could not start the built-in relay:', e.message); }
  });
}
