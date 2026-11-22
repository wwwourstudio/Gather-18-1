// gather relay, standalone: takes the finished program from a host's browser over a WebSocket and sends it to YouTube,
// Twitch, Kick, Facebook or any RTMP(S) server, to several at once. Platforms only accept RTMP(S), which a
// browser can't send, so this small FFmpeg service sits in between.
//
//   RELAY_SECRET=… node server.js           # same secret as RELAY_SECRET in gather's settings; see README.md
//
// gather's own server runs the same engine built in when RELAY_URL isn't set; this service is for hosts (like Vercel)
// that can't run FFmpeg. Stream keys pass through to FFmpeg and are never logged.
const http = require('node:http');
const { createRelay } = require('./core');

const SECRET = process.env.RELAY_SECRET || '';
const PORT = Number(process.env.PORT) || 8080;
const MAX = Number(process.env.RELAY_MAX_STREAMS) || 3;
const TRANSCODE = process.env.RELAY_TRANSCODE || 'auto'; // auto: copy H.264 from the browser; always: re-encode
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
if (!SECRET || SECRET.length < 24) { console.error('Set RELAY_SECRET (24+ characters, the same value as in gather’s settings).'); process.exit(1); }

const relay = createRelay({ secret: SECRET, max: MAX, transcode: TRANSCODE, ffmpeg: FFMPEG });
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(relay.health())); }
  res.writeHead(404); res.end();
});
server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));
server.listen(PORT, () => console.log(`gather relay on :${PORT} (max ${MAX} streams, ${TRANSCODE === 'always' ? 're-encoding' : 'copying H.264 when possible'})`));
const b64u = (b) => Buffer.from(b).toString('base64url');
module.exports = { verify: relay.verify, target: relay.target, b64u };
