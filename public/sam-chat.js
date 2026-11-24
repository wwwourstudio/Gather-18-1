// Sam in the studio chat: one conversation for people and the AI.
// - Starter prompts above the composer send straight to Sam (or fill the composer when they need more words).
// - The Sam button in the composer starts an "@Sam" message.
// - Sam posts short notes on its own as the show goes (start, going live, a viewer question, a quiet chat), each
//   with a button that does the obvious next thing. Notes stay on the host's screen and never cost an AI request.
// Created by app.js through createSamChat(app).
export function createSamChat(app) {
  const { $, $$, S, store, isHost, upsertAI, askProducer, setStage, autoGrow } = app;
  const notes = new Map(); // note id -> [{ label, run }]
  const said = new Set(); // one-time notes already posted this session
  let lastNote = 0, lastQuestion = 0, lastChat = Date.now(), wasLive = false, quietSaid = 0;

  const on = () => isHost() && !!S.studio && store.get('samNotes', true);
  const name = () => S.aiName || 'Sam';
  const hostName = () => (S.name || store.get('name', '') || '').split(/\s+/)[0] || 'there';

  /** Post a note from Sam into the chat. `key` makes it once per session; `gap` keeps notes from piling up. */
  function note(text, actions = [], { key = '', gap = 20e3 } = {}) {
    if (!on()) return;
    if (key && said.has(key)) return;
    if (Date.now() - lastNote < gap) return;
    if (key) said.add(key);
    lastNote = Date.now();
    const id = 'note-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    notes.set(id, actions);
    upsertAI({ id, role: 'assistant', text, done: true, note: true, ts: Date.now() }, false);
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
  function onJoin() {
    if (!isHost()) return;
    setTimeout(() => note(`Hi ${hostName()}, I'm ${name()}, your producer. I'll drop tips here as the show goes. Ask me anything with @${name()}, or tap a starter below the chat.`,
      [{ label: 'Write my intro', run: ask(STARTERS[0][1]) }], { key: 'hello', gap: 0 }), 1800);
  }

  /** Every chat message from any source passes here (app.js pushFeed). */
  function onFeed(m) {
    lastChat = Date.now(); quietSaid = 0;
    if (!on() || !m || m.src === 'studio' || m.src === 'ai') return;
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
    if (!on()) return;
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

  return { note, noteActions, onJoin, onFeed, draft };
}
