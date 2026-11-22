// On-site card payments for super chats, through Stripe Connect. The streamer connects their own Stripe account once
// (Stripe's hosted onboarding); after that viewers pay by card, Apple Pay or Google Pay inside the watch page
// (Stripe's embedded checkout), the charge is made directly on the streamer's account, and the super chat goes on
// screen by itself as soon as Stripe says it's paid. No "I've paid" step and no host confirmation.
//
// Off unless the server has STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY (the platform account's keys).
// STRIPE_FEE_PCT (default 0) keeps a platform fee from each super chat. STRIPE_API_BASE is for tests.
const API = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
const SK = () => process.env.STRIPE_SECRET_KEY || '';
const PK = () => process.env.STRIPE_PUBLISHABLE_KEY || '';
const enabled = () => !!(SK() && PK());
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
    if (!enabled()) throw new HttpError(400, 'Card payments aren’t set up on this server yet.');
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
    enabled, pk: PK,
    /** A Stripe Express account for the streamer (created once) and a one-time onboarding link. */
    async connect(acct, { returnUrl, refreshUrl }) {
      const id = acct || (await stripe('accounts', { type: 'express', capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, business_profile: { product_description: 'Live stream super chats and tips' } })).id;
      const link = await stripe('account_links', { account: id, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
      return { acct: id, url: link.url };
    },
    /** Whether the connected account can take card payments yet. */
    async ready(acct) { const a = await stripe(`accounts/${encodeURIComponent(acct)}`, null, { method: 'GET' }); return !!a.charges_enabled; },
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
    /** True once the viewer's checkout is paid. */
    async paid(acct, session) { const s = await stripe(`checkout/sessions/${encodeURIComponent(session)}`, null, { method: 'GET', account: acct }); return s.payment_status === 'paid'; },
  };
}
module.exports = makePay;
module.exports.form = form;
