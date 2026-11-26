// Sam in the studio chat: one conversation for people and the AI.
// - Starter prompts above the composer send straight to Sam (or fill the composer when they need more words).
// - The Sam button in the composer starts an "@Sam" message.
// - Sam posts short getting-started notes for the host and welcomes guests automatically when they enter.
// Created by app.js through createSamChat(app).
export function createSamChat(app) {
  const { $, $$, S, store, isHost, upsertAI, askProducer, setStage, setTab, autoGrow } = app;
  const notes = new Map(); // note id -> [{ label, run }]
  const said = new Set(); // one-time notes already posted this session
  let lastNote = 0, lastQuestion = 0, lastChat = Date.now(), wasLive = false, quietSaid = 0;

  const on = () => isHost() && store.get('samNotes', true);
  const name = () => S.aiName || 'Sam';
  const hostName = () => (S.name || store.get('name', '') || '').split(/\s+/)[0] || 'there';

  /** Post a note from Sam into the chat. `key` makes it once per session; `gap` keeps notes from piling up. */
  function note(text, actions = [], { key = '', gap = 20e3, broadcast = false, id: fixedId = '' } = {}) {
    if (!on()) return;
    if (key && said.has(key)) return;
    if (gap > 0 && Date.now() - lastNote < gap) return;
    if (key) said.add(key);
    lastNote = Date.now();
    const id = fixedId || ('note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    notes.set(id, actions);
    upsertAI({ id, role: 'assistant', text, done: true, note: true, ts: Date.now() }, broadcast);
  }

  /** Buttons for a note, used by the chat renderer. */
  function noteActions(id) {
    const acts = notes.get(id) || [];
    return acts.map(({ label, run }) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = label;
      b.onclick = () => { b.disabled = true; try { run(); } finally { setTimeout(() => { b.disabled = false; }, 800); } };
      return b;
    });
  }

  const ask = (q) => () => askProducer(q);
  /** Put "@Sam <prefix>" in the chat composer, ready to finish typing. */
  function draft(prefix = '') {
    const t = $('#chatInput'); if (!t) return;
    t.value = `@${name()} ${prefix}`; autoGrow(t); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
  }

  // ---------------------------------------------------------------- starters + the Sam button
  const STARTERS = [
    ['Show intro', 'Write a 20-second intro I can read to open the show.'],
    ['Poll idea', 'Suggest one quick poll for the audience with 3 short options.'],
    ['Recap chat', 'Recap what the chat has been saying in 3 short bullets.'],
    ['Guest questions', 'Give me 3 good questions to ask my guest.'],
    ['Fact-check', null, 'Fact-check: '],
    ['Banner', 'Show a banner: Welcome to the show!'],
    ['5-min countdown', 'Start a 5 minute countdown'],
  ];
  function renderStarters() {
    const row = $('#samStarters'); if (!row) return;
    row.replaceChildren(...STARTERS.map(([label, q, prefix]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sam-chip';
      b.textContent = label;
      b.onclick = () => (q ? askProducer(q) : draft(prefix));
      return b;
    }));
  }
  renderStarters();
  $('#samBtn')?.addEventListener('click', () => draft());

  // ---------------------------------------------------------------- moments Sam speaks up
  function seedAdminSuggestions() {
    if (!isHost() || !store.get('samNotes', true)) return;
    note(
      `Welcome back, ${hostName()}! I'm ${name()}, your AI producer. Type @${name()} anytime for show intros, countdowns, banners, or viewer Q&A — or jump into setup below:`,
      [
        { label: 'Customize brand', run: () => setTab?.('brand') },
        { label: 'Open Gaming tools', run: () => setTab?.('gaming') },
        { label: 'Music & SFX', run: () => setTab?.('music') },
      ],
      { key: 'hello', gap: 0, id: 'note-welcome' }
    );
  }

  function onJoin() {
    if (!isHost()) return;
    said.delete('hello');
    setTimeout(seedAdminSuggestions, 220);
  }

  /** Automatically welcome a guest in the shared chat as soon as they enter the studio. */
  function onGuestJoin(peer) {
    if (!isHost() || !S.studio || !peer) return;
    const guestName = String(peer.name || 'Guest').trim() || 'Guest';
    const key = 'welcome:' + (peer.id || guestName.toLowerCase());
    if (said.has(key)) return;
    said.add(key);
    lastNote = Date.now();
    const id = 'welcome-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const text = `Welcome to the stream, ${guestName}! 👋 Glad you're here — check your mic and camera, and drop a note in chat if you need anything before going on stage.`;
    upsertAI({ id, role: 'assistant', text, done: true, note: true, ts: Date.now() }, true);
  }

  // Seed initial host suggestions if the studio workspace is already open without an active room yet.
  setTimeout(() => { if (!S.studio && isHost() && !document.body.classList.contains('pre')) seedAdminSuggestions(); }, 450);

  /** Every chat message from any source passes here (app.js pushFeed). */
  function onFeed(m) {
    lastChat = Date.now(); quietSaid = 0;
    if (!on() || !S.studio || !m || m.src === 'studio' || m.src === 'ai') return;
    const text = String(m.text || '').trim();
    if (m.reward === 'song') { // a viewer spent XP on a song request: make sure the host sees it
      const song = text.replace(/^🎵\s*Song request:\s*/, '');
      note(`🎵 ${m.name || 'A viewer'} spent 250 XP on a song request: “${song.slice(0, 100)}”`, [
        { label: 'Show on stage', run: () => setStage({ featured: { id: m.id || 'song-' + Date.now(), src: m.src || 'watch', name: m.name || 'Viewer', text: `🎵 ${song}` } }) },
      ], { gap: 0 });
      return;
    }
    if (text.length < 8 || !/\?\s*$|^(how|what|why|when|where|who|can|could|do|does|is|are|will|would|should)\b/i.test(text)) return;
    if (Date.now() - lastQuestion < 45e3) return;
    lastQuestion = Date.now();
    const short = text.length > 110 ? text.slice(0, 107) + '…' : text;
    note(`Question from ${m.name || 'a viewer'}: “${short}”`, [
      { label: 'Show on stage', run: () => setStage({ featured: { id: m.id || 'q-' + Date.now(), src: m.src || 'chat', name: m.name || 'Viewer', text } }) },
      { label: 'Draft an answer', run: ask(`A viewer (${m.name || 'viewer'}) asked: "${text}". Give me a short answer I can say out loud.`) },
    ], { gap: 8e3 });
  }

  // Going live, and a chat that has gone quiet while live.
  setInterval(() => {
    if (!on() || !S.studio) return;
    const live = !!S.state?.live?.on;
    if (live && !wasLive) {
      const n = (S.state.live.links || []).length;
      note(`You're live${n ? ` on ${n} platform${n > 1 ? 's' : ''}` : ''}. I'll flag viewer questions here as they come in.`,
        [{ label: 'Welcome banner', run: ask('Show a banner: Welcome! Say hi in the chat') }], { key: 'live', gap: 0 });
      lastChat = Date.now();
    }
    wasLive = live;
    if (live && Date.now() - lastChat > 4 * 60e3 && quietSaid < 2) {
      quietSaid++; lastChat = Date.now();
      note('The chat has been quiet for a few minutes. A quick poll or a question to the audience usually gets it going.',
        [{ label: 'Poll idea', run: ask(STARTERS[1][1]) }, { label: 'Ask the audience', run: ask('Give me one fun question to ask the audience right now.') }], { gap: 60e3 });
    }
  }, 5000);

  return { note, noteActions, onJoin, onGuestJoin, seedAdminSuggestions, onFeed, draft };
}
