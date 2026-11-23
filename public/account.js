import { busy } from './ui.js';
import { googleConfigured, googleSignedIn, googleToken, googleSignOut, googleSignInToken } from './google.js';

// Account: sign in, profile and synced settings.
// Created by app.js through createAccount(app): `app` carries the studio state and helpers this part uses.
export function createAccount(app) {
  const {
    $, $$, store, S, localState, toast, initials, squareThumb, uploadAvatar, renderStreamPanel, openWizard,
    renderAll, renderPresets, applyTheme, renderAudioFxUI, renderBgFx, renderPreview, mountShortcutsRoot,
    renderShortcutsList, renderWatchSec
  } = app;
  // ---------------------------------------------------------------- account (sign in, profile, synced settings)
  const acct = { token: store.get('acctToken', ''), user: null };
  async function acctApi(action, body = {}) {
    let res;
    try {
      res = await fetch('/api/account?action=' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(acct.token ? { Authorization: 'Bearer ' + acct.token } : {}) },
        body: JSON.stringify(body),
      });
    } catch { throw Object.assign(new Error('Could not reach gather. Check your connection.'), { status: 0 }); }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401 && acct.token && !['login', 'signup', 'reset', 'forgot', 'password', 'delete'].includes(action)) signedOut();
      throw Object.assign(new Error(data.error || `Request failed (${res.status}).`), { status: res.status });
    }
    return data;
  }
  // Settings that follow you between devices once you're signed in. API keys and RTMP stream keys never sync.
  const SYNC_KEYS = ['tips', 'layouts', 'presets', 'accent', 'bg', 'title', 'theme', 'keys', 'aiProv', 'startMic', 'startCam', 'quality', 'audioFx', 'videoFx', 'brandPrefs', 'streamPrefs', 'streamType', 'hashtags', 'notifyPrefs', 'onboardingDone', 'destTemplates', 'creatorProfile', 'watchPrefs'];
  let syncT = null, applyingSync = false, acctBootP = Promise.resolve();
  const rawSet = store.set;
  store.set = (k, v) => {
    rawSet(k, v);
    if (!applyingSync && acct.user && SYNC_KEYS.includes(k)) { clearTimeout(syncT); syncT = setTimeout(pushSettings, 1500); renderSyncNote('Saving…'); }
  };
  function collectSettings() { const o = {}; for (const k of SYNC_KEYS) { const v = store.get(k, undefined); if (v !== undefined) o[k] = v; } return o; }
  async function pushSettings() {
    if (!acct.user) return;
    try { const r = await acctApi('update', { settings: collectSettings() }); acct.user = r.user; renderSyncNote('Saved to your account'); }
    catch (e) { renderSyncNote(e.message); }
  }
  function applySettings(settings) {
    applyingSync = true;
    for (const k of SYNC_KEYS) if (settings && k in settings) rawSet(k, settings[k]);
    applyingSync = false;
    S.audioFx = { echo: true, ns: true, agc: true, ai: false, gain: 1, duck: true, duckLevel: 0.2, duckRelease: 'normal', autoMute: true, autoMuteSec: 30, ...store.get('audioFx', {}) };
    S.videoFx = { effect: 'none', bright: 0, contrast: 1, sat: 1, key: '#00ff00', tol: 0.1, spill: 0.85, edge: 0.1, blur: 1, fps: 30, mirror: true, ...store.get('videoFx', {}) };
    S.aiProv = store.get('aiProv', 'claude');
    applyTheme(store.get('theme', 'dark'));
    if (!S.studio) S.state = localState();
    renderAll(); renderPresets(); renderBgFx(); renderAudioFxUI?.();
  }
  let profT = null;
  function profileSoon(patch) {
    if (!acct.user) return;
    clearTimeout(profT);
    profT = setTimeout(() => acctApi('update', patch).then((r) => setUser(r.user)).catch(() => {}), 700);
  }
  function setUser(u, token) {
    acct.user = u;
    store.set('hadAccount', true); // this browser has signed in before: greet with "Welcome back" next time
    if (token) { acct.token = token; rawSet('acctToken', token); }
    if (u) {
      if (u.name) { S.name = u.name; rawSet('name', u.name); if (document.activeElement !== $('#nameInput')) $('#nameInput').value = u.name; if (document.activeElement !== $('#enterName')) $('#enterName').value = u.name; }
      if (u.avatar) rawSet('avatar', u.avatar);
    }
    renderUser(); renderPreview(); renderStreamPanel(); renderWatchSec();
  }
  function signedOut(msg) {
    acct.user = null; acct.token = ''; rawSet('acctToken', '');
    renderUser(); renderPreview(); renderStreamPanel();
    if (msg) toast(msg);
  }
  function closeUserMenu() {
    const pop = $('#userMenuPop'), btn = $('#userBtn');
    if (pop) pop.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function toggleUserMenu() {
    const pop = $('#userMenuPop'), btn = $('#userBtn');
    if (!pop || !btn) return;
    const open = pop.hidden;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) syncThemeSegs(store.get('theme', 'dark'));
  }
  document.addEventListener('click', (e) => {
    const wrap = $('#userMenuWrap'), pop = $('#userMenuPop');
    if (pop && !pop.hidden && wrap && !wrap.contains(e.target)) closeUserMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeUserMenu();
  });
  function syncThemeSegs(t) {
    const norm = t === 'light' ? 'light' : 'dark';
    $$('#umThemeSeg [data-um-theme]').forEach((b) => { const on = b.dataset.umTheme === norm; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $$('#acThemeSeg [data-ac-theme]').forEach((b) => { const on = b.dataset.acTheme === norm; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function renderUser() {
    const b = $('#userBtn'), u = acct.user;
    b.classList.toggle('signed', !!u);
    b.title = u ? `Signed in as ${u.email}` : 'Sign in';
    const av = $('#userAv');
    av.style.backgroundImage = u?.avatar ? `url("${u.avatar}")` : '';
    av.textContent = u ? (u.avatar ? '' : initials(u.name)) : '';
    $('#userIcon').toggleAttribute('hidden', !!u);
    $('#userLabel').textContent = u ? u.name : 'Sign in';
    const chev = $('#userChev');
    if (chev) chev.toggleAttribute('hidden', !u);
    if (!u) closeUserMenu();
    if (u) {
      const prof = store.get('creatorProfile', {});
      const umAv = $('#umAv');
      if (umAv) {
        umAv.style.backgroundImage = u.avatar ? `url("${u.avatar}")` : '';
        umAv.textContent = u.avatar ? '' : initials(u.name);
      }
      if ($('#umName')) $('#umName').textContent = u.name || 'Creator';
      if ($('#umEmail')) $('#umEmail').textContent = u.email || '';
      if ($('#umHandle')) {
        const h = (prof.handle || '').replace(/^@+/, '').trim();
        $('#umHandle').textContent = h ? `@${h}` : '';
        $('#umHandle').hidden = !h;
      }
    }
    syncThemeSegs(store.get('theme', 'dark'));
    if ($('#acctDlg').open) renderAcctDlg();
  }
  function renderSyncNote(t) {
    const n = $('#acSync'); if (n) n.textContent = t;
    const st = $('#acSyncStatusText'); if (st && t) st.textContent = t;
  }
  let acView = 'in'; // in | up | forgot | reset
  let acPane = 'profile'; // profile | studio | audience | sync | shortcuts | security
  function setAcPane(pane) {
    acPane = ['profile', 'studio', 'audience', 'sync', 'shortcuts', 'security'].includes(pane) ? pane : 'profile';
    $$('#acIn [data-ac-pane]').forEach((b) => {
      const on = b.dataset.acPane === acPane;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('#acIn [data-ac-panel]').forEach((p) => {
      p.hidden = p.dataset.acPanel !== acPane;
    });
    if (acPane === 'shortcuts') {
      mountShortcutsRoot(true);
      renderShortcutsList();
    }
  }
  function renderAcctDlg() {
    const u = acct.user;
    $('#acOut').hidden = !!u || acView === 'forgot' || acView === 'reset' || acView === 'shortcuts';
    $('#acForgotView').hidden = acView !== 'forgot';
    $('#acResetView').hidden = acView !== 'reset';
    if ($('#acShortcutsView')) $('#acShortcutsView').hidden = !!u || acView !== 'shortcuts';
    $('#acIn').hidden = !u;
    $$('#acTabs button').forEach((b) => { const on = b.dataset.ac === acView; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('#acNameRow').hidden = acView !== 'up';
    $('#acGo').textContent = acView === 'up' ? 'Create account' : 'Sign in';
    $('#acPass').autocomplete = acView === 'up' ? 'new-password' : 'current-password';
    $('#acWhy').hidden = !!u || !S.afterSignIn || acView === 'shortcuts';
    const outView = !u && acView !== 'forgot' && acView !== 'reset' && acView !== 'shortcuts', up = acView === 'up';
    $('#acGoogleBtn').hidden = $('#acOr').hidden = !outView || !googleConfigured();
    $('#acGoogleText').textContent = up ? 'Sign up with Google' : 'Continue with Google';
    $('#acAgreeRow').hidden = !up; $('#acMeter').hidden = !up; $('#acForgot').hidden = up;
    $('#acFine').hidden = !outView || up;
    $('#acPass').placeholder = up ? 'At least 8 characters' : 'Your password';
    const av = store.get('avatar', '');
    $('#acUpAvatarImg').hidden = !av; if (av) $('#acUpAvatarImg').src = av;
    $('#acUpAvatar').classList.toggle('has', !!av);
    $('#acUpAvatar').setAttribute('aria-label', av ? 'Change your profile photo' : 'Add a profile photo');
    document.querySelector('#acctDlg .ac-card').classList.toggle('signed', !!u);
    $('#acH').textContent = u ? 'Account & Creator Settings' : acView === 'shortcuts' ? 'Keyboard shortcuts' : acView === 'forgot' ? 'Reset your password' : acView === 'reset' ? 'Choose a new password' : acView === 'up' ? 'Create your account' : 'Welcome back';
    if (!u && acView === 'shortcuts') {
      mountShortcutsRoot(false);
      renderShortcutsList();
    }
    if (u) {
      // accounts made with Google have no password: no change-password form, and deleting asks for the email
      $('#acPwDetails').hidden = !u.hasPassword;
      $('#acDelLabel').textContent = u.hasPassword ? 'Password' : 'Type your email to confirm';
      $('#acDelPass').type = u.hasPassword ? 'password' : 'email';

      // Sidebar identity + Profile pane
      const navAv = $('#acNavAv');
      if (navAv) {
        navAv.style.backgroundImage = u.avatar ? `url("${u.avatar}")` : '';
        navAv.textContent = u.avatar ? '' : initials(u.name);
      }
      if ($('#acNavName')) $('#acNavName').textContent = u.name || 'Creator';
      if (document.activeElement !== $('#acNick')) $('#acNick').value = u.name || '';
      $('#acEmailShow').textContent = u.email || '';
      $('#acAvatarImg').hidden = !u.avatar; if (u.avatar) $('#acAvatarImg').src = u.avatar;
      $('#acAvatarIni').textContent = u.avatar ? '' : initials(u.name);
      if ($('#acAvatarRemoveBtn')) $('#acAvatarRemoveBtn').hidden = !u.avatar;

      const prof = store.get('creatorProfile', {});
      if ($('#acHandle') && document.activeElement !== $('#acHandle')) $('#acHandle').value = prof.handle || '';
      if ($('#acCategory')) $('#acCategory').value = prof.category || store.get('streamType', 'live') || 'live';
      if ($('#acTz')) $('#acTz').value = prof.tz || 'auto';
      if ($('#acBio') && document.activeElement !== $('#acBio')) $('#acBio').value = prof.bio || '';
      if ($('#acSocYt') && document.activeElement !== $('#acSocYt')) $('#acSocYt').value = prof.yt || '';
      if ($('#acSocTw') && document.activeElement !== $('#acSocTw')) $('#acSocTw').value = prof.tw || '';
      if ($('#acSocX') && document.activeElement !== $('#acSocX')) $('#acSocX').value = prof.x || '';
      if ($('#acSocWeb') && document.activeElement !== $('#acSocWeb')) $('#acSocWeb').value = prof.web || '';

      // Studio defaults pane
      const sp = store.get('streamPrefs', {});
      syncThemeSegs(store.get('theme', 'dark'));
      if ($('#acDefQual')) $('#acDefQual').value = String(S.prefs.quality || store.get('quality', '720'));
      if ($('#acDefAspect')) $('#acDefAspect').value = sp.aspect || '16:9';
      if ($('#acDefLayout')) $('#acDefLayout').value = sp.defaultLayout || 'split';
      if ($('#acPrefMic')) $('#acPrefMic').checked = S.prefs.startMic !== false;
      if ($('#acPrefCam')) $('#acPrefCam').checked = S.prefs.startCam !== false;
      if ($('#acPrefNoise')) $('#acPrefNoise').checked = S.audioFx.ns !== false;
      if ($('#acPrefAutoMute')) $('#acPrefAutoMute').checked = sp.autoMute?.on !== false;
      if ($('#acPrefCaps')) $('#acPrefCaps').checked = !!sp.captions?.on;
      if ($('#acPrefAutoRec')) $('#acPrefAutoRec').checked = !!sp.autoRec;

      // Audience & alerts pane
      const wp = store.get('watchPrefs', { chat: true, supers: true, voice: true, sounds: true, slow: '0' });
      const np = store.get('notifyPrefs', { email: true, r24h: true, r15m: true });
      if ($('#acAudChat')) $('#acAudChat').checked = wp.chat !== false;
      if ($('#acAudSupers')) $('#acAudSupers').checked = wp.supers !== false;
      if ($('#acAudVoice')) $('#acAudVoice').checked = wp.voice !== false;
      if ($('#acAudSounds')) $('#acAudSounds').checked = wp.sounds !== false;
      if ($('#acAudSlow')) $('#acAudSlow').value = String(wp.slow || '0');
      if ($('#acAudAi')) $('#acAudAi').value = S.aiProv || store.get('aiProv', 'gemini') || 'gemini';
      if ($('#acNotifEmail')) $('#acNotifEmail').checked = np.email !== false;
      if ($('#acNotifRemind')) $('#acNotifRemind').checked = np.r24h !== false || np.r15m !== false;

      // Sync & connected services pane
      const gConf = googleConfigured(), gIn = gConf && googleSignedIn();
      if ($('#acGoogleStatusText')) {
        $('#acGoogleStatusText').textContent = !gConf
          ? 'Google integration is not configured on this server yet.'
          : gIn
          ? 'Connected · YouTube thumbnails, live chat & Google Drive enabled.'
          : 'Connect to upload thumbnails, read YouTube chat, and save recordings to Drive.';
      }
      if ($('#acGoogleConnectBtn')) {
        $('#acGoogleConnectBtn').textContent = gIn ? 'Disconnect' : 'Connect';
        $('#acGoogleConnectBtn').disabled = !gConf;
      }

      setAcPane(acPane);
      renderSyncNote('Synced to your account across devices');
    }
  }
  async function finishSignIn(r, isNew, local = collectSettings()) {
    setUser(r.user, r.token);
    // Bring this browser's setup into a new account; an existing account's settings win on a new device.
    if (isNew || !Object.keys(r.user.settings || {}).length) { const av = store.get('avatar', ''); await acctApi('update', { settings: local, ...(av && !r.user.avatar ? { avatar: av } : {}) }).then((x) => setUser(x.user)).catch(() => {}); }
    else applySettings(r.user.settings);
    acView = 'in'; renderAcctDlg();
    toast(`Signed in as ${r.user.name}.`);
    const next = S.afterSignIn; S.afterSignIn = null;
    if (next) { $('#acctDlg').close(); next(); }
  }
  async function googleSignIn() {
    acErr('#acErr', '');
    if (acView === 'up' && !$('#acAgree').checked) { acErr('#acErr', 'Tick the box to agree to the Terms and Privacy policy first.'); return $('#acAgree').focus(); }
    busy($('#acGoogleBtn'));
    try {
      const accessToken = await googleSignInToken();
      // Signing in from the "Sign in" tab is covered by the notice under the form, so agreeing goes with it.
      const r = await acctApi('google', { accessToken, agree: true });
      await finishSignIn(r, !!r.created);
    } catch (err) { acErr('#acErr', err.message); }
    finally { busy($('#acGoogleBtn'), false); }
  }
  $('#acGoogleBtn').onclick = googleSignIn;
  // sign-up extras: a profile photo, show/hide password, a strength hint
  $('#acUpAvatar').onclick = () => $('#acUpAvatarFile').click();
  $('#acUpAvatarFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { store.set('avatar', await squareThumb(f)); renderAcctDlg(); renderPreview(); } catch (err) { acErr('#acErr', err.message); }
  };
  $('#acPassEye').onclick = () => {
    const show = $('#acPass').type === 'password';
    $('#acPass').type = show ? 'text' : 'password';
    $('#acPassEye').setAttribute('aria-pressed', String(show));
    $('#acPassEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    $('#acPassEye use').setAttribute('href', show ? '/icons.svg#i-eye-off' : '/icons.svg#i-eye');
  };
  function passScore(p) {
    if (p.length < 8) return 0;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(p)).length;
    return p.length >= 14 || (p.length >= 10 && kinds >= 3) ? 3 : kinds >= 2 || p.length >= 10 ? 2 : 1;
  }
  $('#acPass').addEventListener('input', () => {
    if (acView !== 'up') return;
    const p = $('#acPass').value, sc = passScore(p);
    $('#acMeter').dataset.score = p ? sc : '';
    $('#acMeterText').textContent = !p ? '' : sc === 0 ? `${8 - p.length} more character${8 - p.length === 1 ? '' : 's'}` : ['', 'Okay', 'Good', 'Strong'][sc];
  });
  /** Starting a studio needs an account (guests don't): hydrate existing token before ever prompting sign-in. */
  async function needAccountThen(fn) {
    if (acct.user) return fn();
    try { await S.configP; } catch {} // a click before the site's settings arrive must not skip the sign-in
    if (!S.requireAccount || acct.user) return fn();
    if (acct.token) {
      try { await acctBootP; } catch {}
      if (!acct.user && acct.token) {
        try { const r = await acctApi('me'); setUser(r.user); } catch {}
      }
      if (acct.user) return fn();
    }
    S.afterSignIn = fn;
    openAccount();
  }
  function openAccount(view, pane) {
    // First-timers start on Create account; anyone who has signed in on this browser before starts on Sign in.
    acView = view || (acct.user || store.get('hadAccount', false) ? 'in' : 'up');
    if (pane) acPane = pane;
    closeUserMenu();
    $$('#acctDlg .err').forEach((e) => (e.hidden = true));
    renderAcctDlg();
    if (!$('#acctDlg').open) $('#acctDlg').showModal();
  }
  const acErr = (id, msg) => { const e = $(id); e.textContent = msg; e.hidden = !msg; };
  $('#userBtn').onclick = (e) => {
    e.stopPropagation();
    if (!acct.user) return openAccount();
    toggleUserMenu();
  };
  $$('#userMenuPop [data-um-tab]').forEach((b) => b.addEventListener('click', () => {
    closeUserMenu();
    openAccount('in', b.dataset.umTab);
  }));
  $('#umStartShow')?.addEventListener('click', () => { closeUserMenu(); openWizard('now'); });
  $('#umStudioSettings')?.addEventListener('click', () => { closeUserMenu(); $('#settingsTop')?.click(); });
  $$('#umThemeSeg [data-um-theme]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.umTheme)));
  $('#umSignOut')?.addEventListener('click', () => { closeUserMenu(); $('#acSignOut')?.click(); });

  $$('#acIn [data-ac-pane]').forEach((b) => b.addEventListener('click', () => setAcPane(b.dataset.acPane)));
  $$('#acThemeSeg [data-ac-theme]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.acTheme)));
  $('#acOpenShortcutsOut')?.addEventListener('click', () => { acView = 'shortcuts'; renderAcctDlg(); setTimeout(() => $('#shortcutsSearch')?.focus(), 30); });
  $('#acShortcutsBack')?.addEventListener('click', () => { acView = store.get('hadAccount', false) ? 'in' : 'up'; renderAcctDlg(); });

  $$('#acTabs button').forEach((b) => b.addEventListener('click', () => { acView = b.dataset.ac; acErr('#acErr', ''); renderAcctDlg(); }));
  $('#acForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    acErr('#acErr', '');
    busy($('#acGo'));
    try {
      const body = { email: $('#acEmail').value, password: $('#acPass').value };
      const local = collectSettings();
      let r;
      if (acView === 'up' && !$('#acAgree').checked) { acErr('#acErr', 'Tick the box to agree to the Terms and Privacy policy first.'); $('#acAgree').focus(); return; }
      if (acView === 'up') r = await acctApi('signup', { ...body, agree: true, name: $('#acName').value || S.name });
      else r = await acctApi('login', body);
      $('#acPass').value = '';
      await finishSignIn(r, acView === 'up', local);
    } catch (err) { acErr('#acErr', err.message); }
    finally { busy($('#acGo'), false); }
  });
  $('#acForgot').onclick = () => { acView = 'forgot'; $('#acFEmail').value = $('#acEmail').value; renderAcctDlg(); };
  $('#acFBack').onclick = () => { acView = 'in'; renderAcctDlg(); };
  $('#acFGo').onclick = async () => {
    acErr('#acFErr', ''); $('#acFMsg').hidden = true;
    try { await acctApi('forgot', { email: $('#acFEmail').value }); $('#acFMsg').hidden = false; }
    catch (err) { acErr('#acFErr', err.message); }
  };
  $('#acRGo').onclick = async () => {
    acErr('#acRErr', '');
    try {
      const r = await acctApi('reset', { token: S.resetToken, password: $('#acRPass').value });
      setUser(r.user, r.token); applySettings(r.user.settings);
      history.replaceState(null, '', '/'); acView = 'in'; renderAcctDlg(); toast('Password changed. You’re signed in.');
    } catch (err) { acErr('#acRErr', err.message); }
  };
  $('#acSaveProfile').onclick = async () => {
    const btn = $('#acSaveProfile');
    busy(btn);
    try {
      const nextName = ($('#acNick')?.value || '').trim();
      const creatorProfile = {
        handle: ($('#acHandle')?.value || '').replace(/^@+/, '').trim().slice(0, 24),
        category: $('#acCategory')?.value || 'live',
        tz: $('#acTz')?.value || 'auto',
        bio: ($('#acBio')?.value || '').trim().slice(0, 220),
        yt: ($('#acSocYt')?.value || '').trim().slice(0, 120),
        tw: ($('#acSocTw')?.value || '').trim().slice(0, 120),
        x: ($('#acSocX')?.value || '').trim().slice(0, 120),
        web: ($('#acSocWeb')?.value || '').trim().slice(0, 120),
      };
      const prevSp = store.get('streamPrefs', {});
      const nextSp = {
        ...prevSp,
        aspect: $('#acDefAspect')?.value || prevSp.aspect || '16:9',
        defaultLayout: $('#acDefLayout')?.value || prevSp.defaultLayout || 'split',
        autoMute: { on: $('#acPrefAutoMute')?.checked !== false, sec: prevSp.autoMute?.sec || 30, scope: prevSp.autoMute?.scope || 'guests' },
        captions: { ...(prevSp.captions || { style: 'bar', size: 26, lang: 'en-US' }), on: !!$('#acPrefCaps')?.checked },
        autoRec: !!$('#acPrefAutoRec')?.checked,
      };
      const watchPrefs = {
        chat: $('#acAudChat')?.checked !== false,
        supers: $('#acAudSupers')?.checked !== false,
        voice: $('#acAudVoice')?.checked !== false,
        sounds: $('#acAudSounds')?.checked !== false,
        slow: $('#acAudSlow')?.value || '0',
      };
      const remind = $('#acNotifRemind')?.checked !== false;
      const notifyPrefs = {
        email: $('#acNotifEmail')?.checked !== false,
        r24h: remind,
        r15m: remind,
      };
      const qual = $('#acDefQual')?.value || '720';
      const startMic = $('#acPrefMic')?.checked !== false;
      const startCam = $('#acPrefCam')?.checked !== false;
      const nsOn = $('#acPrefNoise')?.checked !== false;
      const aiProv = $('#acAudAi')?.value || 'gemini';

      S.prefs.quality = qual;
      S.prefs.startMic = startMic;
      S.prefs.startCam = startCam;
      S.audioFx.ns = nsOn;
      S.aiProv = aiProv;
      if ($('#qualitySelect')) $('#qualitySelect').value = qual;
      if ($('#startMic')) $('#startMic').checked = startMic;
      if ($('#startCam')) $('#startCam').checked = startCam;
      if ($('#nsChk')) $('#nsChk').checked = nsOn;

      applyingSync = true;
      rawSet('creatorProfile', creatorProfile);
      rawSet('streamPrefs', nextSp);
      rawSet('watchPrefs', watchPrefs);
      rawSet('notifyPrefs', notifyPrefs);
      rawSet('quality', qual);
      rawSet('startMic', startMic);
      rawSet('startCam', startCam);
      rawSet('audioFx', S.audioFx);
      rawSet('aiProv', aiProv);
      applyingSync = false;

      const r = await acctApi('update', { name: nextName || acct.user?.name || '', settings: collectSettings() });
      setUser(r.user);
      renderSyncNote('All changes saved to your account');
      toast('Saved. Your settings are on every device you sign in on.');
      $('#acctDlg').close(); // Save is the dialog's primary action: done means done
    } catch (err) { toast(err.message, { err: true }); }
    finally { busy(btn, false); }
  };
  $('#acAvatarBtn').onclick = () => $('#acAvatarFile').click();
  $('#acAvatarChangeBtn')?.addEventListener('click', () => $('#acAvatarFile').click());
  $('#acAvatarRemoveBtn')?.addEventListener('click', async () => {
    try {
      rawSet('avatar', '');
      const r = await acctApi('update', { avatar: '' });
      setUser(r.user);
      toast('Profile photo removed.');
    } catch (err) { toast(err.message, { err: true }); }
  });
  $('#acAvatarFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = await squareThumb(f);
      rawSet('avatar', data);
      const r = await acctApi('update', { avatar: data }); setUser(r.user);
      if (S.studio) uploadAvatar(true);
      toast('Photo updated.');
    } catch (err) { toast(err.message, { err: true }); }
  };
  $('#acSyncNowBtn')?.addEventListener('click', async () => {
    const btn = $('#acSyncNowBtn'); busy(btn);
    await pushSettings();
    busy(btn, false);
    toast('Profile & preferences synced.');
  });
  $('#acGoogleConnectBtn')?.addEventListener('click', async () => {
    if (!googleConfigured()) return toast('Google sign-in is not configured on this server.', { err: true });
    const btn = $('#acGoogleConnectBtn'); busy(btn);
    try {
      if (googleSignedIn()) {
        googleSignOut();
        toast('Disconnected Google session.');
      } else {
        await googleToken(['drive', 'youtube']);
        toast('Google & YouTube connected.');
      }
      renderAcctDlg();
    } catch (err) { toast(err.message || 'Could not update Google connection.', { err: true }); }
    finally { busy(btn, false); }
  });
  $('#acExportBtn')?.addEventListener('click', () => {
    const payload = { app: 'gather', version: 1, exportedAt: new Date().toISOString(), settings: collectSettings() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gather-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Settings exported as JSON.');
  });
  $('#acImportBtn')?.addEventListener('click', () => $('#acImportFile')?.click());
  $('#acImportFile')?.addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      const src = parsed && typeof parsed === 'object' ? (parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : parsed) : null;
      if (!src || Array.isArray(src)) throw new Error('Invalid settings backup file.');
      const safe = Object.create(null);
      let count = 0;
      for (const k of SYNC_KEYS) {
        if (Object.prototype.hasOwnProperty.call(src, k)) { safe[k] = src[k]; count++; }
      }
      if (!count) throw new Error('No recognized gather settings found in that file.');
      applySettings(safe);
      if (acct.user) await pushSettings();
      renderAcctDlg();
      toast(`Imported ${count} settings group${count === 1 ? '' : 's'}.`);
    } catch (err) { toast(err.message || 'Could not import settings file.', { err: true }); }
  });
  $('#acResetCacheBtn')?.addEventListener('click', () => {
    ['panelClosed', 'panelTab', 'dockHint', 'onboardingDone'].forEach((k) => { try { localStorage.removeItem('gather:' + k); } catch {} });
    toast('Local UI layout reset to defaults.');
  });
  $('#acPwGo').onclick = async () => {
    acErr('#acPwErr', ''); $('#acPwMsg').hidden = true;
    try {
      const r = await acctApi('password', { current: $('#acCur').value, next: $('#acNew').value });
      setUser(r.user, r.token); $('#acCur').value = ''; $('#acNew').value = '';
      $('#acPwMsg').hidden = false;
    } catch (err) { acErr('#acPwErr', err.message); }
  };
  $('#acSignOut').onclick = async () => { closeUserMenu(); await acctApi('logout').catch(() => {}); signedOut('Signed out.'); $('#acctDlg').close(); };
  $('#acDelGo').onclick = async () => {
    acErr('#acDelErr', '');
    try { await acctApi('delete', { password: $('#acDelPass').value }); signedOut('Your account was deleted.'); $('#acctDlg').close(); }
    catch (err) { acErr('#acDelErr', err.message); }
  };
  async function acctBoot() {
    const reset = new URLSearchParams(location.search).get('reset');
    if (reset) { S.resetToken = reset; openAccount('reset'); }
    if (!acct.token) return renderUser();
    try { const r = await acctApi('me'); setUser(r.user); if (Object.keys(r.user.settings || {}).length) applySettings(r.user.settings); }
    catch (e) { if (e.status !== 401) renderUser(); }
  }

  return { acct, acctApi, get acctBootP() { return acctBootP; }, set acctBootP(v) { acctBootP = v; }, rawSet, pushSettings, profileSoon, setUser, signedOut, syncThemeSegs, get acView() { return acView; }, get acPane() { return acPane; }, needAccountThen, openAccount, acctBoot };
}
