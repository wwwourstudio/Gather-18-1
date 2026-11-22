// Vercel serverless entry: POST /api/translate (captions and watch-page chat translation).
const { translate } = require('../lib/translate');
const { enforceUsGeo } = require('../lib/geo');
const { ipOf } = require('./account');

module.exports = async (req, res) => {
  if (!enforceUsGeo(req, res, { api: true })) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Use POST.'); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
  res.status(200).json(await translate(body || {}, { ip: ipOf(req) }));
};
