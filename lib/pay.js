// On-site card payments for super chats, through Stripe Connect. The streamer connects their own Stripe account once
// (Stripe's hosted onboarding); after that viewers pay by card, Apple Pay or Google Pay inside the watch page
// (Stripe's embedded checkout), the charge is made directly on the streamer's account, and the super chat goes on
// screen by itself as soon as Stripe says it's paid. No "I've paid" step and no host confirmation.
//
// Off unless the server has STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY (the platform account's keys).
// STRIPE_FEE_PCT (default 0) keeps a platform fee from each super chat. STRIPE_API_BASE is for tests.
const API = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
const cleanEnv = (v) => String(v || '').trim().replace(/^['"]|['"]$/g, '').trim();
const SK = () => cleanEnv(process.env.STRIPE_SECRET_KEY);
const PK = () => cleanEnv(
  process.env.STRIPE_PUBLISHABLE_KEY
  || process.env.STRIPE_PUBLIC_KEY
  || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  || process.env.VITE_STRIPE_PUBLISHABLE_KEY
);
function diagnostics() {
  const sk = SK();
  const pk = PK();
  const hasSecret = !!sk;
  const hasPublishable = !!pk;
  let keyError = '';
  if (hasSecret && hasPublishable) {
    const skValid = /^(sk|rk)_(live|test)_/i.test(sk) || !!process.env.STRIPE_API_BASE;
    const pkValid = /^pk_(live|test)_/i.test(pk) || !!process.env.STRIPE_API_BASE;
    if (!skValid) keyError = 'STRIPE_SECRET_KEY must start with sk_live_ or sk_test_.';
    else if (!pkValid) keyError = 'STRIPE_PUBLISHABLE_KEY must start with pk_live_ or pk_test_.';
    else if (/^sk_live_/i.test(sk) && /^pk_test_/i.test(pk)) keyError = 'Stripe key mismatch: secret key is Live mode, publishable key is Test mode.';
    else if (/^sk_test_/i.test(sk) && /^pk_live_/i.test(pk)) keyError = 'Stripe key mismatch: secret key is Test mode, publishable key is Live mode.';
  }
  const available = hasSecret && hasPublishable && !keyError;
  return { available, hasSecret, hasPublishable, ...(keyError ? { keyError } : {}) };
}
const enabled = () => diagnostics().available;
const feePct = () => Math.max(0, Math.min(30, Number(process.env.STRIPE_FEE_PCT) || 0));

/** {a: {b: [{c: 1}]}} → [['a[b][0][c]', '1']], the form encoding Stripe's API takes. */
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push([key, String(v)]);
  }
  return out;
}

function makePay(HttpError) {
  async function stripe(path, params, { method = 'POST', account } = {}) {
    const diag = diagnostics();
    if (!diag.available) throw new HttpError(400, diag.keyError || 'Card payments aren’t set up on this server yet.');
    const qs = params ? new URLSearchParams(form(params)).toString() : '';
    const res = await fetch(`${API()}/v1/${path}${method === 'GET' && qs ? '?' + qs : ''}`, {
      method,
      headers: { Authorization: 'Bearer ' + SK(), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(account ? { 'Stripe-Account': account } : {}) },
      body: method === 'POST' ? qs : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, 'Stripe: ' + (j.error?.message || `error ${res.status}`));
    return j;
  }
  return {
    enabled, diagnostics, pk: PK,
    /** A Stripe Express account for the streamer (created once) and a one-time onboarding link. */
    async connect(acct, { returnUrl, refreshUrl }) {
      const id = acct || (await stripe('accounts', { type: 'express', capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, business_profile: { product_description: 'Live stream super chats and tips' } })).id;
      const link = await stripe('account_links', { account: id, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
      return { acct: id, url: link.url };
    },
    /** Detailed readiness for a connected Express account. */
    async accountStatus(acct) {
      const a = await stripe(`accounts/${encodeURIComponent(acct)}`, null, { method: 'GET' });
      return { ready: !!a.charges_enabled, detailsSubmitted: !!a.details_submitted, payoutsEnabled: !!a.payouts_enabled };
    },
    /** Whether the connected account can take card payments yet. */
    async ready(acct) { return (await this.accountStatus(acct)).ready; },
    /** An embedded checkout for one super chat, charged directly on the streamer's account. */
    async checkout(acct, { cents, title, scId, studio }) {
      const fee = Math.round(cents * feePct() / 100);
      const s = await stripe('checkout/sessions', {
        ui_mode: 'embedded', mode: 'payment', redirect_on_completion: 'never',
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: title } } }],
        metadata: { sc: scId, studio },
        payment_intent_data: { description: title, metadata: { sc: scId, studio }, ...(fee ? { application_fee_amount: fee } : {}) },
      }, { account: acct });
      return { session: s.id, clientSecret: s.client_secret };
    },
    /** Inspects Stripe Checkout Session payment status without trusting client claims. */
    async checkoutSessionStatus(acct, session) {
      const s = await stripe(`checkout/sessions/${encodeURIComponent(session)}`, null, { method: 'GET', account: acct });
      const paid = s.payment_status === 'paid' || s.payment_status === 'no_payment_required';
      const expired = s.status === 'expired';
      return { paid, expired, status: s.status || '', paymentStatus: s.payment_status || '' };
    },
    /** True once the viewer's checkout is paid. */
    async paid(acct, session) { return (await this.checkoutSessionStatus(acct, session)).paid; },
  };
}
module.exports = makePay;
module.exports.form = form;
module.exports.diagnostics = diagnostics;
