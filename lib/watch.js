// The public watch page (/w/<studio>): viewers watch, chat, react, send super chats paid straight to the host
// (PayPal, Venmo, Cash App or a Stripe payment link), and ask to join the stage. No accounts.
//
// Cost model: the feed every viewer reads (`wfeed`) is identical for everyone and served as a GET with a 2-second
// CDN cache, so a thousand viewers cost about one function call every 2 seconds. Only writes (chat, reactions,
// super chats) and a 30-second presence ping are per viewer.
//
// Payments never touch gather. A super chat is a *claim* until the host checks their own PayPal/Venmo/Cash App and
// taps Confirm; only then does it appear as paid in the public chat or go on stage.
module.exports = function makeWatch({ store, K, clean, parse, deliver, loadMembers, HttpError, cleanCode, rid, num }) {
  const pay = require('./pay')(HttpError);
  const VOICE_RE = /^data:audio\/(webm|ogg|mp4|mpeg|wav)[^;,]*(;[a-z0-9=.-]+)*;base64,[A-Za-z0-9+/=]+$/i;
  const TTL = 6 * 3600;
  const REACTS = ['❤️', '🔥', '😂', '👏', '🎉', '😮'];
  const METHODS = ['paypal', 'venmo', 'cashapp', 'stripe'];
  const WK = (code) => ({ chat: `g:${code}:wchat`, viewers: `g:${code}:viewers`, sc: `g:${code}:sc`, rl: (v) => `g:${code}:wrl:${v}`, react: (b, i) => `g:${code}:wr:${b}:${i}` });
  const bucket = (t = Date.now()) => Math.floor(t / 10_000);

  async function stateOf(code) { const [st] = await store.pipe([['GET', K(code).state]]); return parse(st); }
  /** What a viewer may see of the host's watch settings (payment handles are public by nature). */
  function publicWatch(st, card = false) {
    const w = st?.watch || {};
    return { card: !!(w.supers && card), pk: w.supers && card ? pay.pk() : '', chat: w.chat !== false, supers: !!w.supers && (card || METHODS.some((m) => w.pay?.[m])), join: !!w.join, voice: w.voice !== false, min: w.min || 2, slow: w.slow || 0, pay: w.pay || {}, about: w.about || '', links: w.links || [], pin: w.pin || '', lobby: w.lobby || '', rig: w.rig || '', goal: w.goal?.target > 0 ? { label: w.goal.label || '', target: w.goal.target } : null };
  }
  async function viewer(code, body) {
    const vid = String(body.vid || '').replace(/[^a-f0-9]/g, '').slice(0, 16);
    const [raw] = vid ? await store.pipe([['HGET', WK(code).viewers, vid]]) : [null];
    const v = parse(raw);
    if (!v || v.tok !== body.vtok) throw new HttpError(401, 'Your chat session ended. Reload the page to rejoin the chat.');
    v.seen = Date.now();
    await store.pipe([['HSET', WK(code).viewers, vid, JSON.stringify(v)], ['EXPIRE', WK(code).viewers, TTL]]);
    return { vid, ...v };
  }
  function muted(st, name) {
    const mod = st?.mod || {}, user = String(name).toLowerCase(), now = Date.now();
    if ((mod.blocked || []).some((b) => b.user === user && (b.src === 'watch' || b.src === 'studio'))) return 'The host has blocked you from chatting.';
    const t = (mod.timeouts || []).find((x) => x.user === user && x.until > now);
    return t ? `You’re timed out for ${Math.ceil((t.until - now) / 60000)} more minute(s).` : '';
  }

  return {
    /** Public and cacheable: everything a viewer's page needs, identical for every viewer. */
    async wfeed(body) {
      const code = cleanCode(body.studio);
      if (!code) throw new HttpError(400, 'That watch link is missing its studio code.');
      const k = WK(code), b = bucket();
      const [st0] = await store.pipe([['GET', K(code).state]]);
      const pollId = parse(st0)?.poll?.id || 'none';
      const [st, chat, viewers, scs, caps, likes, reps, votes, queue, dels, stripeRaw, ...rc] = await store.pipe([
        ['GET', K(code).state], ['LRANGE', k.chat, -80, -1], ['HGETALL', k.viewers], ['HGETALL', k.sc], ['LRANGE', `g:${code}:wcap`, -3, -1],
        ['HGETALL', `g:${code}:wlikes`], ['HGETALL', `g:${code}:wrep`], ['HGETALL', `g:${code}:wpoll:${pollId}`], ['HGETALL', `g:${code}:wq`], ['HGETALL', `g:${code}:wdel`], ['GET', `g:${code}:stripe`],
        ...REACTS.flatMap((_, i) => [['GET', k.react(b, i)], ['GET', k.react(b - 1, i)]]),
      ]);
      const s = parse(st);
      if (!s) return { found: false, at: Date.now() };
      const now = Date.now();
      let count = 0; const here = [];
      for (let i = 1; i < (viewers || []).length; i += 2) { const v = parse(viewers[i]); if (v && now - v.seen < 45_000) { count++; if (v.named && here.length < 12) here.push(v.name); } }
      const status = {}; let raised = 0;
      for (let i = 0; i < (scs || []).length; i += 2) { const x = parse(scs[i + 1]); if (x) { status[scs[i]] = x.status; if (x.status === 'confirmed' || x.status === 'answered') raised += Number(x.amount) || 0; } }
      const hidden = new Set(s.mod?.hidden || []);
      const pairs = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]; return o; };
      const likeN = pairs(likes), repN = pairs(reps), delN = pairs(dels);
      for (const id of Object.keys(delN)) hidden.add(id); // deleted by the viewer who wrote it
      // Three spam reports hide a message for everyone until the host restores it.
      const items = (chat || []).map((x) => parse(x)).filter((x) => x && !hidden.has(x.id) && !muted(s, x.name) && !(Number(repN[x.id] || 0) >= 3 && !x.paid))
        .map((x) => ({ ...(x.sc ? { ...x, status: status[x.sc] || x.status } : x), likes: Number(likeN[x.id] || 0) }));
      // Messages viewers already have on screen that should go: deleted, hidden by the host, or reported away.
      const gone = [...hidden, ...Object.keys(repN).filter((id) => Number(repN[id]) >= 3)].slice(-150);
      const pv = pairs(votes), poll = s.poll ? { ...s.poll, counts: s.poll.opts.map((_, i) => Number(pv[i] || 0)) } : null;
      const q = Object.values(pairs(queue)).map((x) => parse(x)).filter(Boolean).sort((a, b) => a.ts - b.ts);
      const reacts = Object.fromEntries(REACTS.map((e, i) => [e, Number(rc[i * 2] || 0) + Number(rc[i * 2 + 1] || 0)]));
      const f = s.featured;
      return {
        found: true, at: now, gone, title: clean(s.title, 100), color: /^#[0-9a-f]{6}$/i.test(s.brand?.color || '') ? s.brand.color : null,
        streamType: ['live', 'shopping', 'gamer'].includes(s.streamType) ? s.streamType : 'live',
        hashtags: Array.isArray(s.hashtags) ? s.hashtags : [],
        brandLogo: s.brand?.logo || '',
        notices: Array.isArray(s.notices) ? s.notices : [],
        whatNext: s.whatNext || null,
        aiSpotlight: s.aiSpotlight || null,
        live: s.live || null, rec: !!s.rec?.on, watch: publicWatch(s, pay.enabled() && !!parse(stripeRaw)?.ready), chat: items, viewers: count, here, reacts, raised: Math.round(raised * 100) / 100,
        caps: (caps || []).map((x) => parse(x)).filter((x) => x && now - x.ts < 15_000), capsOnStage: !!s.captions?.on, aspect: s.aspect || '16:9',
        shop: s.shop || null, poll, emotes: s.emotes || [], focus: s.focus ?? 0.5,
        score: (() => { const e = (s.elements || []).find((x) => x?.type === 'score' && !x.hidden); return e ? { a: e.a, b: e.b, sa: e.sa, sb: e.sb, round: e.round || '', map: e.map || '', ca: e.ca, cb: e.cb } : null; })(),
        queue: { open: !!s.watch?.queue, size: q.filter((x) => x.status !== 'called').length, up: q.filter((x) => x.status !== 'called').slice(0, 5).map((x) => x.name) },
        featured: f ? { id: f.id, name: f.name, text: f.text, src: f.src, paid: f.paid || '' } : null,
        bounties: (s.bounties || []).filter((b) => b.status === 'active' || Date.now() - (b.endedAt || 0) < 10 * 60e3).slice(-6),
      };
    },

    /** A viewer picks a name for the chat. Returns a private token for their later messages. */
    async whello(body) {
      const code = cleanCode(body.studio);
      // A signed-in viewer chats under their account name, with a small avatar the page made from their photo.
      let acct = null;
      if (body.acct) { try { acct = await require('./accounts').authUser(String(body.acct)); } catch { throw new HttpError(401, 'Your sign-in ended. Sign in again to chat.'); } }
      const name = acct ? clean(acct.name, 24) : clean(body.name, 24);
      const av = typeof body.av === 'string' && body.av.length <= 9000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.av) ? body.av : '';
      const extra = acct ? { uid: acct.id, ...(av ? { av } : {}) } : {};
      if (!code) throw new HttpError(400, 'Missing studio code.');
      if (!name) throw new HttpError(400, 'Pick a name for the chat.');
      if (/^(host|admin|mod|moderator|gather)$/i.test(name)) throw new HttpError(400, 'Pick another name: that one is reserved.');
      const st = await stateOf(code);
      if (!st) throw new HttpError(404, 'This show isn’t on right now.');
      const why = muted(st, name);
      if (why) throw new HttpError(403, why);
      // Renaming an existing session keeps its id, so the viewer's video connection survives choosing a chat name.
      if (body.vid && body.vtok) {
        const v = await viewer(code, body).catch(() => null);
        if (v) { await store.pipe([['HSET', WK(code).viewers, v.vid, JSON.stringify({ name, tok: v.tok, seen: Date.now(), named: true, ...extra })]]); return { vid: v.vid, vtok: v.tok, name, signed: !!acct }; }
      }
      const vid = rid(8), tok = rid(12);
      await store.pipe([['HSET', WK(code).viewers, vid, JSON.stringify({ name, tok, seen: Date.now(), ...(acct ? { named: true } : {}), ...extra })], ['EXPIRE', WK(code).viewers, TTL]]);
      return { vid, vtok: tok, name, signed: !!acct };
    },

    /** Presence: keeps the viewer counted. Also tells a queued player when the host calls them. */
    async wping(body) {
      const code = cleanCode(body.studio); const v = await viewer(code, body);
      const [raw] = await store.pipe([['HGET', `g:${code}:wq`, v.vid]]);
      const qe = parse(raw);
      return { ok: true, queue: qe ? { status: qe.status || 'waiting' } : null };
    },
    /** Public: a custom emote's image, only for emotes the host has published. */
    async wemote(body) {
      const code = cleanCode(body.studio), id = String(body.asset || '').replace(/[^a-z0-9]/g, '').slice(0, 40);
      const st = await stateOf(code);
      if (!st || !(st.emotes || []).some((e) => e.asset === id)) throw new HttpError(404, 'No such emote.');
      const [data] = await store.pipe([['GET', `g:${code}:asset:${id}`]]);
      if (!data) throw new HttpError(404, 'No such emote.');
      return { data };
    },

    /** A viewer's chat message, reaction or super chat claim. */
    async wsend(body) {
      const code = cleanCode(body.studio), k = WK(code);
      const v = await viewer(code, body);
      const st = await stateOf(code);
      if (!st) throw new HttpError(404, 'This show isn’t on right now.');
      const w = publicWatch(st);
      const members = await loadMembers(code);
      // One-tap actions that never use the slow-mode slot.
      if (['like', 'report', 'delete', 'vote', 'queue', 'unqueue'].includes(body.type)) return tapAction(code, st, v, body, members);
      if (body.type === 'voice') return voiceQuestion(code, st, v, body, members);
      if (body.type === 'react') {
        const i = REACTS.indexOf(body.emoji);
        if (i < 0) throw new HttpError(400, 'Unknown reaction.');
        const key = k.react(bucket(), i);
        await store.pipe([['INCR', key], ['EXPIRE', key, 40]]);
        if (members.size) await deliver(code, members, { type: 'react', emoji: body.emoji });
        return { ok: true };
      }
      const why = muted(st, v.name);
      if (why) throw new HttpError(403, why);
      // Check the request first, so a refused one (wrong amount, chat off) doesn't use up the viewer's slow-mode slot.
      let method = '', text = '';
      if (body.type === 'super') {
        if (!w.supers) throw new HttpError(400, 'Super chats are off for this show.');
        method = METHODS.includes(body.method) && w.pay[body.method] ? body.method : '';
        if (!method) throw new HttpError(400, 'Pick how you paid.');
        superCheck(w, body);
      } else {
        if (!w.chat) throw new HttpError(400, 'Chat is off for this show.');
        text = clean(body.text, 300);
        if (!text) throw new HttpError(400, 'Type a message first.');
      }
      const [fresh] = await store.pipe([['SET', k.rl(v.vid), '1', 'NX', 'EX', Math.max(1, w.slow)]]);
      if (!fresh) throw new HttpError(429, w.slow ? `Slow mode: one message every ${w.slow} s.` : 'Slow down a little.');
      if (body.type === 'super') {
        const sc = await superSave(code, v, body, method, 'pending');
        await toHost(code, members, { type: 'superchat', item: sc });
        return { id: sc.id, status: 'pending' };
      }
      const item = { id: 'w-' + rid(5), src: 'watch', name: v.name, text, ts: Date.now(), ...(v.av ? { av: v.av } : {}), ...(v.uid ? { signed: true } : {}), ...(body.type === 'question' ? { q: true } : {}), ...(body.re && typeof body.re === 'object' && clean(body.re.n, 24) ? { re: { n: clean(body.re.n, 24), t: clean(body.re.t, 80) } } : {}) };
      await store.pipe([['RPUSH', k.chat, JSON.stringify(item)], ['LTRIM', k.chat, -200, -1], ['EXPIRE', k.chat, TTL], ['HSET', `g:${code}:wown`, item.id, v.vid], ['EXPIRE', `g:${code}:wown`, TTL]]);
      if (members.size) await deliver(code, members, { type: 'feed', items: [item] });
      return { id: item.id };
    },

    /** Host only (called from studio.send): confirm, dismiss or mark a super chat answered. */
    async hostSuperchat(code, op, members) {
      const k = WK(code);
      const [raw] = await store.pipe([['HGET', k.sc, String(op.id || '')]]);
      const sc = parse(raw);
      if (!sc) return null;
      const next = { confirm: 'confirmed', dismiss: 'dismissed', answered: 'answered' }[op.do];
      if (!next) return null;
      if (sc.status === 'paying') return null; // a card checkout still in progress confirms itself
      const wasPublic = sc.status === 'confirmed' || sc.status === 'answered';
      sc.status = next;
      await store.pipe([['HSET', k.sc, sc.id, JSON.stringify(sc)]]);
      if (next === 'confirmed' && !wasPublic) await superPublish(code, sc, members);
      return sc;
    },

    /** Viewer: start an on-site card payment for a super chat (Stripe embedded checkout on the streamer's account). */
    async wcheckout(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const st = await stateOf(code);
      if (!st) throw new HttpError(404, 'This show isn’t on right now.');
      const [raw] = await store.pipe([['GET', `g:${code}:stripe`]]);
      const acct = parse(raw);
      const w = publicWatch(st, pay.enabled() && !!acct?.ready);
      if (!w.card) throw new HttpError(400, 'This streamer doesn’t take cards here yet.');
      const why = muted(st, v.name); if (why) throw new HttpError(403, why);
      const amount = superCheck(w, body);
      const [fresh] = await store.pipe([['SET', `g:${code}:wco:${v.vid}`, '1', 'NX', 'EX', 5]]);
      if (!fresh) throw new HttpError(429, 'One moment…');
      const sc = await superSave(code, v, body, 'card', 'paying');
      const hostName = clean(st.title, 60) || 'the stream';
      const co = await pay.checkout(acct.acct, { cents: Math.round(amount * 100), title: `$${amount} super chat · ${hostName}`, scId: sc.id, studio: code });
      sc.cs = co.session;
      await store.pipe([['HSET', WK(code).sc, sc.id, JSON.stringify(sc)]]);
      return { id: sc.id, clientSecret: co.clientSecret, account: acct.acct, pk: pay.pk() };
    },
    /** Viewer: after paying. Asks Stripe, and if it's paid the super chat goes on screen right away. */
    async wcheckdone(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const id = String(body.sc || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
      const [raw, acctRaw] = await store.pipe([['HGET', WK(code).sc, id], ['GET', `g:${code}:stripe`]]);
      const sc = parse(raw), acct = parse(acctRaw);
      if (!sc || sc.vid !== v.vid) throw new HttpError(404, 'We couldn’t find that super chat.');
      if (sc.status !== 'paying') return { status: sc.status };
      if (!acct?.acct || !sc.cs || !(await pay.paid(acct.acct, sc.cs))) return { status: 'paying' };
      // one confirmation even if the page asks twice at once
      const [first] = await store.pipe([['SET', `g:${code}:scok:${sc.id}`, '1', 'NX', 'EX', TTL]]);
      if (!first) return { status: 'confirmed' };
      sc.status = 'confirmed'; sc.auto = true;
      await store.pipe([['HSET', WK(code).sc, sc.id, JSON.stringify(sc)]]);
      const members = await loadMembers(code);
      await superPublish(code, sc, members);
      await toHost(code, members, { type: 'superchat', item: sc });
      return { status: 'confirmed' };
    },
    /** Public: a super chat's voice clip, once it's on screen. */
    async wscvoice(body) {
      const code = cleanCode(body.studio), id = String(body.sc || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
      const [raw, data] = await store.pipe([['HGET', WK(code).sc, id], ['GET', `g:${code}:scv:${id}`]]);
      const sc = parse(raw);
      if (!sc || !data || (sc.status !== 'confirmed' && sc.status !== 'answered')) throw new HttpError(404, 'That voice message isn’t available.');
      return { data };
    },
    /** Host: a pending super chat's voice clip, to check before confirming. */
    async hostScVoice(code, id) { const [d] = await store.pipe([['GET', `g:${code}:scv:${String(id || '').replace(/[^a-z0-9-]/gi, '')}`]]); return d; },
    /** Host: connect Stripe for on-site card payments. */
    async hostPayConnect(code, urls) {
      const [raw] = await store.pipe([['GET', `g:${code}:stripe`]]);
      const cur = parse(raw);
      const { acct, url } = await pay.connect(cur?.acct, urls);
      await store.pipe([['SET', `g:${code}:stripe`, JSON.stringify({ acct, ready: !!cur?.ready && cur.acct === acct })]]);
      return { url };
    },
    async hostPayStatus(code) {
      if (!pay.enabled()) return { available: false };
      const [raw] = await store.pipe([['GET', `g:${code}:stripe`]]);
      const cur = parse(raw);
      if (!cur?.acct) return { available: true, connected: false };
      const ready = await pay.ready(cur.acct).catch(() => cur.ready);
      if (ready !== cur.ready) await store.pipe([['SET', `g:${code}:stripe`, JSON.stringify({ ...cur, ready })]]);
      return { available: true, connected: true, ready };
    },
    async hostPayDisconnect(code) { await store.pipe([['DEL', `g:${code}:stripe`]]); return { ok: true }; },
    async hostSuperchats(code) {
      const [flat] = await store.pipe([['HGETALL', WK(code).sc]]);
      const out = [];
      for (let i = 1; i < (flat || []).length; i += 2) { const x = parse(flat[i]); if (x && x.status !== 'paying') out.push(x); }
      return out.sort((a, b) => a.ts - b.ts);
    },
    // ---- direct WebRTC viewing: the host's browser sends the program to each viewer, no platform in between ----
    // Signalling only goes through gather (offers, answers, ICE); the video flows browser to browser (or via TURN).
    // A laptop can encode and upload the program for a handful of viewers, so the host sets a cap (default 6).

    /** A viewer asks for the live picture. */
    async wrtcJoin(body, iceServers) {
      const code = cleanCode(body.studio), k = WK(code);
      const v = await viewer(code, body);
      const st = await stateOf(code);
      const members = await loadMembers(code);
      const [host] = await store.pipe([['GET', K(code).host]]);
      const h = members.get(host);
      if (!st || !h) throw new HttpError(404, 'The host isn’t in the studio right now.');
      const cap = st.watch?.direct === false ? 0 : num(st.watch?.cap, 0, 30, 6);
      if (!cap) return { full: true, reason: 'off' };
      const [flat] = await store.pipe([['HGETALL', `g:${code}:wv`]]);
      const now = Date.now(); let active = 0;
      for (let i = 0; i < (flat || []).length; i += 2) if (flat[i] !== v.vid && now - Number(flat[i + 1]) < 30_000) active++;
      if (active >= cap) return { full: true, reason: 'cap', cap };
      await store.pipe([['HSET', `g:${code}:wv`, v.vid, String(now)], ['EXPIRE', `g:${code}:wv`, TTL], ['DEL', `g:${code}:vin:${v.vid}:${v.tok}`]]);
      await deliver(code, new Map([[h.id, h]]), { type: 'viewer-want', vid: v.vid });
      return { ok: true, iceServers: await iceServers() };
    },
    /** Viewer → host: an answer or ICE candidate. */
    async wrtcSignal(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const members = await loadMembers(code);
      const [host] = await store.pipe([['GET', K(code).host]]);
      const h = members.get(host);
      if (h) await deliver(code, new Map([[h.id, h]]), { type: 'vsignal', from: v.vid, data: body.data });
      await store.pipe([['HSET', `g:${code}:wv`, v.vid, String(Date.now())]]);
      return { ok: true };
    },
    /** The viewer's private inbox of host signals. Also keeps their viewing slot. */
    async wrtcPoll(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const key = `g:${code}:vin:${v.vid}:${v.tok}`;
      const [msgs] = await store.pipe([['LPOP', key, 100], ['HSET', `g:${code}:wv`, v.vid, String(Date.now())]]);
      return { msgs: (Array.isArray(msgs) ? msgs : msgs ? [msgs] : []).map((m) => parse(m)).filter(Boolean) };
    },
    async wrtcLeave(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body).catch(() => null);
      if (!v) return { ok: true };
      await store.pipe([['HDEL', `g:${code}:wv`, v.vid]]);
      const members = await loadMembers(code);
      const [host] = await store.pipe([['GET', K(code).host]]);
      const h = members.get(host);
      if (h) await deliver(code, new Map([[h.id, h]]), { type: 'viewer-left', vid: v.vid });
      return { ok: true };
    },
    /** Host → viewer signal (called from studio.send). */
    async hostVsignal(code, op) {
      const vid = String(op.to || '').replace(/[^a-f0-9]/g, '').slice(0, 16);
      const [raw] = await store.pipe([['HGET', WK(code).viewers, vid]]);
      const v = parse(raw);
      if (!v) return;
      const key = `g:${code}:vin:${vid}:${v.tok}`;
      await store.pipe([['RPUSH', key, JSON.stringify({ type: 'signal', data: op.data })], ['EXPIRE', key, 600]]);
    },
    /** Host: call the next player (or a chosen one) from the queue, or clear it. */
    async hostQueue(code, op) {
      const key = `g:${code}:wq`;
      if (op.type === 'qclear') { await store.pipe([['DEL', key]]); return []; }
      const [flat] = await store.pipe([['HGETALL', key]]);
      const list = []; for (let i = 0; i < (flat || []).length; i += 2) { const x = parse(flat[i + 1]); if (x) list.push({ vid: flat[i], ...x }); }
      list.sort((a, b) => a.ts - b.ts);
      const pick = op.vid ? list.find((x) => x.vid === op.vid) : list.find((x) => x.status !== 'called');
      if (pick) { pick.status = 'called'; await store.pipe([['HSET', key, pick.vid, JSON.stringify({ name: pick.name, tag: pick.tag, ts: pick.ts, status: 'called' })]]); }
      return list.map(({ vid, ...x }) => ({ ...x, vid }));
    },
    /** Host: voice questions (list, fetch audio, set status, delete). */
    async hostVoice(code, op) {
      const id = String(op.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
      if (op.type === 'vmDel') { await store.pipe([['DEL', `g:${code}:vm:${id}`], ['HDEL', `g:${code}:vms`, id]]); return null; }
      const [raw] = await store.pipe([['HGET', `g:${code}:vms`, id]]); const it = parse(raw); if (!it) return null;
      it.status = op.status === 'aired' ? 'aired' : 'heard';
      await store.pipe([['HSET', `g:${code}:vms`, id, JSON.stringify(it)]]);
      return it;
    },
    async hostVoiceList(code) {
      const [flat] = await store.pipe([['HGETALL', `g:${code}:vms`]]); const out = [];
      for (let i = 1; i < (flat || []).length; i += 2) { const x = parse(flat[i]); if (x) out.push(x); }
      return out.sort((a, b) => b.ts - a.ts);
    },
    async hostVoiceAudio(code, id) { const [d] = await store.pipe([['GET', `g:${code}:vm:${String(id || '').replace(/[^a-z0-9-]/gi, '')}`]]); return d; },
    REACTS, METHODS,
  };

  /** A recorded voice question ("raise your hand"): stored for the host with the viewer's own speech-to-text. Only the
      host can fetch the audio; it's played on air only if they choose to, and deleted when they say so (or after 6 h). */
  async function voiceQuestion(code, st, v, body, members) {
    if (st.watch?.voice === false) throw new HttpError(400, 'Voice questions are off for this show.');
    const why = muted(st, v.name); if (why) throw new HttpError(403, why);
    const data = String(body.data || '');
    if (!VOICE_RE.test(data)) throw new HttpError(400, 'That recording didn’t come through. Try again.');
    if (data.length > 450_000) throw new HttpError(413, 'Keep it under 45 seconds.');
    const [fresh] = await store.pipe([['SET', `g:${code}:vmrl:${v.vid}`, '1', 'NX', 'EX', 60]]);
    if (!fresh) throw new HttpError(429, 'One voice question a minute, please.');
    const item = { id: 'vm-' + rid(5), name: v.name, transcript: clean(body.transcript, 600), dur: Math.round(num(body.dur, 0, 60, 0)), ts: Date.now(), status: 'new' };
    await store.pipe([['SET', `g:${code}:vm:${item.id}`, data, 'EX', TTL], ['HSET', `g:${code}:vms`, item.id, JSON.stringify(item)], ['EXPIRE', `g:${code}:vms`, TTL]]);
    const [host] = await store.pipe([['GET', K(code).host]]); const h = members.get(host);
    if (h) await deliver(code, new Map([[h.id, h]]), { type: 'voicemail', item });
    return { id: item.id };
  }

  /** The amount a super chat asks for, checked against the streamer's minimum. */
  function superCheck(w, body) {
    const amount = Math.round(num(body.amount, 0, 10000, 0) * 100) / 100;
    if (amount < w.min) throw new HttpError(400, `Super chats start at $${w.min}.`);
    if (body.voice && (typeof body.voice !== 'string' || !VOICE_RE.test(body.voice))) throw new HttpError(400, 'That voice message didn’t come through. Record it again.');
    if (body.voice && body.voice.length > 240_000) throw new HttpError(413, 'Keep the voice message under 20 seconds.');
    return amount;
  }
  /** Store a super chat (and its voice clip, if any). */
  async function superSave(code, v, body, method, status) {
    const bounty = !!body.bounty && !!clean(body.text, 120); // a challenge the streamer accepts with the payment
    const amount = Math.round(num(body.amount, 0, 10000, 0) * 100) / 100;
    const voice = typeof body.voice === 'string' && body.voice ? Math.max(1, Math.round(num(body.dur, 1, 20, 1))) : 0;
    const sc = { id: 'sc-' + rid(5), vid: v.vid, name: v.name, text: clean(body.text, bounty ? 120 : 200), amount, method, ts: Date.now(), status, ...(v.av ? { av: v.av } : {}), ...(bounty ? { bounty: true } : {}), ...(voice ? { voice } : {}) };
    await store.pipe([['HSET', WK(code).sc, sc.id, JSON.stringify(sc)], ['EXPIRE', WK(code).sc, TTL], ...(voice ? [['SET', `g:${code}:scv:${sc.id}`, body.voice, 'EX', TTL]] : [])]);
    return sc;
  }
  /** A confirmed super chat goes into the public chat (every viewer's page pops it up with its sound). */
  async function superPublish(code, sc, members) {
    const k = WK(code);
    const paid = '$' + (Number.isInteger(sc.amount) ? sc.amount : sc.amount.toFixed(2));
    const item = { id: 'w-' + sc.id, sc: sc.id, src: 'watch', name: sc.name, text: sc.text || (sc.voice ? 'Sent a voice super chat' : 'Sent a super chat'), paid, amount: sc.amount, ts: Date.now(), status: 'confirmed', ...(sc.av ? { av: sc.av } : {}), ...(sc.voice ? { voice: sc.voice } : {}), ...(sc.bounty ? { bounty: true } : {}) };
    await store.pipe([['RPUSH', k.chat, JSON.stringify(item)], ['LTRIM', k.chat, -200, -1], ['EXPIRE', k.chat, TTL]]);
    if (members.size) await deliver(code, members, { type: 'feed', items: [item] });
  }
  async function toHost(code, members, msg) {
    const [host] = await store.pipe([['GET', K(code).host]]);
    const h = members.get(host);
    if (h) await deliver(code, new Map([[h.id, h]]), msg);
  }

  /** Likes, spam reports, poll votes and the play-with-me queue: one per viewer, no rate limit. */
  async function tapAction(code, st, v, body, members) {
    const once = async (key) => (await store.pipe([['SET', key, '1', 'NX', 'EX', TTL]]))[0];
    const msg = String(body.msg || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
    if (body.type === 'like') {
      if (!msg) throw new HttpError(400, 'Which message?');
      if (await once(`g:${code}:wl:${msg}:${v.vid}`)) await store.pipe([['HINCRBY', `g:${code}:wlikes`, msg, 1], ['EXPIRE', `g:${code}:wlikes`, TTL]]);
      return { ok: true };
    }
    if (body.type === 'report') {
      if (!msg) throw new HttpError(400, 'Which message?');
      if (await once(`g:${code}:wr:${msg}:${v.vid}`)) {
        const [n] = await store.pipe([['HINCRBY', `g:${code}:wrep`, msg, 1], ['EXPIRE', `g:${code}:wrep`, TTL]]);
        const [host] = await store.pipe([['GET', K(code).host]]); const h = members.get(host);
        if (h) await deliver(code, new Map([[h.id, h]]), { type: 'wreport', msg, count: n, by: v.name });
      }
      return { ok: true };
    }
    if (body.type === 'delete') { // a viewer takes back their own message, for everyone
      if (!msg) throw new HttpError(400, 'Which message?');
      const [owner] = await store.pipe([['HGET', `g:${code}:wown`, msg]]);
      if (owner !== v.vid) throw new HttpError(403, 'You can only delete your own messages.');
      await store.pipe([['HSET', `g:${code}:wdel`, msg, '1'], ['EXPIRE', `g:${code}:wdel`, TTL]]);
      if (members.size) await deliver(code, members, { type: 'unfeed', ids: [msg] });
      return { ok: true };
    }
    if (body.type === 'vote') {
      const p = st.poll, opt = Number(body.opt);
      if (!p || p.id !== body.poll || Date.now() > p.until || !Number.isInteger(opt) || opt < 0 || opt >= p.opts.length) throw new HttpError(400, 'That poll has closed.');
      if (!(await once(`g:${code}:wv:${p.id}:${v.vid}`))) throw new HttpError(409, 'You already voted.');
      await store.pipe([['HINCRBY', `g:${code}:wpoll:${p.id}`, String(opt), 1], ['EXPIRE', `g:${code}:wpoll:${p.id}`, TTL]]);
      return { ok: true };
    }
    const key = `g:${code}:wq`;
    if (body.type === 'unqueue') { await store.pipe([['HDEL', key, v.vid]]); return { ok: true }; }
    if (!st.watch?.queue) throw new HttpError(400, 'The host isn’t taking players right now.');
    const [n] = await store.pipe([['HGETALL', key]]);
    if ((n || []).length / 2 >= 100) throw new HttpError(429, 'The queue is full.');
    const tag = clean(body.tag, 32);
    await store.pipe([['HSET', key, v.vid, JSON.stringify({ name: v.name, tag, ts: Date.now(), status: 'waiting' })], ['EXPIRE', key, TTL]]);
    const [host] = await store.pipe([['GET', K(code).host]]); const h = members.get(host);
    if (h) await deliver(code, new Map([[h.id, h]]), { type: 'wqueue', name: v.name, tag });
    return { ok: true };
  }
};
