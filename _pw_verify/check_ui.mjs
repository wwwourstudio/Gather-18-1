import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
fs.mkdirSync('_pw_verify/shots', { recursive: true });

const browser = await chromium.launch({
  executablePath: '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

try {
  // 1. Capture lightboxes on landing + studio
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const consoleErrs = [];
  p.on('pageerror', (e) => consoleErrs.push('PAGEERR: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('WebSocket')) consoleErrs.push('CONSOLE: ' + m.text()); });

  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#landing:not([hidden])');
  await p.waitForTimeout(1000);
  await p.screenshot({ path: '_pw_verify/shots/landing.png' });

  // Create an account quickly via #acctOpenBtn so #enterStage opens #wizDlg smoothly
  const acctEmail = `verify-${Date.now().toString(36)}@example.com`;
  await p.evaluate(async (email) => {
    const r = await fetch('/api/account?action=signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct horse battery', name: 'Nathan', agree: true }),
    });
    const j = await r.json();
    if (j.token) localStorage.setItem('gather:acctToken', JSON.stringify(j.token));
  }, acctEmail);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#landing:not([hidden])');
  await p.waitForTimeout(1000);
  await p.screenshot({ path: '_pw_verify/shots/landing.png' });

  // Open Start Show / Go Live lightbox (#wizDlg)
  await p.click('#enterStage');
  await p.waitForSelector('#wizDlg[open]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: '_pw_verify/shots/wiz_live.png' });

  // Switch to Schedule mode in #wizDlg
  await p.click('#wModeSeg button[data-wmode="later"]');
  await p.waitForTimeout(250);
  await p.screenshot({ path: '_pw_verify/shots/wiz_sched.png' });

  // Switch back to Go Live Now and launch into #enterDlg
  await p.click('#wModeSeg button[data-wmode="now"]');
  await p.fill('#wTitle', "Nathan's show");
  await p.click('#wGo');
  await p.waitForSelector('#enterDlg[open]', { timeout: 15000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '_pw_verify/shots/enter_dlg.png' });
  await p.fill('#enterName', 'Nathan');
  await p.click('#enterGo');
  await p.waitForSelector('#inviteDlg[open]', { timeout: 15000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '_pw_verify/shots/invite_dlg.png' });

  const code = (await p.textContent('#inviteCode')).trim();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // Open Watch Party in a fresh signed-out desktop viewer context
  const wctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const wp = await wctx.newPage();
  wp.on('pageerror', (e) => consoleErrs.push('WATCH_PAGEERR: ' + e.message));
  await wp.goto(`${BASE}/w/${code}`, { waitUntil: 'domcontentloaded' });
  await wp.waitForSelector('#wv:not(.sk-wait)');
  await wp.waitForTimeout(1200);
  await wp.screenshot({ path: '_pw_verify/shots/watch_desktop.png' });

  // Open Shortcuts popover
  await wp.click('#wKeysBtn');
  await wp.waitForTimeout(200);
  await wp.screenshot({ path: '_pw_verify/shots/watch_keys.png' });
  await wp.click('#wKeysClose');

  // Switch Showcase tabs & Stage/Pulse tabs to check clean layouts
  await wp.click('#wShowcaseTabs button[data-sc="next"]');
  await wp.waitForTimeout(150);
  await wp.screenshot({ path: '_pw_verify/shots/watch_sc_next.png' });
  await wp.click('#wShowcaseTabs button[data-sc="notices"]');

  // Click Sign in -> Guest inline bar
  await wp.click('#wMe');
  await wp.waitForSelector('#wSignDlg[open]');
  await wp.waitForTimeout(250);
  await wp.screenshot({ path: '_pw_verify/shots/watch_signin.png' });
  await wp.click('#wGuest');
  await wp.waitForSelector('#wGuestBar:not([hidden])');
  await wp.waitForTimeout(200);
  await wp.screenshot({ path: '_pw_verify/shots/watch_guestbar.png' });
  await wp.click('#wGuestCancel');

  // Desktop viewport overflow assertion
  const deskMetrics = await wp.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    ih: window.innerHeight,
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    stageBottom: document.querySelector('#wStageBox')?.getBoundingClientRect().bottom,
    bentoTop: document.querySelector('#wBelowHub')?.getBoundingClientRect().top,
    bentoBottom: document.querySelector('#wBelowHub')?.getBoundingClientRect().bottom,
  }));
  console.log('DESKTOP_METRICS:', JSON.stringify(deskMetrics));

  // Mobile Watch Party check (390x844)
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/w/${code}`, { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('#wv:not(.sk-wait)');
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: '_pw_verify/shots/watch_mobile.png' });

  const mobMetrics = await mp.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    wTextBottom: document.querySelector('#wText')?.getBoundingClientRect().bottom,
    ih: window.innerHeight,
  }));
  console.log('MOBILE_METRICS:', JSON.stringify(mobMetrics));
  console.log('ERRORS:', JSON.stringify(consoleErrs));
} finally {
  await browser.close();
}
