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
  const LEDGER_TTL = 30 * 86400; // orders and auction wins: kept a month for the host's sales report
  const REACTS = ['❤️', '🔥', '😂', '👏', '🎉', '😮'];
  const METHODS = ['paypal', 'venmo', 'cashapp', 'stripe'];
  const WK = (code) => ({ chat: `g:${code}:wchat`, viewers: `g:${code}:viewers`, sc: `g:${code}:sc`, rl: (v) => `g:${code}:wrl:${v}`, react: (b, i) => `g:${code}:wr:${b}:${i}` });
  const bucket = (t = Date.now()) => Math.floor(t / 10_000);
  /** One writer at a time for a studio's stock and auction (a short Redis lock), so a last-item drop can't sell twice
      and two bids can't both win. Waits up to ~2 s, then asks the viewer to try again. */
  async function withLock(key, fn) {
    for (let i = 0; i < 40; i++) {
      const [ok] = await store.pipe([['SET', key, '1', 'NX', 'EX', 5]]);
      if (ok) { try { return await fn(); } finally { await store.pipe([['DEL', key]]); } }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new HttpError(503, 'Lots of people are buying right now. Try again in a second.');
  }

  async function stateOf(code) { const [st] = await store.pipe([['GET', K(code).state]]); return parse(st); }
  /** What a viewer may see of the host's watch settings (payment handles are public by nature). */
  function publicWatch(st, card = false) {
    const w = st?.watch || {};
    return {
      card: !!(w.supers && card),
      pk: (w.supers || st?.shop?.checkoutCard) && card ? pay.pk() : '',
      shopCard: !!(st?.shop?.checkoutCard !== false && card),
      chat: w.chat !== false,
      supers: !!w.supers && card, // super chats are paid by card on the watch page, never through an outside app
      join: !!w.join,
      voice: w.voice !== false,
      min: w.min || 2,
      slow: w.slow || 0,
      about: w.about || '',
      links: w.links || [],
      pin: w.pin || '',
      lobby: w.lobby || '',
      rig: w.rig || '',
      goal: w.goal?.target > 0 ? { label: w.goal.label || '', target: w.goal.target } : null,
      goalEffects: Array.isArray(w.goalEffects) ? w.goalEffects : [],
      hotSeat: w.hotSeat?.on ? { on: true, min: w.hotSeat.min || 25, sec: w.hotSeat.sec || 60 } : { on: false, min: 25, sec: 60 },
    };
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

  const api = {
    /** Public and cacheable: everything a viewer's page needs, identical for every viewer. */
    async wfeed(body) {
      const code = cleanCode(body.studio);
      if (!code) throw new HttpError(400, 'That watch link is missing its studio code.');
      const k = WK(code), b = bucket();
      const [st0] = await store.pipe([['GET', K(code).state]]);
      const pollId = parse(st0)?.poll?.id || 'none';
      const [st, chat, viewers, scs, caps, likes, reps, votes, queue, dels, stripeRaw, xpRaw, ...rc] = await store.pipe([
        ['GET', K(code).state], ['LRANGE', k.chat, -80, -1], ['HGETALL', k.viewers], ['HGETALL', k.sc], ['LRANGE', `g:${code}:wcap`, -3, -1],
        ['HGETALL', `g:${code}:wlikes`], ['HGETALL', `g:${code}:wrep`], ['HGETALL', `g:${code}:wpoll:${pollId}`], ['HGETALL', `g:${code}:wq`], ['HGETALL', `g:${code}:wdel`], ['GET', `g:${code}:stripe`], ['HGETALL', `g:${code}:wxp`],
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
      // Auto-settle prediction XP payouts once the host (or scoreboard) sets poll.answer >= 0
      if (poll && poll.kind === 'predict' && poll.answer >= 0) {
        const [settled] = await store.pipe([['SET', `g:${code}:wpreddone:${poll.id}`, '1', 'NX', 'EX', TTL]]);
        if (settled) {
          const [wagersRaw] = await store.pipe([['HGETALL', `g:${code}:wpred:${poll.id}`]]);
          const cmds = [];
          for (let i = 0; i < (wagersRaw || []).length; i += 2) {
            const wg = parse(wagersRaw[i + 1]);
            if (wg && wg.opt === poll.answer && wg.stake > 0) {
              cmds.push(['HINCRBY', `g:${code}:wxp`, wg.name, wg.stake * 2]);
            }
          }
          if (cmds.length) await store.pipe([...cmds, ['EXPIRE', `g:${code}:wxp`, TTL]]);
        }
      }
      const xpPairs = pairs(xpRaw);
      const topFans = Object.entries(xpPairs).map(([name, xp]) => ({ name, xp: Number(xp) || 0 })).filter((x) => x.xp > 0).sort((a, b) => b.xp - a.xp).slice(0, 8);
      const q = Object.values(pairs(queue)).map((x) => parse(x)).filter(Boolean).sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.ts - b.ts);
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
        topFans,
        purchaseAlert: s.purchaseAlert && now - (s.purchaseAlert.ts || 0) < 15_000 ? s.purchaseAlert : null,
        voiceOnAir: s.voiceOnAir && now - (s.voiceOnAir.ts || 0) < ((s.voiceOnAir.dur || 10) + 4) * 1000 ? s.voiceOnAir : null,
        sponsors: s.sponsors?.activeId ? (s.sponsors.slots || []).find((x) => x.id === s.sponsors.activeId) || null : null,
        countdown: s.countdown?.on ? s.countdown : null,
        shoutout: s.shoutout && now - (s.shoutout.ts || 0) < 120_000 ? s.shoutout : null,
        raid: s.raid && s.raid.at > now - 60_000 ? s.raid : null,
        ...(await liveEventsOf(code).catch(() => ({ auction: null, giveaway: null }))),
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
      const [raw, hsRaw] = await store.pipe([['HGET', `g:${code}:wq`, v.vid], ['HGET', `g:${code}:hotseat`, v.vid]]);
      const qe = parse(raw), hs = parse(hsRaw);
      const hotSeat = hs && Date.now() < (hs.expires || 0) ? hs : null;
      return { ok: true, queue: qe ? { status: qe.status || 'waiting' } : null, hotSeat };
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
      // Super chats are paid by card on the page (wcheckout), never "paid elsewhere, trust me".
      if (body.type === 'super') throw new HttpError(400, st?.watch?.supers ? 'Super chats are paid by card on this page.' : 'Super chats are off for this show.');
      if (!w.chat) throw new HttpError(400, 'Chat is off for this show.');
      const text = clean(body.text, 300);
      if (!text) throw new HttpError(400, 'Type a message first.');
      const [fresh] = await store.pipe([['SET', k.rl(v.vid), '1', 'NX', 'EX', Math.max(1, w.slow)]]);
      if (!fresh) throw new HttpError(429, w.slow ? `Slow mode: one message every ${w.slow} s.` : 'Slow down a little.');
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

    /** Buy without leaving: start embedded checkout (or direct instant claim when Stripe isn't connected) for a shop product. */
    async wshopbuy(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const st = await stateOf(code);
      if (!st || !st.shop) throw new HttpError(404, 'The shop isn’t open right now.');
      const itemId = clean(body.itemId, 24);
      const item = (st.shop.items || []).find((x) => x.id === itemId);
      if (!item) throw new HttpError(404, 'That product is no longer available.');
      if (item.stock != null && item.stock <= 0) throw new HttpError(409, 'Sorry — that drop just sold out!');
      const numPrice = Number(String(item.price || '').replace(/[^0-9.]/g, ''));
      const [acctRaw] = await store.pipe([['GET', `g:${code}:stripe`]]);
      const acct = parse(acctRaw);
      const orderId = 'ord-' + rid(5);
      if (pay.enabled() && acct?.ready && numPrice >= 0.5) {
        const salePct = st.shop.sale && st.shop.sale.id === item.id && st.shop.sale.until > Date.now() ? st.shop.sale.pct : 0;
        const cents = Math.max(50, Math.round(numPrice * (1 - salePct / 100) * 100));
        const co = await pay.checkout(acct.acct, { cents, title: `${item.title} · ${clean(st.title, 40) || 'Live Shop'}`, scId: orderId, studio: code });
        await store.pipe([['HSET', `g:${code}:orders`, orderId, JSON.stringify({ id: orderId, vid: v.vid, name: v.name, itemId: item.id, title: item.title, price: item.price, cs: co.session, status: 'paying', ts: Date.now() })], ['EXPIRE', `g:${code}:orders`, LEDGER_TTL]]);
        return { mode: 'stripe', orderId, clientSecret: co.clientSecret, account: acct.acct, pk: pay.pk() };
      }
      // Fallback when Stripe isn't connected yet: reserve order immediately and return store link if any.
      const fin = await finalizeOrder(code, st, v, item, orderId, { strict: true });
      return { mode: 'direct', orderId, url: item.url || '', remaining: fin?.item.stock ?? item.stock };
    },
    async wshopdone(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const orderId = String(body.orderId || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24);
      const [raw, acctRaw] = await store.pipe([['HGET', `g:${code}:orders`, orderId], ['GET', `g:${code}:stripe`]]);
      const ord = parse(raw), acct = parse(acctRaw);
      if (!ord || ord.vid !== v.vid) throw new HttpError(404, 'Order not found.');
      if (ord.status === 'paid') return { status: 'paid' };
      if (!acct?.acct || !ord.cs || !(await pay.paid(acct.acct, ord.cs))) return { status: 'paying' };
      const st = await stateOf(code);
      const item = st?.shop?.items?.find((x) => x.id === ord.itemId);
      ord.status = 'paid';
      await store.pipe([['HSET', `g:${code}:orders`, orderId, JSON.stringify(ord)]]);
      if (ord.auction) { await store.pipe([['SET', `g:${code}:aupaid:${ord.auction}`, '1', 'EX', TTL]]); await markAuctionPaid(code, ord.auction); return { status: 'paid' }; }
      const fin = st && item ? await finalizeOrder(code, st, v, item, orderId) : null;
      return { status: 'paid', remaining: fin?.item.stock ?? item?.stock ?? null };
    },

    /** Predictions: viewers stake XP on round outcomes; scoreboard settles automatically and updates Top Fans. */
    async wpredict(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const st = await stateOf(code);
      const p = st?.poll;
      const opt = Number(body.opt);
      const stake = Math.round(num(body.stake, 10, 1000, 50));
      if (!p || p.kind !== 'predict' || p.id !== body.poll || Date.now() > p.until || p.answer >= 0 || !Number.isInteger(opt) || opt < 0 || opt >= p.opts.length) {
        throw new HttpError(400, 'Predictions are closed for this round.');
      }
      const key = `g:${code}:wpred:${p.id}`;
      const [existing] = await store.pipe([['HGET', key, v.vid]]);
      if (existing) throw new HttpError(409, 'You already locked in your prediction.');
      await store.pipe([
        ['HSET', key, v.vid, JSON.stringify({ vid: v.vid, name: v.name, opt, stake, ts: Date.now() })],
        ['EXPIRE', key, TTL],
        ['HINCRBY', `g:${code}:wpoll:${p.id}`, String(opt), 1],
        ['EXPIRE', `g:${code}:wpoll:${p.id}`, TTL],
        ['HINCRBY', `g:${code}:wxp`, v.name, 10], // participation XP
        ['EXPIRE', `g:${code}:wxp`, TTL],
      ]);
      return { ok: true, opt, stake };
    },

    /** AI catch-up: "Missed 10 minutes?" digest from captions, chat spikes, super chats & bounties with jump links. */
    async wcatchup(body) {
      const code = cleanCode(body.studio);
      if (!code) throw new HttpError(400, 'Missing studio code.');
      const k = WK(code);
      const [stRaw, capLog, chatRaw] = await store.pipe([['GET', K(code).state], ['LRANGE', `g:${code}:wcaplog`, -40, -1], ['LRANGE', k.chat, -80, -1]]);
      const s = parse(stRaw);
      if (!s) throw new HttpError(404, 'Show not found.');
      const now = Date.now(), cutoff = now - 10 * 60e3;
      const caps = (capLog || []).map((x) => parse(x)).filter((x) => x && x.ts >= cutoff);
      const msgs = (chatRaw || []).map((x) => parse(x)).filter((x) => x && x.ts >= cutoff);
      const moments = [];
      // 1. Confirmed super chats
      for (const m of msgs.filter((x) => x.paid && x.status === 'confirmed').slice(-3)) {
        moments.push({ ts: m.ts, kind: 'super', msgId: m.id, title: `${m.name} dropped ${m.paid}`, detail: m.text || 'Super chat shout-out' });
      }
      // 2. Active/completed bounties
      for (const b of (s.bounties || []).filter((x) => x.ts >= cutoff).slice(-2)) {
        moments.push({ ts: b.ts, kind: 'bounty', msgId: '', title: `Challenge ${b.status === 'done' ? 'completed' : 'live'} (${b.amount || 'Bounty'})`, detail: b.text });
      }
      // 3. Caption topic snapshots
      if (caps.length) {
        const step = Math.max(1, Math.floor(caps.length / 3));
        for (let i = 0; i < caps.length && moments.length < 6; i += step) {
          const c = caps[i];
          moments.push({ ts: c.ts, kind: 'caption', msgId: '', title: `${c.name || 'Host'} on mic`, detail: c.text });
        }
      }
      // 4. Most-liked chat highlight
      const topChat = msgs.filter((x) => !x.paid && (x.text || '').length > 14).slice(-12);
      if (topChat.length && moments.length < 5) {
        const pick = topChat[Math.floor(topChat.length / 2)];
        moments.push({ ts: pick.ts, kind: 'chat', msgId: pick.id, title: `Chat highlight · ${pick.name}`, detail: pick.text });
      }
      moments.sort((a, b) => a.ts - b.ts);
      const summary = s.aiSpotlight?.headline
        || (caps.length ? `Talking through: “${caps[caps.length - 1].text.slice(0, 110)}”` : s.title ? `Live now: ${s.title}` : 'Catch up on what just happened.');
      return { ok: true, summary, count: msgs.length, capsCount: caps.length, moments: moments.slice(-5) };
    },

    /** Watch-party private rooms: friends open a private side room synced to the stream. */
    async wroomCreate(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const room = rid(3).toUpperCase();
      const name = clean(body.roomName, 36) || `${v.name}’s room`;
      const meta = { room, name, host: v.name, ts: Date.now() };
      await store.pipe([
        ['SET', `g:${code}:rm:${room}:meta`, JSON.stringify(meta), 'EX', TTL],
        ['HSET', `g:${code}:rm:${room}:m`, v.vid, JSON.stringify({ name: v.name, seen: Date.now() })],
        ['EXPIRE', `g:${code}:rm:${room}:m`, TTL],
      ]);
      return { ok: true, ...meta };
    },
    async wroomJoin(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const room = String(body.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!room) throw new HttpError(400, 'Enter a room code.');
      const [raw] = await store.pipe([['GET', `g:${code}:rm:${room}:meta`]]);
      const meta = parse(raw);
      if (!meta) throw new HttpError(404, 'That watch-party room was not found.');
      await store.pipe([['HSET', `g:${code}:rm:${room}:m`, v.vid, JSON.stringify({ name: v.name, seen: Date.now() })], ['EXPIRE', `g:${code}:rm:${room}:m`, TTL]]);
      return { ok: true, ...meta };
    },
    async wroomSend(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const room = String(body.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      const text = clean(body.text, 240);
      if (!room || !text) throw new HttpError(400, 'Type a message first.');
      const msg = { id: 'rm-' + rid(4), name: v.name, text, ts: Date.now() };
      await store.pipe([
        ['RPUSH', `g:${code}:rm:${room}:chat`, JSON.stringify(msg)],
        ['LTRIM', `g:${code}:rm:${room}:chat`, -80, -1],
        ['EXPIRE', `g:${code}:rm:${room}:chat`, TTL],
        ['HSET', `g:${code}:rm:${room}:m`, v.vid, JSON.stringify({ name: v.name, seen: Date.now() })],
      ]);
      return { ok: true, msg };
    },
    async wroomPoll(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const room = String(body.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!room) return { found: false };
      const [metaRaw, msgsRaw, memRaw] = await store.pipe([
        ['GET', `g:${code}:rm:${room}:meta`],
        ['LRANGE', `g:${code}:rm:${room}:chat`, -60, -1],
        ['HGETALL', `g:${code}:rm:${room}:m`],
      ]);
      const meta = parse(metaRaw);
      if (!meta) return { found: false };
      const now = Date.now(), members = [];
      for (let i = 1; i < (memRaw || []).length; i += 2) { const m = parse(memRaw[i]); if (m && now - m.seen < 60_000) members.push(m.name); }
      await store.pipe([['HSET', `g:${code}:rm:${room}:m`, v.vid, JSON.stringify({ name: v.name, seen: now })]]);
      return { found: true, ...meta, members, chat: (msgsRaw || []).map((x) => parse(x)).filter(Boolean) };
    },

    /** Hot seat: claim camera slot when viewer earned a Hot Seat super chat pass. */
    async whotseat(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const [raw] = await store.pipe([['HGET', `g:${code}:hotseat`, v.vid]]);
      const hs = parse(raw);
      if (!hs || Date.now() > hs.expires) throw new HttpError(403, 'Send a Hot Seat super chat to unlock the 60-second camera slot.');
      const members = await loadMembers(code);
      await toHost(code, members, { type: 'hotseat-claim', vid: v.vid, name: v.name, amount: hs.amount, sec: hs.sec || 60 });
      return { ok: true, sec: hs.sec || 60 };
    },

    /** Track sponsor card clicks for host report. */
    async wsponsorClick(body) {
      const code = cleanCode(body.studio);
      const id = clean(body.sponsorId, 24);
      const st = await stateOf(code);
      if (!st?.sponsors?.slots || !id) return { ok: false };
      const slot = st.sponsors.slots.find((x) => x.id === id);
      if (!slot) return { ok: false };
      slot.clicks = (Number(slot.clicks) || 0) + 1;
      await store.pipe([['SET', K(code).state, JSON.stringify(st), 'EX', TTL]]);
      const members = await loadMembers(code);
      await toHost(code, members, { type: 'sponsor-click', id, clicks: slot.clicks });
      return { ok: true, clicks: slot.clicks };
    },

    // ------------------------------------------------------------ live auctions (Whatnot-style) and giveaways
    // Both live in their own keys, never in the host-written stage state, so a host's stale copy of the stage can't
    // undo a bid. Every change runs under the studio's lock; ending is lazy (the next feed, bid or host action after
    // the clock runs out settles it, exactly once).

    /** Viewer: bid on the live auction. `amt` in whole cents; must beat the leader by the increment. */
    async wbid(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const st = await stateOf(code);
      const why = muted(st, v.name); if (why) throw new HttpError(403, why);
      const amt = Math.round(num(body.amt, 0, 10_000_000, 0));
      const members = await loadMembers(code);
      const out = await withLock(`g:${code}:shoplock`, async () => {
        const a = await auctionOf(code);
        if (!a || a.id !== String(body.auction || '') || a.status !== 'live') throw new HttpError(409, 'That auction has ended.');
        const now = Date.now();
        if (now >= a.endsAt) { await settleAuction(code, a, members, true); throw new HttpError(409, 'Too late — the auction just closed.'); }
        const min = a.top ? a.top.amt + a.inc : a.start;
        if (amt < min) throw new HttpError(409, `The next bid is at least ${money(min)}.`);
        if (a.top && a.top.vid === v.vid) throw new HttpError(409, 'You’re already the top bidder.');
        a.top = { vid: v.vid, name: v.name, amt };
        a.bids = [...(a.bids || []), { name: v.name, amt, ts: now }].slice(-8);
        a.count = (a.count || 0) + 1;
        // Anti-snipe: a bid in the last 10 s adds time, so the item goes to the highest bidder, not the fastest
        // connection. Sudden death turns that off.
        if (!a.sudden && a.endsAt - now < 10_000) a.endsAt = now + 10_000;
        await saveAuction(code, a);
        return a;
      });
      await store.pipe([['HINCRBY', `g:${code}:wxp`, v.name, 5], ['EXPIRE', `g:${code}:wxp`, TTL]]);
      if (members.size) await deliver(code, members, { type: 'auction', auction: publicAuction(out) });
      return { ok: true, auction: publicAuction(out) };
    },

    /** The auction winner pays: card checkout when the host has Stripe connected, else the host's own pay links. */
    async wauctionpay(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const a = await auctionOf(code);
      if (!a || a.id !== String(body.auction || '') || a.status !== 'sold') throw new HttpError(404, 'That auction isn’t waiting for payment.');
      const [winVid, acctRaw, paidRaw] = await store.pipe([['GET', `g:${code}:auwin:${a.id}`], ['GET', `g:${code}:stripe`], ['GET', `g:${code}:aupaid:${a.id}`]]);
      if (winVid !== v.vid) throw new HttpError(403, 'Only the winner can pay for this one.');
      if (paidRaw) return { mode: 'paid' };
      const st = await stateOf(code);
      const acct = parse(acctRaw), orderId = 'ord-' + rid(5);
      if (pay.enabled() && acct?.ready && a.top.amt >= 50) {
        const co = await pay.checkout(acct.acct, { cents: a.top.amt, title: `${a.title} · auction win`, scId: orderId, studio: code });
        await store.pipe([['HSET', `g:${code}:orders`, orderId, JSON.stringify({ id: orderId, vid: v.vid, name: v.name, itemId: a.itemId || '', auction: a.id, title: a.title, price: money(a.top.amt), cs: co.session, status: 'paying', ts: Date.now() })], ['EXPIRE', `g:${code}:orders`, LEDGER_TTL]]);
        return { mode: 'stripe', orderId, clientSecret: co.clientSecret, account: acct.acct, pk: pay.pk() };
      }
      // No card payments on this show: the winner and the host settle it themselves; no outside pay links.
      return { mode: 'host', amount: money(a.top.amt) };
    },

    /** Viewer: enter the running giveaway (once per viewer). */
    async wenter(body) {
      const code = cleanCode(body.studio);
      const v = await viewer(code, body);
      const st = await stateOf(code);
      const why = muted(st, v.name); if (why) throw new HttpError(403, why);
      const gv = await giveawayOf(code);
      if (!gv || gv.id !== String(body.giveaway || '') || gv.status !== 'open' || Date.now() >= gv.endsAt) throw new HttpError(409, 'That giveaway is closed.');
      const [added] = await store.pipe([['HSET', `g:${code}:give:${gv.id}`, v.vid, v.name], ['EXPIRE', `g:${code}:give:${gv.id}`, TTL]]);
      if (!Number(added)) return { ok: true, already: true };
      await store.pipe([['HINCRBY', `g:${code}:wxp`, v.name, 2], ['EXPIRE', `g:${code}:wxp`, TTL]]);
      return { ok: true };
    },

    /** Host: start / end / cancel an auction, or just read it ("get"). */
    async hostAuction(code, op, members) {
      return withLock(`g:${code}:shoplock`, async () => {
        let a = await auctionOf(code);
        if (op.act === 'start') {
          if (a?.status === 'live' && Date.now() < a.endsAt) throw new HttpError(409, 'An auction is already running. End it first.');
          const sec = Math.round(num(op.sec, 10, 900, 60));
          a = {
            id: 'au-' + rid(4), title: clean(op.title, 80) || 'Mystery item', img: /^https:\/\/[^\s<>"']{3,400}$/.test(String(op.img || '')) ? String(op.img) : '',
            itemId: clean(op.itemId, 24), start: Math.round(num(op.start, 0, 10_000_000, 100)), inc: Math.round(num(op.inc, 1, 1_000_000, 100)),
            sudden: !!op.sudden, sec, startedAt: Date.now(), endsAt: Date.now() + sec * 1000, status: 'live', top: null, bids: [], count: 0,
          };
          await saveAuction(code, a);
        } else if (a && (op.act === 'end' || op.act === 'cancel') && a.status === 'live') {
          if (op.act === 'cancel') { a.status = 'cancelled'; a.endedAt = Date.now(); await saveAuction(code, a); }
          else { a.endsAt = Date.now(); await settleAuction(code, a, members, false); }
        } else if (a && op.act === 'clear' && a.status !== 'live') { await store.pipe([['DEL', `g:${code}:auction`]]); a = null; }
        else if (a?.status === 'live' && Date.now() >= a.endsAt) await settleAuction(code, a, members, false);
        if (members?.size && op.act !== 'get') await deliver(code, members, { type: 'auction', auction: publicAuction(a) });
        return publicAuction(a);
      });
    },

    /** Host: open / draw / cancel a giveaway, or read it ("get"). */
    async hostGiveaway(code, op, members) {
      return withLock(`g:${code}:givelock`, async () => {
        let gv = await giveawayOf(code);
        if (op.act === 'start') {
          if (gv?.status === 'open') throw new HttpError(409, 'A giveaway is already open. Draw or cancel it first.');
          const sec = Math.round(num(op.sec, 15, 3600, 120));
          gv = { id: 'gw-' + rid(4), prize: clean(op.prize, 80) || 'A prize', sec, endsAt: Date.now() + sec * 1000, status: 'open', winner: null, entries: 0 };
        } else if (gv && op.act === 'draw' && gv.status === 'open') {
          const [flat] = await store.pipe([['HGETALL', `g:${code}:give:${gv.id}`]]);
          const names = []; for (let i = 0; i < (flat || []).length; i += 2) names.push(flat[i + 1]);
          gv.entries = names.length;
          gv.winner = names.length ? names[require('crypto').randomInt(names.length)] : null; // fair: crypto RNG, server side
          gv.status = 'drawn'; gv.endedAt = Date.now();
          if (gv.winner) await chatPost(code, members, { text: `🎁 ${gv.winner} won the giveaway: ${gv.prize}!` });
        } else if (gv && op.act === 'cancel') { gv.status = 'cancelled'; gv.endedAt = Date.now(); }
        else if (gv && op.act === 'clear' && gv.status !== 'open') { await store.pipe([['DEL', `g:${code}:giveaway`]]); gv = null; }
        if (gv) {
          if (gv.status === 'open') { const [n] = await store.pipe([['HLEN', `g:${code}:give:${gv.id}`]]); gv.entries = Number(n) || 0; }
          await store.pipe([['SET', `g:${code}:giveaway`, JSON.stringify(gv), 'EX', TTL]]);
        }
        if (members?.size && op.act !== 'get') await deliver(code, members, { type: 'giveaway', giveaway: gv });
        return gv;
      });
    },

    liveEvents: (code) => liveEventsOf(code),
  };
  /** For the feed: the auction and giveaway as viewers see them (settles an expired auction first). */
  async function liveEventsOf(code) {
      let a = await auctionOf(code);
      if (a?.status === 'live' && Date.now() >= a.endsAt) {
        const members = await loadMembers(code);
        a = await withLock(`g:${code}:shoplock`, async () => { const cur = await auctionOf(code); if (cur?.status === 'live' && Date.now() >= cur.endsAt) await settleAuction(code, cur, members, true); return cur; }).catch(() => a);
      }
      let gv = await giveawayOf(code);
      if (gv?.status === 'open') { const [n] = await store.pipe([['HLEN', `g:${code}:give:${gv.id}`]]); gv = { ...gv, entries: Number(n) || 0 }; }
      const recent = (x) => x && (x.status === 'live' || x.status === 'open' || Date.now() - (x.endedAt || 0) < 90_000);
      return { auction: recent(a) ? publicAuction(a) : null, giveaway: recent(gv) ? gv : null };
  }



  const money = (c) => '$' + (c / 100).toFixed(c % 100 ? 2 : 0);
  async function auctionOf(code) { const [raw] = await store.pipe([['GET', `g:${code}:auction`]]); return parse(raw); }
  async function giveawayOf(code) { const [raw] = await store.pipe([['GET', `g:${code}:giveaway`]]); return parse(raw); }
  async function saveAuction(code, a) { await store.pipe([['SET', `g:${code}:auction`, JSON.stringify(a), 'EX', TTL]]); }
  /** Viewers never see who's who beyond names: drop the leader's viewer id. */
  function publicAuction(a) { if (!a) return null; const { top, ...rest } = a; return { ...rest, top: top ? { name: top.name, amt: top.amt } : null }; }
  /** A system line in the watch chat and the studio chat (winners, results). */
  async function chatPost(code, members, { text }) {
    const msg = { id: 'w-sys-' + rid(4), src: 'watch', name: 'gather', sys: true, text, ts: Date.now() };
    await store.pipe([['RPUSH', WK(code).chat, JSON.stringify(msg)], ['LTRIM', WK(code).chat, -200, -1], ['EXPIRE', WK(code).chat, TTL]]);
    if (members?.size) await deliver(code, members, { type: 'feed', items: [msg] });
  }
  /** Close an auction (caller holds the lock). The winner gets XP and a chat line; the host's studio is told. */
  async function settleAuction(code, a, members, announce) {
    a.status = a.top ? 'sold' : 'nobid'; a.endedAt = Date.now();
    await saveAuction(code, a);
    if (a.top) {
      await store.pipe([['HINCRBY', `g:${code}:wxp`, a.top.name, 50], ['EXPIRE', `g:${code}:wxp`, TTL], ['SET', `g:${code}:auwin:${a.id}`, a.top.vid, 'EX', TTL],
        ['HSET', `g:${code}:orders`, `au-${a.id}`, JSON.stringify({ id: `au-${a.id}`, kind: 'auction', vid: a.top.vid, name: a.top.name, itemId: a.itemId || '', title: a.title, price: money(a.top.amt), status: 'won', ts: Date.now() })],
        ['EXPIRE', `g:${code}:orders`, LEDGER_TTL]]);
      await chatPost(code, members, { text: `🏆 SOLD! ${a.top.name} won ${a.title} for ${money(a.top.amt)}` });
    }
    if (announce && members?.size) await deliver(code, members, { type: 'auction', auction: publicAuction(a) });
  }
  /** Records a sale. With `strict`, a sold-out item is refused (pay-later orders); a paid card order always counts. */
  async function finalizeOrder(code, _st, v, _item, orderId, { strict = false } = {}) {
    const done = await withLock(`g:${code}:shoplock`, async () => {
      const st = await stateOf(code);
      const item = st?.shop?.items?.find((x) => x.id === _item.id);
      if (!st || !item) return null;
      if (item.stock != null && item.stock <= 0 && strict) throw new HttpError(409, 'Sorry — that drop just sold out!');
      if (item.stock != null && item.stock > 0) item.stock -= 1;
      item.sold = (Number(item.sold) || 0) + 1;
      st.purchaseAlert = { id: orderId, buyer: v.name, title: item.title, price: item.price || '', ts: Date.now() };
      await store.pipe([['SET', K(code).state, JSON.stringify(st), 'EX', TTL]]);
      return { st, item, alert: st.purchaseAlert };
    });
    if (!done) return null;
    const { st, item, alert } = done;
    const [prevRaw] = await store.pipe([['HGET', `g:${code}:orders`, orderId]]);
    if (!prevRaw) await store.pipe([['HSET', `g:${code}:orders`, orderId, JSON.stringify({ id: orderId, vid: v.vid, name: v.name, itemId: item.id, title: item.title, price: item.price || '', status: 'reserved', ts: Date.now() })], ['EXPIRE', `g:${code}:orders`, LEDGER_TTL]]);
    const members = await loadMembers(code);
    const msg = { id: 'w-' + orderId, src: 'watch', name: v.name, text: `🛍️ Just bought ${item.title}${item.stock != null ? ` (${item.stock} left!)` : ''}`, paid: item.price || 'Bought', ts: Date.now(), status: 'confirmed' };
    await store.pipe([['RPUSH', WK(code).chat, JSON.stringify(msg)], ['LTRIM', WK(code).chat, -200, -1], ['EXPIRE', WK(code).chat, TTL]]);
    if (members.size) {
      await deliver(code, members, { type: 'state', state: st });
      await deliver(code, members, { type: 'shop-sale', alert, item });
      await deliver(code, members, { type: 'feed', items: [msg] });
    }
    return done;
  }

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
    const st = await stateOf(code);
    const hsCfg = st?.watch?.hotSeat;
    const hotSeatEarned = !!(hsCfg?.on && sc.amount >= (hsCfg.min || 25));
    if (hotSeatEarned && sc.vid) {
      const hs = { id: sc.id, name: sc.name, amount: sc.amount, sec: hsCfg.sec || 60, expires: Date.now() + 10 * 60e3 };
      await store.pipe([['HSET', `g:${code}:hotseat`, sc.vid, JSON.stringify(hs)], ['EXPIRE', `g:${code}:hotseat`, TTL]]);
      await toHost(code, members, { type: 'hotseat-earned', item: hs });
    }
    // Award XP to Top Fans leaderboard for super chat support
    await store.pipe([['HINCRBY', `g:${code}:wxp`, sc.name, Math.max(25, Math.round(sc.amount * 15))], ['EXPIRE', `g:${code}:wxp`, TTL]]);
    const item = { id: 'w-' + sc.id, sc: sc.id, src: 'watch', name: sc.name, text: sc.text || (sc.voice ? 'Sent a voice super chat' : 'Sent a super chat'), paid, amount: sc.amount, ts: Date.now(), status: 'confirmed', ...(hotSeatEarned ? { hotSeat: true } : {}), ...(sc.av ? { av: sc.av } : {}), ...(sc.voice ? { voice: sc.voice } : {}), ...(sc.bounty ? { bounty: true } : {}) };
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
    const [n, xpRaw] = await store.pipe([['HGETALL', key], ['HGET', `g:${code}:wxp`, v.name]]);
    if ((n || []).length / 2 >= 100) throw new HttpError(429, 'The queue is full.');
    const tag = clean(body.tag, 32);
    const priority = Number(xpRaw || 0) >= 150 ? 1 : 0; // XP earns priority in the play-with-me queue
    await store.pipe([['HSET', key, v.vid, JSON.stringify({ name: v.name, tag, ts: Date.now(), status: 'waiting', priority })], ['EXPIRE', key, TTL]]);
    const [host] = await store.pipe([['GET', K(code).host]]); const h = members.get(host);
    if (h) await deliver(code, new Map([[h.id, h]]), { type: 'wqueue', name: v.name, tag, priority });
    return { ok: true, priority };
  }

  async function markAuctionPaid(code, auctionId) {
    const key = `au-${auctionId}`;
    const [raw] = await store.pipe([['HGET', `g:${code}:orders`, key]]);
    const o = parse(raw); if (!o) return;
    o.status = 'paid';
    await store.pipe([['HSET', `g:${code}:orders`, key, JSON.stringify(o)]]);
  }

  /** The host's sales report: every sale, auction win and super chat this show, totals, top buyers and best sellers.
      Abandoned card checkouts ('paying') aren't sales; an auction's card order is folded into its win. */
  async function hostSales(code) {
    const [ordFlat, scFlat, wvFlat] = await store.pipe([['HGETALL', `g:${code}:orders`], ['HGETALL', WK(code).sc], ['HGETALL', `g:${code}:wv`]]);
    const pairs = (flat) => { const out = []; for (let i = 1; i < (flat || []).length; i += 2) { const x = parse(flat[i]); if (x) out.push(x); } return out; };
    const cents = (p) => { const n = Number(String(p ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
    const rows = [];
    for (const o of pairs(ordFlat)) {
      if (o.auction || o.status === 'paying') continue;
      rows.push({ kind: o.kind === 'auction' ? 'auction' : 'sale', ts: o.ts || 0, name: o.name || '', title: o.title || '', cents: cents(o.price), status: o.status || 'paid' });
    }
    for (const x of pairs(scFlat)) {
      if (!['confirmed', 'answered'].includes(x.status)) continue;
      rows.push({ kind: 'superchat', ts: x.ts || 0, name: x.name || '', title: String(x.text || '').slice(0, 80), cents: cents(x.amount), status: x.method || 'confirmed' });
    }
    rows.sort((a, b) => a.ts - b.ts);
    const buyers = new Map(), items = new Map();
    let gross = 0;
    for (const r of rows) {
      gross += r.cents;
      const b = buyers.get(r.name) || { name: r.name, cents: 0, count: 0 }; b.cents += r.cents; b.count++; buyers.set(r.name, b);
      if (r.kind !== 'superchat') { const it = items.get(r.title) || { title: r.title, cents: 0, count: 0 }; it.cents += r.cents; it.count++; items.set(r.title, it); }
    }
    const by = (m) => [...m.values()].sort((a, b) => b.cents - a.cents || b.count - a.count).slice(0, 5);
    const count = (k) => rows.filter((r) => r.kind === k).length;
    const sum = (k) => rows.filter((r) => r.kind === k).reduce((t, r) => t + r.cents, 0);
    return {
      gross, buyers: buyers.size, viewers: Math.floor((wvFlat || []).length / 2),
      sales: { count: count('sale'), cents: sum('sale') }, auctions: { count: count('auction'), cents: sum('auction') }, supers: { count: count('superchat'), cents: sum('superchat') },
      topBuyers: by(buyers), topItems: by(items), rows: rows.slice(-500),
    };
  }

  Object.assign(api, { REACTS, METHODS, hostSales });
  return api;
};
