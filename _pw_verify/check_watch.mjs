import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

fs.mkdirSync('_pw_verify/shots', { recursive: true });

const PORT = '8091';
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PORT, ALLOW_ANON_STUDIOS: '1', SIGNUP_LIMIT: '200' };
for (const k of ['REDIS_URL', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete env[k];
const srv = spawn(process.execPath, ['server.js'], { env, stdio: 'ignore' });

async function waitForServer(url, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start');
}

const browser = await chromium.launch({
  executablePath: '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});

try {
  await waitForServer(BASE + '/');
  const hctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const hp = await hctx.newPage();
  const consoleErrs = [];
  hp.on('pageerror', (e) => consoleErrs.push('HOST_PAGEERR: ' + e.message));

  await hp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await hp.click('#enterStage');
  await hp.waitForSelector('#wizDlg[open]');
  await hp.fill('#wTitle', "Nathan's live stream");
  await hp.click('#wGo');
  await hp.waitForSelector('#enterDlg[open]');
  await hp.fill('#enterName', 'Nathan');
  await hp.click('#enterGo');
  await hp.waitForSelector('#inviteDlg[open]');
  const code = (await hp.textContent('#inviteCode')).trim();
  await hp.keyboard.press('Escape');

  // Fresh signed-out desktop viewer
  const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wp = await wctx.newPage();
  wp.on('pageerror', (e) => consoleErrs.push('WATCH_PAGEERR: ' + e.message));
  wp.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) consoleErrs.push('WATCH_CONSOLE: ' + m.text()); });

  await wp.goto(`${BASE}/w/${code}`, { waitUntil: 'domcontentloaded' });
  await wp.waitForSelector('#wv:not(.sk-wait)');
  const isLive = await wp.waitForFunction(() => document.querySelector('#wDirect')?.videoWidth > 0, null, { timeout: 6000 }).then(() => true).catch(() => false);
  await wp.waitForTimeout(500);
  await wp.screenshot({ path: '_pw_verify/shots/watch_live.png' });

  // Open Shortcuts popover
  await wp.click('#wKeysBtn');
  await wp.waitForTimeout(200);
  await wp.screenshot({ path: '_pw_verify/shots/watch_keys.png' });
  await wp.click('#wKeysClose');

  // Switch showcase & rail tabs
  await wp.click('.wv-sc-tabs button[data-sc-tab="next"]');
  await wp.waitForTimeout(250);
  await wp.screenshot({ path: '_pw_verify/shots/watch_sc_next.png' });
  await wp.click('.wv-sc-tabs button[data-sc-tab="spotlight"]');
  await wp.waitForTimeout(250);
  await wp.screenshot({ path: '_pw_verify/shots/watch_sc_ai.png' });
  await wp.click('.wv-sc-tabs button[data-sc-tab="notices"]');

  await wp.click('#wTabStage');
  await wp.waitForTimeout(250);
  await wp.screenshot({ path: '_pw_verify/shots/watch_stage.png' });
  await wp.click('#wTabPulse');
  await wp.waitForTimeout(250);
  await wp.screenshot({ path: '_pw_verify/shots/watch_pulse.png' });
  await wp.click('#wTabChat');

  // Sign in modal & inline Guest bar
  await wp.click('#wMe');
  await wp.waitForSelector('#wSignDlg[open]');
  await wp.waitForTimeout(200);
  await wp.screenshot({ path: '_pw_verify/shots/watch_signin.png' });
  await wp.click('#wGuest');
  await wp.waitForSelector('#wGuestBar:not([hidden])');
  await wp.waitForTimeout(200);
  await wp.screenshot({ path: '_pw_verify/shots/watch_guestbar.png' });
  await wp.click('#wGuestCancel');

  const deskMetrics = await wp.evaluate(() => ({
    isLive: document.querySelector('#wDirect')?.videoWidth > 0,
    hasGlow: document.querySelector('#wv')?.classList.contains('glow'),
    hasAmbient: !!document.querySelector('#wAmbientVid')?.srcObject,
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    bentoBottom: document.querySelector('#wBelowHub')?.getBoundingClientRect().bottom,
  }));
  console.log('DESKTOP_METRICS:', JSON.stringify(deskMetrics));

  // Mobile 390x844
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/w/${code}`, { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('#wv:not(.sk-wait)');
  await mp.waitForTimeout(1500);
  await mp.screenshot({ path: '_pw_verify/shots/watch_mobile.png' });
  const mobMetrics = await mp.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    wTextBottom: document.querySelector('#wText')?.getBoundingClientRect().bottom,
    ih: window.innerHeight,
  }));
  console.log('MOBILE_METRICS:', JSON.stringify(mobMetrics));
  console.log('LIVE_DETECTED:', isLive);
  console.log('ERRORS:', JSON.stringify(consoleErrs));
} finally {
  await browser.close();
  srv.kill();
}
