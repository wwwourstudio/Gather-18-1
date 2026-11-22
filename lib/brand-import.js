// SSRF-safe website brand kit importer: reads a public site's logo, colours and fonts.
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;

function isPrivateIp(ip) {
  if (!ip) return true;
  if (/^::ffff:/i.test(ip)) {
    const rest = ip.slice(7);
    // ::ffff:7f00:1 is 127.0.0.1 written in hex
    const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) { const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16); return isPrivateIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    return isPrivateIp(rest);
  }
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0 && p[2] === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lo = ip.toLowerCase();
    if (lo === '::1' || lo === '::') return true;
    if (lo.startsWith('fc') || lo.startsWith('fd')) return true; // ULA
    if (lo.startsWith('fe8') || lo.startsWith('fe9') || lo.startsWith('fea') || lo.startsWith('feb')) return true; // link-local
    if (lo.startsWith('ff')) return true; // multicast
    if (lo.startsWith('64:ff9b:')) return true; // NAT64 can reach internal IPv4
    if (lo.startsWith('2002:')) return true; // 6to4 embeds an arbitrary IPv4
    return false;
  }
  return true;
}

async function assertPublicUrl(rawUrl) {
  let str = String(rawUrl || '').trim();
  if (!str) throw new Error('Enter a website address first.');
  if (!/^https?:\/\//i.test(str)) str = 'https://' + str;
  let u;
  try { u = new URL(str); } catch { throw new Error('That website address doesn’t look valid.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https websites are supported.');
  if (u.username || u.password) throw new Error('Credentials in URLs are not allowed.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // [::1] → ::1
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Private or local addresses cannot be imported.');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Private IP addresses cannot be imported.');
  } else {
    const addrs = await dns.lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw new Error('Could not resolve that domain.');
    if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('That domain points to a private network address.');
  }
  return u;
}

async function safeFetchHtml(urlObj, hops = 0) {
  if (hops > 2) throw new Error('Too many redirects.');
  const res = await fetch(urlObj.toString(), {
    method: 'GET',
    redirect: 'manual',
    headers: { 'User-Agent': 'gather-brand-importer/1.0 (+https://gather.studio)', Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    const nextUrl = await assertPublicUrl(new URL(res.headers.get('location'), urlObj).toString());
    return safeFetchHtml(nextUrl, hops + 1);
  }
  if (!res.ok) throw new Error(`Website returned HTTP ${res.status}.`);
  const ct = String(res.headers.get('content-type') || '');
  if (ct && !/html|xml|text/i.test(ct)) throw new Error('That link did not return a web page.');
  const reader = res.body?.getReader?.();
  if (!reader) return { html: (await res.text()).slice(0, MAX_BYTES), finalUrl: urlObj };
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total >= MAX_BYTES) { try { reader.cancel(); } catch {} break; }
  }
  return { html: Buffer.concat(chunks).toString('utf8').slice(0, MAX_BYTES), finalUrl: urlObj };
}

function normHex(h) {
  const m = String(h || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '';
  const x = m[1].toLowerCase();
  return '#' + (x.length === 3 ? x[0] + x[0] + x[1] + x[1] + x[2] + x[2] : x);
}

function hexSatLum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const lum = (mx + mn) / 2;
  const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * lum - 1));
  return { sat, lum };
}

function pickStudioFont(html) {
  const fonts = [];
  for (const m of html.matchAll(/fonts\.googleapis\.com\/css2?\?[^"'\s>]*family=([^&"'\s>]+)/gi)) {
    fonts.push(decodeURIComponent(m[1]).toLowerCase());
  }
  for (const m of html.matchAll(/font-family\s*:\s*([^;}{"']+)/gi)) {
    fonts.push(m[1].toLowerCase());
  }
  const joined = fonts.join(' ');
  if (/playfair|merriweather|lora|georgia|garamond|cormorant|serif/i.test(joined) && !/sans-serif/.test(joined.split(',')[0] || '')) return 'playfair';
  if (/bebas|oswald|anton|impact|condensed|archivo black/i.test(joined)) return 'bebas';
  if (/jetbrains|fira code|space mono|ibm plex mono|monospace/i.test(joined)) return 'mono';
  if (/onest|dm sans|inter|manrope|outfit|sora/i.test(joined)) return 'onest';
  return 'jakarta';
}

function resolveHttpsAsset(raw, baseUrl) {
  if (!raw) return '';
  try {
    const u = new URL(raw.trim(), baseUrl);
    return u.protocol === 'https:' ? u.toString().slice(0, 400) : '';
  } catch { return ''; }
}

async function importBrandFromUrl(rawUrl) {
  const urlObj = await assertPublicUrl(rawUrl);
  const { html, finalUrl } = await safeFetchHtml(urlObj);

  const titleMatch = html.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
  const ogSite = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,80})["']/i);
  const name = (ogSite?.[1] || titleMatch?.[1] || finalUrl.hostname.replace(/^www\./, ''))
    .replace(/\s*[|–—-]\s*.*$/, '').replace(/\s+/g, ' ').trim().slice(0, 48);

  const themeMeta = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
  const metaHex = normHex(themeMeta?.[1] || '');

  const counts = new Map();
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = normHex('#' + m[1]);
    if (!h) continue;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  let accent = metaHex && hexSatLum(metaHex).sat > 0.25 ? metaHex : '';
  if (!accent) {
    accent = sorted.find((h) => { const { sat, lum } = hexSatLum(h); return sat >= 0.35 && lum >= 0.22 && lum <= 0.78; })
      || metaHex || '#3b82f6';
  }
  const darkSurface = sorted.find((h) => { const { lum } = hexSatLum(h); return lum >= 0.04 && lum <= 0.18; }) || '#0f172a';
  const isLightSite = sorted.slice(0, 5).filter((h) => hexSatLum(h).lum > 0.85).length >= 2 && !sorted.slice(0, 3).some((h) => hexSatLum(h).lum < 0.14);

  const bg = isLightSite ? 'paper'
    : (parseInt(accent.slice(1, 3), 16) > 190 && parseInt(accent.slice(5, 7), 16) < 110) ? 'ember'
    : (parseInt(accent.slice(3, 5), 16) > 150 && parseInt(accent.slice(1, 3), 16) < 90) ? 'forest'
    : 'dusk';

  const iconMatch = html.match(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:apple-touch-icon|icon)[^"']*["']/i);
  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const logoUrl = resolveHttpsAsset(iconMatch?.[1] || ogImg?.[1] || '/favicon.ico', finalUrl);

  const font = pickStudioFont(html);
  const palette = [accent, ...sorted.filter((h) => h !== accent && hexSatLum(h).sat > 0.2).slice(0, 4)];

  return {
    name: name || finalUrl.hostname,
    host: finalUrl.hostname,
    color: accent,
    panelColor: darkSurface,
    bg,
    font,
    panel: isLightSite ? 'solid' : 'glass',
    tag: isLightSite ? 'outline' : 'glass',
    bannerStyle: isLightSite ? 'minimal' : 'glass',
    frame: 'corners',
    motion: 'cinematic',
    alertStyle: 'glass',
    logoUrl,
    palette: palette.slice(0, 5),
  };
}

module.exports = { importBrandFromUrl, isPrivateIp };
