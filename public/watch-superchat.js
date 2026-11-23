import { replaceKids } from './ui.js';

// Super chats: the single tray in the chat input (amount, message, voice note), paid by card right on the page.
// Created by watch.js through createSuperChat(app): `app` carries the watch page state and helpers this part uses.
export function createSuperChat(app) {
  const { $, $$, ACCT, W, api, creds, toast, ensureSession, poll, showErr, awardXp, joinSigned, openSignIn } = app;
  // ---------------------------------------------------------------- super chats (single unified inline tray)
  const SC = { amount: 5 };
  $('#wSuperBtn').onclick = () => openTipDock();

  // ---------------------------------------------------------------- super chat in the chat input
  // Paid by card, Apple Pay or Google Pay in Stripe's embedded checkout, on the streamer's own Stripe account. Nobody
  // leaves the page, and the super chat goes on screen by itself once the payment clears (no "I've paid" step).
  // The message you're typing becomes the super chat.
  const tierOf = (a) => (a >= 50 ? 'rose' : a >= 20 ? 'amber' : a >= 10 ? 'emerald' : 'blue');
  function tipRender() {
    const w = W.info?.watch || {};
    const min = w.min || 2;
    SC.amount = Math.max(SC.amount, min);
    const amounts = [...new Set([min, 5, 10, 20, 50, 100].filter((a) => a >= min))].slice(0, 5);
    replaceKids($('#wTipAmts'), ...amounts.map((a) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.tier = tierOf(a); b.className = 'num'; b.textContent = '$' + a;
      b.setAttribute('aria-checked', String(a === SC.amount)); b.onclick = () => { SC.amount = a; const c = $('#wTipCustom'); if (c) c.value = ''; tipRender(); };
      return b;
    }), (() => {
      const c = Object.assign(document.createElement('input'), { className: 'input num', id: 'wTipCustom', type: 'number', min: String(min), max: '10000', step: '1', placeholder: 'Other', inputMode: 'decimal' });
      c.setAttribute('aria-label', 'Other amount in dollars');
      if (!amounts.includes(SC.amount)) c.value = String(SC.amount);
      c.oninput = () => { const v = Math.round(Number(c.value)); if (v >= min) { SC.amount = v; tipSync(); } };
      return c;
    })());
    $('#wTipSub').textContent = `Paid straight to ${W.info?.host?.name || 'the streamer'}`;
    $('#wTipRec').hidden = !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || w.voice === false;
    tipSync();
  }
  function tipSync() {
    $$('#wTipAmts button').forEach((b) => b.setAttribute('aria-checked', String(b.textContent === '$' + SC.amount)));
    $('#wTipDock').dataset.tier = tierOf(SC.amount);
    $('#wTipPay').textContent = `Pay $${SC.amount}`;
    $('#wTipDock').classList.add('onsite');
    const msg = $('#wTipMsg').value.trim();
    $('#wTipCount').textContent = `${$('#wTipMsg').value.length}/${$('#wTipMsg').maxLength}`;
    $('#wTipNote').textContent = $('#wBounty')?.checked
      ? (msg ? `Bounty: “${msg.slice(0, 60)}${msg.length > 60 ? '…' : ''}”, on stream once it’s paid.` : 'Type the challenge above, e.g. “win a round with pistols only”.')
      : `Card, Apple Pay or Google Pay, right here. Your ${TV.blob ? 'voice message' : msg ? 'message' : 'super chat'} goes on screen the moment it’s paid.`;
  }
  function openTipDock() {
    const w = W.info?.watch || {};
    if (!w.supers) return;
    showErr('#wTipErr', '');
    $('#wTipDock').hidden = false; $('#wTipBtn').setAttribute('aria-expanded', 'true'); $('#wTipBtn').classList.add('on');
    $('#wTipMsg').value ||= $('#wText').value.trim(); // anything typed in the chat box comes along
    tipRender();
    setTimeout(() => $('#wTipMsg').focus(), 30);
  }
  function closeTipDock() {
    $('#wTipDock').hidden = true; $('#wTipBtn').setAttribute('aria-expanded', 'false'); $('#wTipBtn').classList.remove('on');
    checkoutClose(); if (TV.rec?.state === 'recording') TV.rec.stop();
  }
  $('#wTipBtn').onclick = () => ($('#wTipDock').hidden ? openTipDock() : closeTipDock());
  $('#wTipX').onclick = closeTipDock;
  $('#wBounty').addEventListener('change', () => { $('#wTipDock').classList.toggle('bounty', $('#wBounty').checked); tipSync(); });
  $('#wTipMsg').addEventListener('input', () => tipSync());

  // ---- voice message attached to a super chat (up to 20 s)
  const TV = { rec: null, chunks: [], stream: null, t0: 0, timer: null, blob: null, data: '', dur: 0 };
  async function tipRecStart() {
    try { TV.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { return showErr('#wTipErr', 'Allow the microphone to record a voice message (the lock icon in the address bar).'); }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    TV.chunks = []; TV.rec = new MediaRecorder(TV.stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    TV.rec.ondataavailable = (e) => { if (e.data.size) TV.chunks.push(e.data); };
    TV.rec.onstop = tipRecStopped;
    TV.rec.start(250); TV.t0 = Date.now();
    $('#wTipRec').classList.add('on'); $('#wTipRecLabel').textContent = 'Recording… tap to stop';
    TV.timer = setInterval(() => { const s = Math.floor((Date.now() - TV.t0) / 1000); $('#wTipRecTime').textContent = `0:${String(s).padStart(2, '0')} / 0:20`; if (s >= 20) TV.rec?.stop(); }, 200);
  }
  async function tipRecStopped() {
    clearInterval(TV.timer); TV.stream?.getTracks().forEach((t) => t.stop()); TV.stream = null;
    $('#wTipRec').classList.remove('on');
    TV.dur = Math.min(20, Math.round((Date.now() - TV.t0) / 1000));
    if (TV.dur < 1) return tipRecClear();
    TV.blob = new Blob(TV.chunks, { type: (TV.rec.mimeType || 'audio/webm').split(';')[0] });
    TV.data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(TV.blob); });
    $('#wTipRecPlay').src = URL.createObjectURL(TV.blob); $('#wTipRecPlay').hidden = false; $('#wTipRecX').hidden = false; $('#wTipRec').hidden = true;
    tipSync();
  }
  function tipRecClear() {
    TV.blob = null; TV.data = ''; TV.dur = 0;
    $('#wTipRecPlay').hidden = true; $('#wTipRecPlay').removeAttribute('src'); $('#wTipRecX').hidden = true; $('#wTipRec').hidden = false;
    $('#wTipRecLabel').textContent = 'Add a voice message'; $('#wTipRecTime').textContent = 'up to 20 s';
    tipSync();
  }
  $('#wTipRec').onclick = () => (TV.rec?.state === 'recording' ? TV.rec.stop() : tipRecStart());
  $('#wTipRecX').onclick = tipRecClear;
  const tipBody = () => ({ amount: SC.amount, text: $('#wTipMsg').value.trim(), ...($('#wBounty').checked ? { bounty: true } : {}), ...(TV.data ? { voice: TV.data, dur: TV.dur } : {}) });
  function tipSent() {
    $('#wBounty').checked = false; $('#wTipDock').classList.remove('bounty'); $('#wTipMsg').value = ''; tipRecClear(); closeTipDock();
    awardXp(Math.min(50, 5 + Math.round(SC.amount)));
  }

  // ---- on-site card checkout (Stripe's embedded checkout, on the streamer's own Stripe account)
  let stripeJs = null, checkout = null;
  function loadStripe() {
    stripeJs ||= new Promise((res, rej) => { if (window.Stripe) return res(window.Stripe); const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = () => res(window.Stripe); s.onerror = () => { stripeJs = null; rej(new Error('Couldn’t load the card form. Check your connection.')); }; document.head.append(s); });
    return stripeJs;
  }
  function checkoutClose() { try { checkout?.destroy(); } catch {} checkout = null; $('#wCheckout').hidden = true; replaceKids($('#wCheckout')); $('#wTipDock').classList.remove('paying'); }
  async function payOnSite() {
    showErr('#wTipErr', '');
    if ($('#wBounty').checked && !$('#wTipMsg').value.trim()) { $('#wTipMsg').focus(); return showErr('#wTipErr', 'Type the challenge first.'); }
    const btn = $('#wTipPay'); btn.disabled = true; btn.textContent = 'Opening secure checkout…';
    try {
      await ensureSession();
      if (!app.sess?.named) { if (ACCT.user) await joinSigned(); else { ACCT.then = () => payOnSite(); return openSignIn(); } }
      const [Stripe, r] = await Promise.all([loadStripe(), api('wcheckout', { ...creds(), ...tipBody() })]);
      checkoutClose();
      const box = $('#wCheckout'); box.hidden = false; $('#wTipDock').classList.add('paying');
      const stripe = Stripe(r.pk, { stripeAccount: r.account });
      checkout = await stripe.initEmbeddedCheckout({ fetchClientSecret: async () => r.clientSecret, onComplete: () => checkoutDone(r.id) });
      checkout.mount(box);
    } catch (e) { showErr('#wTipErr', e.message); }
    finally { btn.disabled = false; tipSync(); }
  }
  async function checkoutDone(id) {
    for (let i = 0; i < 8; i++) {
      try { const r = await api('wcheckdone', { ...creds(), sc: id }); if (r.status === 'confirmed') { toast(`Paid! Your $${SC.amount} super chat is on screen.`); tipSent(); poll?.(); return; } } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    toast('Payment received. Your super chat will appear in a moment.');
    tipSent();
  }
  $('#wTipPay').onclick = () => payOnSite();
  $$('button[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));

  $('#wShare').onclick = async () => {
    const url = location.origin + location.pathname;
    try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast(url); }
  };

  return { tierOf, openTipDock, closeTipDock, loadStripe };
}
