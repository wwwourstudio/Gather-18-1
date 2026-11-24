// Auto highlight clips: big moments mark themselves in the clip buffer, so the host never has to remember to press
// Mark clip. A moment is a burst of chat, a burst of reactions, or a super chat. At most one automatic moment every
// 45 s (a super chat waits only 15 s). Sam says what it clipped in the studio chat, with a button to save it as 9:16.
// Created by app.js through createAutoMoments(app). Turned off with Clip & post → "Clip big moments for me".
export function createAutoMoments({ store, isHost, inStudio, mark, note, save }) {
  const chatTimes = [], reactTimes = [];
  let last = 0;
  const on = () => isHost() && inStudio() && store.get('autoClips', true);

  function fire(label, kind, gap = 45e3, why = '') {
    if (!on() || Date.now() - last < gap) return null;
    last = Date.now();
    const m = mark(label, kind);
    if (m) note?.(`Clipped that: ${why || label.toLowerCase()}. It's in Audience → Clip & post.`, [{ label: 'Save 9:16', run: () => save?.(m, '9:16') }], { gap: 0 });
    return m;
  }
  const recent = (arr, ms) => { const from = Date.now() - ms; while (arr.length && arr[0] < from) arr.shift(); return arr.length; };

  /** Every chat message (app.js pushFeed). A spike is 8+ viewer messages in 15 s, well above the minute before. */
  function onFeed(m) {
    if (!m || m.src === 'studio' || m.src === 'ai') return;
    chatTimes.push(Date.now());
    const burst = recent(chatTimes, 15e3);
    if (burst < 8) return;
    const minute = chatTimes.filter((t) => t >= Date.now() - 75e3 && t < Date.now() - 15e3).length;
    if (burst >= Math.max(8, (minute / 4) * 3)) fire('Chat spike', 'auto-chat', 45e3, `the chat went wild (${burst} messages in 15 s)`);
  }
  /** Every reaction from the watch page. A burst is 12+ in 10 s. */
  function onReact() {
    reactTimes.push(Date.now());
    const n = recent(reactTimes, 10e3);
    if (n >= 12) { fire('Reaction burst', 'auto-react', 45e3, `${n} reactions in 10 s`); reactTimes.length = 0; }
  }
  /** A paid super chat. */
  function onSuper(item) {
    const amt = Number(item?.amount) || 0;
    fire(`Super chat from ${String(item?.name || 'a viewer').slice(0, 30)}`, 'auto-super', 15e3, `a $${Number.isInteger(amt) ? amt : amt.toFixed(2)} super chat from ${item?.name || 'a viewer'}`);
  }
  return { onFeed, onReact, onSuper };
}
