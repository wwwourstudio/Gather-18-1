// Live viewers, all platforms: one pill on the stage (host only) with the total and a per-platform breakdown.
//   - Watch page: people on gather's own watch page (the same cached feed viewers poll).
//   - YouTube: concurrentViewers of the connected live video, when Google is signed in (livechat.js sets S.ytVideoId).
//   - Rumble: watching_now from the Rumble Live Stream API the host already connected for chat (S.platViewers.rumble).
// Twitch, Kick and the others don't publish a count without their own API keys, so they're listed as "no count".
import { googleSignedIn, youtubeViewers } from './google.js';

const $ = (s, r = document) => r.querySelector(s);
const NAMES = { watch: 'Watch page', youtube: 'YouTube', rumble: 'Rumble' };

export function createViewerCount({ S, isHost }) {
  S.platViewers ||= {};
  let lastYt = 0;

  async function refresh() {
    if (!S.studio || !isHost()) return render();
    try {
      const f = await (await fetch(`/api/studio?action=wfeed&studio=${encodeURIComponent(S.studio)}`)).json();
      S.platViewers.watch = Number.isFinite(f?.viewers) ? f.viewers : S.platViewers.watch;
    } catch {}
    if (S.ytVideoId && googleSignedIn() && Date.now() - lastYt > 30_000) {
      lastYt = Date.now();
      try { S.platViewers.youtube = await youtubeViewers(S.ytVideoId); } catch { S.platViewers.youtube = null; }
    }
    if (!S.ytVideoId) delete S.platViewers.youtube;
    render();
  }

  function render() {
    const pill = $('#stageViewers'); if (!pill) return;
    const on = !!S.studio && isHost();
    pill.hidden = !on;
    if (!on) return;
    const known = Object.entries(S.platViewers).filter(([, n]) => Number.isFinite(n));
    const total = known.reduce((t, [, n]) => t + n, 0);
    $('#stageViewersN').textContent = total.toLocaleString();
    const live = (S.live?.names || []).filter((n) => !['YouTube', 'Rumble'].includes(n));
    const lines = [...known.map(([k, n]) => `${NAMES[k] || k}: ${n.toLocaleString()}`), ...live.map((n) => `${n}: no public count`)];
    const tip = `Watching live now${lines.length ? ' · ' + lines.join(' · ') : ''}`;
    pill.dataset.tip = tip;
    pill.setAttribute('aria-label', `${total} watching live. ${lines.join('. ')}`);
  }

  setInterval(refresh, 15_000);
  setTimeout(refresh, 1500);
  return { refresh, render };
}
