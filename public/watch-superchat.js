import { replaceKids } from './ui.js';

// Super chats: the single tray in the chat input (amount, message, voice note).
// Supports direct-to-streamer payouts (Stripe Payment Link, PayPal, Venmo, Cash App, Ko-fi, Patreon, Buy Me a Coffee)
// and optional on-site Stripe Connect Express embedded checkout. 100% of funds go straight to the streamer.
export function createSuperChat(app) {
  const { $, $$, ACCT, W, api, creds, toast, ensureSession, poll, showErr, awardXp, joinSigned, openSignIn } = app;
  // ---------------------------------------------------------------- super chats (single unified inline tray)
  const SC = { amount: 5, method: '', openedDirect: false };

  const DIRECT_INFO = {
    stripe: {
      label: 'Stripe',
      color: '#635bff',
      hint: 'Card, Apple Pay or Google Pay directly into the streamer’s Stripe account.',
      url: (v) => (/^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_-]{4,120}$/.test(v) ? v : ''),
    },
    paypal: {
      label: 'PayPal',
      color: '#0070ba',
      hint: 'Opens PayPal.me with your amount prefilled straight to the streamer.',
      url: (v, a) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://paypal.me/${encodeURIComponent(v)}/${encodeURIComponent(a)}USD` : ''),
    },
    venmo: {
      label: 'Venmo',
      color: '#008cff',
      hint: 'Opens Venmo straight to the streamer’s account.',
      url: (v, a, msg) => (/^[A-Za-z0-9_-]{2,30}$/.test(v) ? `https://venmo.com/u/${encodeURIComponent(v)}?txn=pay&amount=${encodeURIComponent(a)}${msg ? `&note=${encodeURIComponent(msg.slice(0, 80))}` : ''}` : ''),
    },
    cashapp: {
      label: 'Cash App',
      color: '#00d632',
      hint: 'Opens Cash App with your amount prefilled straight to the streamer.',
      url: (v, a) => (/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(v) ? `https://cash.app/$${encodeURIComponent(v)}/${encodeURIComponent(a)}` : ''),
    },
    kofi: {
      label: 'Ko-fi',
      color: '#ff5e5b',
      hint: 'Opens the streamer’s Ko-fi page directly.',
      url: (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://ko-fi.com/${encodeURIComponent(v)}` : ''),
    },
    patreon: {
      label: 'Patreon',
      color: '#f96854',
      hint: 'Opens the streamer’s Patreon page directly.',
      url: (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://www.patreon.com/${encodeURIComponent(v)}` : ''),
    },
    bmc: {
      label: 'Buy Me a Coffee',
      color: '#e5a400',
      hint: 'Opens the streamer’s Buy Me a Coffee page directly.',
      url: (v) => (/^[A-Za-z0-9._-]{1,40}$/.test(v) && !v.includes('..') ? `https://www.buymeacoffee.com/${encodeURIComponent(v)}` : ''),
    },
  };
  const DIRECT_ORDER = ['stripe', 'paypal', 'venmo', 'cashapp', 'kofi', 'patreon', 'bmc'];

  function availableMethods() {
    const w = W.info?.watch || {};
    const list = [];
    if (w.card) list.push('card');
    const pay = w.pay && typeof w.pay === 'object' ? w.pay : {};
    for (const k of DIRECT_ORDER) {
      if (pay[k] && DIRECT_INFO[k]?.url(pay[k], SC.amount, '')) list.push(k);
    }
    return list;
  }
  function openExternalSafe(url) {
    if (!/^https:\/\//i.test(url)) return;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.append(a);
    a.click();
    a.remove();
  }

  const tierOf = (a) => (a >= 50 ? 'rose' : a >= 20 ? 'amber' : a >= 10 ? 'emerald' : 'blue');

  function renderMethodsUI(methods) {
    const hasDirect = methods.some((m) => m !== 'card');
    const existing = $('#wTipMethods');
    if (!hasDirect) {
      existing?.remove();
      return;
    }
    let wrap = existing;
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'wTipMethods';
      wrap.className = 'wv-tipmethods';
      wrap.setAttribute('role', 'radiogroup');
      wrap.setAttribute('aria-label', 'Choose how to pay the streamer directly');
      $('#wTipAmts')?.insertAdjacentElement('afterend', wrap);
    }
    replaceKids(wrap, ...methods.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wv-tipmethod' + (m === SC.method ? ' is-active' : '');
      b.setAttribute('role', 'radio');
      b.dataset.method = m;
      b.setAttribute('aria-checked', String(m === SC.method));
      const dot = document.createElement('i');
      dot.setAttribute('aria-hidden', 'true');
      dot.style.background = m === 'card' ? '#22c55e' : (DIRECT_INFO[m]?.color || '#3b82f6');
      const lbl = document.createElement('span');
      lbl.textContent = m === 'card' ? 'Card (in chat)' : (DIRECT_INFO[m]?.label || m);
      b.append(dot, lbl);
      b.onclick = () => {
        if (SC.method !== m) {
          SC.method = m;
          SC.openedDirect = false;
          showErr('#wTipErr', '');
          tipSync();
        }
      };
      return b;
    }));
  }

  function ensureConfirmBtn(showDirect) {
    const acts = $('.wv-tipacts', $('#wTipDock'));
    if (!acts) return null;
    let btn = $('#wTipConfirm');
    if (!showDirect) {
      btn?.remove();
      return null;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'wTipConfirm';
      btn.className = 'btn wv-tipconfirm';
      btn.onclick = () => submitDirectSuper();
      acts.append(btn);
    }
    const hostName = W.info?.host?.name || 'host';
    btn.className = 'btn wv-tipconfirm ' + (SC.openedDirect ? 'primary' : 'ghost');
    btn.textContent = SC.openedDirect ? `I paid — send to ${hostName}` : 'Already paid? Send to host';
    return btn;
  }

  function tipRender() {
    const w = W.info?.watch || {};
    const min = w.min || 2;
    SC.amount = Math.max(SC.amount, min);
    const methods = availableMethods();
    if (!methods.includes(SC.method)) {
      SC.method = methods[0] || '';
      SC.openedDirect = false;
    }
    const amounts = [...new Set([min, 5, 10, 20, 50, 100].filter((a) => a >= min))].slice(0, 5);
    replaceKids($('#wTipAmts'), ...amounts.map((a) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.tier = tierOf(a); b.className = 'num'; b.textContent = '$' + a;
      b.setAttribute('aria-checked', String(a === SC.amount)); b.onclick = () => { SC.amount = a; SC.openedDirect = false; const c = $('#wTipCustom'); if (c) c.value = ''; tipRender(); };
      return b;
    }), (() => {
      const c = Object.assign(document.createElement('input'), { className: 'input num', id: 'wTipCustom', type: 'number', min: String(min), max: '10000', step: '1', placeholder: 'Other', inputMode: 'decimal' });
      c.setAttribute('aria-label', 'Other amount in dollars');
      if (!amounts.includes(SC.amount)) c.value = String(SC.amount);
      c.oninput = () => { const v = Math.round(Number(c.value)); if (v >= min) { SC.amount = v; SC.openedDirect = false; tipSync(); } };
      return c;
    })());
    renderMethodsUI(methods);
    $('#wTipSub').textContent = `100% paid straight to ${W.info?.host?.name || 'the streamer'}`;
    $('#wTipRec').hidden = true;
    const bountiesAllowed = w.bounties !== false;
    if ($('#wBountyWrap')) $('#wBountyWrap').hidden = !bountiesAllowed;
    if (!bountiesAllowed && $('#wBounty')) {
      $('#wBounty').checked = false;
      $('#wTipDock')?.classList.remove('bounty');
    }
    tipSync();
  }

  function tipSync() {
    const methods = availableMethods();
    if (!methods.includes(SC.method)) SC.method = methods[0] || '';
    const isCard = SC.method === 'card';
    const info = DIRECT_INFO[SC.method];
    const hostName = W.info?.host?.name || 'the streamer';

    $$('#wTipAmts button').forEach((b) => b.setAttribute('aria-checked', String(b.textContent === '$' + SC.amount)));
    $$('#wTipMethods button').forEach((b) => {
      const on = b.dataset.method === SC.method;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-active', on);
    });
    $('#wTipDock').dataset.tier = tierOf(SC.amount);
    $('#wTipDock').classList.toggle('onsite', isCard);
    $('#wTipDock').classList.toggle('direct-pay', !isCard && !!info);

    const payBtn = $('#wTipPay');
    if (isCard) {
      payBtn.className = 'btn primary wv-tippay';
      payBtn.textContent = `Pay $${SC.amount}`;
      ensureConfirmBtn(false);
    } else if (info) {
      payBtn.className = 'btn ' + (SC.openedDirect ? 'ghost' : 'primary') + ' wv-tippay';
      payBtn.textContent = SC.openedDirect ? `Open ${info.label} again ↗` : `Pay $${SC.amount} via ${info.label} ↗`;
      ensureConfirmBtn(true);
    }

    const msg = $('#wTipMsg').value.trim();
    $('#wTipCount').textContent = `${$('#wTipMsg').value.length}/${$('#wTipMsg').maxLength}`;
    if (isCard) {
      $('#wTipNote').textContent = $('#wBounty')?.checked
        ? (msg ? `Bounty: “${msg.slice(0, 60)}${msg.length > 60 ? '…' : ''}”, on stream once it’s paid.` : 'Type the challenge above, e.g. “win a round with pistols only”.')
        : `Card, Apple Pay or Google Pay, right here. Your ${TV.blob ? 'voice message' : msg ? 'message' : 'super chat'} goes on screen the moment it’s paid.`;
    } else if (info) {
      $('#wTipNote').textContent = SC.openedDirect
        ? `Finished paying ${hostName} on ${info.label}? Tap “I paid — send to ${hostName}” so they can confirm and put it on screen.`
        : `${info.hint} Then tap “I paid” so ${hostName} can confirm and put your ${$('#wBounty')?.checked ? 'bounty' : 'super chat'} on screen.`;
    }
  }

  function openTipDock() {
    const w = W.info?.watch || {};
    if (!w.supers) return;
    showErr('#wTipErr', '');
    SC.openedDirect = false;
    $('#wTipDock').hidden = false; $('#wTipBtn').setAttribute('aria-expanded', 'true'); $('#wTipBtn').classList.add('on');
    $('#wTipMsg').value ||= $('#wText').value.trim(); // anything typed in the chat box comes along
    tipRender();
    setTimeout(() => $('#wTipMsg').focus(), 30);
  }
  function closeTipDock() {
    $('#wTipDock').hidden = true; $('#wTipBtn').setAttribute('aria-expanded', 'false'); $('#wTipBtn').classList.remove('on');
    SC.openedDirect = false;
    checkoutClose(); if (TV.rec?.state === 'recording') TV.rec.stop();
  }
  function syncLive() {
    if ($('#wTipDock').hidden) return;
    const w = W.info?.watch || {};
    const methods = availableMethods();
    if (!methods.includes(SC.method)) {
      SC.method = methods[0] || '';
      SC.openedDirect = false;
    }
    renderMethodsUI(methods);
    const bountiesAllowed = w.bounties !== false;
    if ($('#wBountyWrap')) $('#wBountyWrap').hidden = !bountiesAllowed;
    if (!bountiesAllowed && $('#wBounty')) {
      $('#wBounty').checked = false;
      $('#wTipDock')?.classList.remove('bounty');
    }
    tipSync();
  }
  $('#wTipBtn').onclick = () => {
    if (!W.info?.watch?.supers) return toast('Tips aren’t on for this show yet.');
    return $('#wTipDock').hidden ? openTipDock() : closeTipDock();
  };
  $('#wTipX').onclick = closeTipDock;
  $('#wBounty').addEventListener('change', () => { $('#wTipDock').classList.toggle('bounty', $('#wBounty').checked); tipSync(); });
  $('#wTipMsg').addEventListener('input', () => tipSync());

  // ---- voice message attached to a super chat (up to 20 s)
  const TV = { rec: null, chunks: [], stream: null, t0: 0, timer: null, blob: null, data: '', dur: 0 };
  async function tipRecStart() {
    showErr('#wTipErr', 'Microphone access is only enabled inside the studio.');
  }
  async function tipRecStopped() {
    clearInterval(TV.timer); TV.stream?.getTracks().forEach((t) => t.stop()); TV.stream = null;
    $('#wTipRec').classList.remove('on');
  }
  function tipRecClear() {
    TV.blob = null; TV.data = ''; TV.dur = 0;
    $('#wTipRecPlay').hidden = true; $('#wTipRecPlay').removeAttribute('src'); $('#wTipRecX').hidden = true; $('#wTipRec').hidden = true;
    $('#wTipRecLabel').textContent = 'Add a voice message'; $('#wTipRecTime').textContent = 'up to 20 s';
    tipSync();
  }
  $('#wTipRec').onclick = () => (TV.rec?.state === 'recording' ? TV.rec.stop() : tipRecStart());
  $('#wTipRecX').onclick = tipRecClear;
  const tipBody = () => ({ amount: SC.amount, text: $('#wTipMsg').value.trim(), ...($('#wBounty').checked ? { bounty: true } : {}), ...(TV.data ? { voice: TV.data, dur: TV.dur } : {}) });
  function tipSent(paidAmount = SC.amount, grantXp = true) {
    $('#wBounty').checked = false; $('#wTipDock').classList.remove('bounty'); $('#wTipMsg').value = ''; tipRecClear(); closeTipDock();
    if (grantXp) awardXp(Math.min(50, 5 + Math.round(Number(paidAmount) || SC.amount)));
  }

  // ---- Direct-to-streamer external payment (Stripe link, PayPal, Venmo, Cash App, Ko-fi, Patreon, Buy Me a Coffee)
  async function payDirect() {
    showErr('#wTipErr', '');
    if ($('#wBounty').checked && !$('#wTipMsg').value.trim()) { $('#wTipMsg').focus(); return showErr('#wTipErr', 'Type the challenge first.'); }
    const info = DIRECT_INFO[SC.method];
    const handle = W.info?.watch?.pay?.[SC.method];
    const url = info && handle ? info.url(handle, SC.amount, $('#wTipMsg').value.trim()) : '';
    if (!url) return showErr('#wTipErr', 'That payout account isn’t available right now.');
    try {
      await ensureSession();
      if (!app.sess?.named) { if (ACCT.user) await joinSigned(); else { ACCT.then = () => payDirect(); return openSignIn(); } }
    } catch (e) {
      return showErr('#wTipErr', e.message);
    }
    openExternalSafe(url);
    SC.openedDirect = true;
    tipSync();
  }

  async function submitDirectSuper() {
    showErr('#wTipErr', '');
    if ($('#wBounty').checked && !$('#wTipMsg').value.trim()) { $('#wTipMsg').focus(); return showErr('#wTipErr', 'Type the challenge first.'); }
    const info = DIRECT_INFO[SC.method];
    if (!info) return;
    const paidAmount = SC.amount;
    const isBounty = !!$('#wBounty')?.checked;
    const btn = $('#wTipConfirm');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending to host…'; }
    try {
      await ensureSession();
      if (!app.sess?.named) { if (ACCT.user) await joinSigned(); else { ACCT.then = () => submitDirectSuper(); return openSignIn(); } }
      await api('wsend', { ...creds(), type: 'super', method: SC.method, ...tipBody() });
      const hostName = W.info?.host?.name || 'the streamer';
      toast(`Sent to ${hostName}! Your $${paidAmount} ${isBounty ? 'bounty' : 'super chat'} goes on screen as soon as they confirm receipt.`);
      tipSent(paidAmount, false);
      poll?.();
    } catch (e) {
      showErr('#wTipErr', e.message);
    } finally {
      if (btn) btn.disabled = false;
      tipSync();
    }
  }

  // ---- on-site card checkout (Stripe's embedded checkout, on the streamer's own Stripe account)
  let stripeJs = null, checkout = null;
  const pendingKey = () => `gather:pending-sc:${W.code || location.pathname}`;
  const savePendingSc = (p) => { try { sessionStorage.setItem(pendingKey(), JSON.stringify(p)); } catch {} };
  const readPendingSc = () => { try { const v = JSON.parse(sessionStorage.getItem(pendingKey()) || 'null'); return v && Date.now() - (v.ts || 0) < 15 * 60e3 ? v : null; } catch { return null; } };
  const clearPendingSc = () => { try { sessionStorage.removeItem(pendingKey()); } catch {} };

  function loadStripe() {
    stripeJs ||= new Promise((res, rej) => { if (window.Stripe) return res(window.Stripe); const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = () => res(window.Stripe); s.onerror = () => { stripeJs = null; rej(new Error('Couldn’t load the card form. Check your connection.')); }; document.head.append(s); });
    return stripeJs;
  }
  function destroyCheckoutMount() { try { checkout?.destroy(); } catch {} checkout = null; }
  function checkoutClose() { destroyCheckoutMount(); $('#wCheckout').hidden = true; replaceKids($('#wCheckout')); $('#wTipDock').classList.remove('paying'); }
  function renderCheckoutState(kind, title, detail, retryFn = null) {
    const box = $('#wCheckout'); if (!box) return;
    box.hidden = false;
    const card = document.createElement('div');
    card.className = 'wv-co-status is-' + kind;
    const h = document.createElement('b'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = detail;
    card.append(h, p);
    if (retryFn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn sm primary'; b.textContent = 'Check payment status';
      b.onclick = retryFn;
      card.append(b);
    }
    replaceKids(box, card);
  }
  async function payOnSite() {
    showErr('#wTipErr', '');
    if ($('#wBounty').checked && !$('#wTipMsg').value.trim()) { $('#wTipMsg').focus(); return showErr('#wTipErr', 'Type the challenge first.'); }
    const paidAmount = SC.amount;
    const isBounty = !!$('#wBounty')?.checked;
    const btn = $('#wTipPay'); btn.disabled = true; btn.textContent = 'Opening secure checkout…';
    try {
      await ensureSession();
      if (!app.sess?.named) { if (ACCT.user) await joinSigned(); else { ACCT.then = () => payOnSite(); return openSignIn(); } }
      const [Stripe, r] = await Promise.all([loadStripe(), api('wcheckout', { ...creds(), ...tipBody() })]);
      checkoutClose();
      savePendingSc({ id: r.id, amount: paidAmount, bounty: isBounty, ts: Date.now() });
      const box = $('#wCheckout'); box.hidden = false; $('#wTipDock').classList.add('paying');
      const stripe = Stripe(r.pk, r.account ? { stripeAccount: r.account } : undefined);
      checkout = await stripe.initEmbeddedCheckout({
        fetchClientSecret: async () => r.clientSecret,
        onComplete: () => checkoutDone(r.id, paidAmount, isBounty),
      });
      checkout.mount(box);
    } catch (e) { showErr('#wTipErr', e.message); }
    finally { btn.disabled = false; tipSync(); }
  }
  async function checkoutDone(id, paidAmount = SC.amount, isBounty = false, { silent = false } = {}) {
    destroyCheckoutMount();
    if (!silent) {
      $('#wTipDock').classList.add('paying');
      renderCheckoutState('verifying', 'Confirming payment with Stripe…', 'Your super chat will appear on screen as soon as Stripe confirms.');
    }
    let lastErr = '';
    const maxAttempts = silent ? 3 : 12;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const r = await api('wcheckdone', { ...creds(), sc: id });
        if (r.status === 'confirmed' || r.status === 'answered') {
          clearPendingSc();
          const finalAmt = Number(r.item?.amount) || paidAmount;
          const label = (r.item?.bounty || isBounty) ? 'bounty' : 'super chat';
          if (!silent) {
            renderCheckoutState('confirmed', `$${finalAmt} ${label} sent!`, 'It’s live in chat and on the stream.');
            await new Promise((res) => setTimeout(res, 900));
          }
          toast(`Paid! Your $${finalAmt} ${label} is on screen.`);
          tipSent(finalAmt);
          poll?.();
          return;
        }
        if (r.status === 'expired') {
          clearPendingSc();
          if (!silent) {
            checkoutClose();
            showErr('#wTipErr', 'That checkout session expired before payment completed. No charge was made.');
          }
          return;
        }
      } catch (e) {
        lastErr = e?.message || '';
        if (/404|not found|couldn’t find/i.test(lastErr)) { clearPendingSc(); break; }
      }
      await new Promise((r) => setTimeout(r, i < 3 ? 1000 : 1500));
    }
    if (!silent) {
      renderCheckoutState(
        'pending',
        'Still waiting for Stripe confirmation',
        lastErr || 'Your card was submitted — tap below to re-check or wait a moment for it to appear in chat.',
        () => checkoutDone(id, paidAmount, isBounty),
      );
      poll?.();
    }
  }
  // Recover an in-flight super chat payment if the viewer reloaded right after Stripe completed (e.g. Apple Pay / 3DS).
  setTimeout(async () => {
    const pending = readPendingSc();
    if (!pending?.id) return;
    try {
      await ensureSession();
      if (app.sess?.vid) checkoutDone(pending.id, pending.amount, !!pending.bounty, { silent: true });
    } catch {}
  }, 1800);

  $('#wTipPay').onclick = () => (SC.method === 'card' ? payOnSite() : payDirect());
  $$('button[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));

  $('#wShare').onclick = async () => {
    const url = location.origin + location.pathname;
    try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast(url); }
  };

  return { tierOf, openTipDock, closeTipDock, loadStripe, syncLive };
}
