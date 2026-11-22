// Vercel serverless entry: POST /api/brand-import (reads a public website's logo, colours and fonts).
const { importBrandFromUrl } = require('../lib/brand-import');
const { enforceUsGeo } = require('../lib/geo');

module.exports = async (req, res) => {
  if (!enforceUsGeo(req, res, { api: true })) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Use POST.'); }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
  try { res.status(200).json(await importBrandFromUrl(body?.url)); }
  catch (e) { res.status(400).json({ error: e.message || 'Could not read that website.' }); }
};
