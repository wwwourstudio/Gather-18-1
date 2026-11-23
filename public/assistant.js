import { cssEsc } from './ui.js';

// AI: one assistant that answers and runs the studio (streamed agent replies, actions, show on stage).
// Created by app.js through createAssistant(app): `app` carries the studio state and helpers this part uses.
export function createAssistant(app) {
  const {
    $, $$, store, S, isHost, toast, wsSend, setStage, stageElements, withDefaults, AI_NAME, plainMd,
    elementsCopy, freeSpot, patchEl, autoGrow, appendLog, setTab, offerOpen, askProducer
  } = app;
  // ---------------------------------------------------------------- AI: one assistant that answers and runs the studio
  // The host's own Claude, ChatGPT, Gemini or Grok key. Answers stream into the AI panel; any answer can be put on
  // stage (the AI window shows the pinned answer, or the latest one). Guests receive the conversation read-only.
  S.ai = { items: [], busy: false };
  S.aiProv = store.get('aiProv', 'claude');
  const AI_DEFAULT_MODEL = { claude: 'claude-opus-5-5', openai: 'gpt-5.5', gemini: 'newest Gemini Flash (automatic)', grok: 'grok-4.7' };
  const aiSync = new Map(); // id -> timer, so streaming answers reach guests a few times a second, not per token
  function upsertAI(item, local = true) {
    if (!item?.id) return;
    if (item.id === 'clear') { S.ai.items = []; renderAILog(); return; }
    const i = S.ai.items.findIndex((x) => x.id === item.id);
    if (i >= 0) S.ai.items[i] = { ...S.ai.items[i], ...item }; else S.ai.items.push({ ...item });
    if (S.ai.items.length > 40) S.ai.items.splice(0, S.ai.items.length - 40);
    renderAILog();
    if (!local || !S.studio || !isHost()) return;
    const send = () => { aiSync.delete(item.id); const cur = S.ai.items.find((x) => x.id === item.id); if (cur) wsSend({ type: 'ai', item: cur }); };
    if (item.done) { clearTimeout(aiSync.get(item.id)); send(); }
    else if (!aiSync.has(item.id)) aiSync.set(item.id, setTimeout(send, 450));
  }
  const aiOnStage = () => (S.state.elements || []).some((e) => e.type === 'ai' && !e.hidden);
  /** The answer the AI window shows: the pinned one, else the newest. */
  function stageAnswer() {
    const answers = S.ai.items.filter((i) => i.role === 'assistant');
    return answers.find((i) => i.pinned) || answers[answers.length - 1] || null;
  }
  function actLabel(a) {
    return { open: `Found “${a.label || a.url}”`, scene: `Switched to ${a.name}`, present: `Presenting ${a.name}`, stop: 'Stopped presenting', banner: `Banner: ${a.text}`, hide_banner: 'Banner hidden', countdown: `${a.minutes}-minute countdown` }[a.type] || a.type;
  }
  function actChip(a, withOpen = true) {
    const li = document.createElement('li'); li.className = 'act-chip';
    li.textContent = actLabel(a);
    if (a.type === 'open' && withOpen && isHost()) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn link'; b.textContent = 'Open';
      b.onclick = () => offerOpen(a.url, a.label);
      li.append(b);
    }
    return li;
  }
  // The AI's conversation lives in the live chat, in time order with everything else: each item is one <li> in
  // #msgs keyed by data-aid, replaced in place as it streams.
  const aiShown = new Set();
  function aiItemLi(it, host, shown) {
    const li = document.createElement('li'); li.className = 'msg ai-msg ' + it.role + (it.error ? ' error' : '');
    li.dataset.aid = it.id; li.dataset.src = 'ai';
    if (it.role === 'user') {
      const who = document.createElement('div'); who.className = 'who';
      const b = document.createElement('b'); b.textContent = 'You'; const to = document.createElement('span'); to.textContent = '→ ' + S.aiName;
      who.append(b, to);
      const t = document.createElement('div'); t.className = 'bubble'; t.textContent = it.text; li.append(who, t); return li;
    }
    const who = document.createElement('div'); who.className = 'who';
    const orb = document.createElement('i'); orb.className = 'orb'; orb.setAttribute('aria-hidden', 'true');
    const nm = document.createElement('b'); nm.textContent = S.aiName;
    const via = document.createElement('span'); via.textContent = AI_NAME[it.provider] ? 'AI · ' + AI_NAME[it.provider] : 'AI';
    who.append(orb, nm, via);
    const txt = document.createElement('div'); txt.className = 'txt'; txt.textContent = plainMd(it.text || '') || (it.done ? '' : ' ');
    if (!it.done) txt.classList.add('streaming');
    li.append(who, txt);
    if (it.actions?.length) { const ul = document.createElement('ul'); ul.className = 'act-chips'; ul.append(...it.actions.map(actChip)); li.append(ul); }
    if (host && it.done && !it.error && it.text) {
      const row = document.createElement('div'); row.className = 'msg-tools';
      const on = shown?.id === it.id;
      const st = document.createElement('button'); st.type = 'button'; st.className = 'btn sm' + (on ? ' on' : ''); st.dataset.stage = it.id;
      st.textContent = on ? 'On stage' : 'Show on stage'; st.setAttribute('aria-pressed', on);
      st.onclick = () => (on ? takeAnswerOff() : showAnswer(it.id));
      const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn sm ghost'; cp.textContent = 'Copy';
      cp.onclick = () => navigator.clipboard?.writeText(plainMd(it.text)).then(() => toast('Copied.'), () => toast('Couldn’t copy.', { err: true }));
      row.append(st, cp); li.append(row);
    }
    return li;
  }
  function renderAILog() {
    const log = $('#msgs');
    if (!log) return;
    const host = isHost(), shown = aiOnStage() ? stageAnswer() : null;
    const ids = new Set(S.ai.items.map((it) => it.id));
    for (const li of log.querySelectorAll('li[data-aid]')) if (!ids.has(li.dataset.aid)) { li.remove(); aiShown.delete(li.dataset.aid); }
    for (const it of S.ai.items) {
      const cur = log.querySelector(`li[data-aid="${cssEsc(it.id)}"]`);
      if (cur) { cur.replaceWith(aiItemLi(it, host, shown)); continue; }
      if (aiShown.has(it.id)) continue; // trimmed off the top of a long chat: don't bring it back at the bottom
      aiShown.add(it.id); appendLog(aiItemLi(it, host, shown));
      if (S.tab !== 'chat' && it.role === 'assistant') { S.unread++; $('#chatBadge').hidden = false; }
    }
    if (!S.ai.items.length) aiShown.clear();
    $('#chatEmpty').hidden = !!log.children.length;
    const last = S.ai.items[S.ai.items.length - 1];
    if (last && !last.done) { const body = log.parentElement; if (body.scrollHeight - body.scrollTop - body.clientHeight < 160) body.scrollTop = body.scrollHeight; }
  }
  /** Put one answer in the AI window, adding the window to the stage (without changing the scene) if needed. */
  function showAnswer(id) {
    if (!isHost()) return;
    for (const it of S.ai.items) if (it.role === 'assistant' && !!it.pinned !== (it.id === id)) upsertAI({ id: it.id, pinned: it.id === id });
    const els = stageElements(), cur = els.find((e) => e.type === 'ai');
    if (cur) { if (cur.hidden) patchEl(cur.id, { hidden: false }, 'show'); else renderAILog(); return; }
    const e = withDefaults({ type: 'ai' });
    const spot = freeSpot(e, els);
    if (spot) Object.assign(e, spot); else if (spot === false) e.stack = true;
    e.home = [e.x, e.y, e.w, e.h];
    setStage({ elements: [...els, e] });
    toast(spot === false ? 'The answer is on stage, stacked: there was no free spot. Move it in Layouts.' : 'The answer is on stage.');
  }
  function takeAnswerOff() {
    if (!isHost()) return;
    setStage({ elements: elementsCopy().filter((x) => x.type !== 'ai') });
  }
  function renderAIPanel() {
    const host = isHost();
    $$('#aiProv button').forEach((b) => { const on = b.dataset.prov === S.aiProv; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    const key = store.get('aiKey:' + S.aiProv, '');
    if (document.activeElement !== $('#aiKey')) $('#aiKey').value = key;
    $('#aiModel').placeholder = AI_DEFAULT_MODEL[S.aiProv];
    if (document.activeElement !== $('#aiModel')) $('#aiModel').value = store.get('aiModel:' + S.aiProv, '');
    $('#aiKeyLabel').textContent = `${AI_NAME[S.aiProv]} API key`;
    $('#aiKeyHelp').innerHTML = { claude: 'Get one at <b>console.anthropic.com</b>. Includes live web search.', openai: 'Get one at <b>platform.openai.com</b>.', gemini: 'Get one at <b>aistudio.google.com</b>. Includes Google Search.', grok: 'Get one at <b>console.x.ai</b>.' }[S.aiProv];
    // Setup opens by itself until there's a key (or a free allowance); after that it folds into the settings button.
    const house = !key && S.houseAI;
    if (host && !key && !house && !S.aiSetupSeen) { S.aiSetupSeen = true; setAiSetup(true, false); }
    const state = { idle: 'ready', listening: 'listening…', thinking: 'thinking…', speaking: 'speaking' }[S.aiStatus];
    $('#aiSub').textContent = !host ? 'The host’s producer and researcher' : key ? `${AI_NAME[S.aiProv]} · ${state}` : house ? `Free allowance · ${S.houseLeft ?? S.houseAI.daily} left today · ${state}` : `Add a ${AI_NAME[S.aiProv]} key to start`;
    $('#aiHouseNote').hidden = !S.houseAI;
    if (S.houseAI) $('#aiHouseNote').textContent = `No key? You get ${S.houseAI.daily} free requests a day per studio. Your own key has no limit.`;
    $('#aiInput').disabled = !host; $('#aiAsk').disabled = !host || S.ai.busy;
    if (S.ai.busy) $('#aiAsk').setAttribute('aria-busy', 'true'); else $('#aiAsk').removeAttribute('aria-busy');
    $('#aiHostNote').hidden = host;
    $('#chatToAi').textContent = 'Ask ' + S.aiName; $('#chatFilterAi').textContent = S.aiName;
    $('#aiInput').placeholder = `Ask ${S.aiName} or tell it what to do…`;
    $('#chatHint').textContent = host ? `Studio only · @${S.aiName} asks your AI` : 'Only people in the studio see this';
    if (!host && S.chatTo === 'ai') setChatTo('chat', false);
    renderAILog();
  }
  // The AI tab is its settings; talking to it happens in the live chat.
  function setAiSetup(open, focus = true) {
    if (!open) return;
    if (focus) { setTab('ai'); (store.get('aiKey:' + S.aiProv, '') ? $('#aiName') : $('#aiKey')).focus(); }
  }
  $('#aiSetupBtn').onclick = () => setTab('ai');
  $('#aiSetupDone').onclick = () => { setTab('chat'); setChatTo('ai'); };
  /** Who the composer sends to: the studio chat or your AI. */
  function setChatTo(to, focus = true) {
    if (to === 'ai' && !isHost()) to = 'chat';
    S.chatTo = to;
    $$('#chatTo [data-to]').forEach((b) => { const on = b.dataset.to === to; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('#chatForm').hidden = to === 'ai'; $('#aiForm').hidden = to !== 'ai'; $('#aiEmpty').hidden = to !== 'ai';
    document.querySelector('[data-panel="chat"]').classList.toggle('to-ai', to === 'ai');
    if (focus) (to === 'ai' ? $('#aiInput') : $('#chatInput')).focus();
  }
  $$('#chatTo [data-to]').forEach((b) => b.addEventListener('click', () => setChatTo(b.dataset.to)));
  // Filters: everything, or just viewers, questions, super chats or the AI.
  $$('#chatFilter [data-f]').forEach((b) => b.addEventListener('click', () => {
    $$('#chatFilter [data-f]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
    $('#msgs').dataset.f = b.dataset.f;
    const body = $('#msgs').parentElement; body.scrollTop = body.scrollHeight;
  }));
  $$('#aiProv button').forEach((b) => b.addEventListener('click', () => { S.aiProv = b.dataset.prov; store.set('aiProv', S.aiProv); renderAIPanel(); }));
  $('#aiKey').addEventListener('change', (e) => { store.set('aiKey:' + S.aiProv, e.target.value.trim()); toast(e.target.value.trim() ? `${AI_NAME[S.aiProv]} key saved in this browser.` : 'Key removed.'); renderAIPanel(); });
  $('#aiModel').addEventListener('change', (e) => store.set('aiModel:' + S.aiProv, e.target.value.trim()));
  $('#aiClear').onclick = () => { S.ai.items = []; renderAILog(); if (S.studio && isHost()) wsSend({ type: 'ai', item: { id: 'clear', role: 'system', text: '', done: true } }); };
  $$('#aiSugg .chip').forEach((b) => b.addEventListener('click', () => { const t = $('#aiInput'); t.value = b.dataset.q; autoGrow(t); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }));
  $('#aiForm').addEventListener('submit', (ev) => { ev.preventDefault(); const t = $('#aiInput'); const v = t.value; t.value = ''; autoGrow(t); askProducer(v); });

  return { upsertAI, stageAnswer, actChip, renderAILog, renderAIPanel, setAiSetup };
}
