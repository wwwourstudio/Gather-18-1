# gather: gaps, broken workflows and what to build next (November 2026)

This plan comes from this round's work: the test suites (29), two runs of the UI audit (`scripts/audit.ts`), screenshots at 1440 / 1024 / 390, reading the code, and a check against StreamYard, Riverside, Restream and Whatnot. Each item says what's wrong, who it hurts, and the fix.

## 0. Ship what's done

The work since the module split is on branches, not on `main`:

- `feat/sales-and-popout-chat`: sales report, pop-out chat.
- `feat/mobile-home` (builds on it): home page, rail, deck, Audience, Get paid, payments in the app, watch page, raise hand, Sam in chat.

Merging `feat/mobile-home` into `main` brings both.

**Before it goes live, set these on the deployment:**

- `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`. Without them, super chats, tips, card checkout and auction payments are off, because payments are now card only, in the app.
- `HOUSE_AI_PROVIDER` + `HOUSE_AI_KEY`. Without them, Sam can't answer viewers.

## 1. Broken workflows (fix first)

| # | Where | What's broken | Fix |
|---|---|---|---|
| B1 ✅ | Studio → Clip & post | **Clip export doesn't work.** `recordVerticalClip` draws `#stage` (a `<div>`) onto a canvas, which throws. It also records the *next* 5 seconds, not the moment you marked, so even when fixed, "Mark clip" and "Auto shorts" never contain the highlight. | Keep a rolling 60-second buffer of the program (MediaRecorder on the stage canvas plus the mix, chunks in memory). A mark saves its time. Export cuts that window from the buffer, crops to 9:16 and adds the caption. |
| B2 ✅ | Studio on phones | **The studio can't be used on a phone.** The side panel opens as a fixed sheet over the scene strip. The bottom tab bar sits under the dock, so scenes, people and tabs can't be reached. | A phone layout: stage on top; the dock as the bottom bar; a tab bar above it; panels as a sheet that opens from a tab and closes with a swipe or tap; the deck as a horizontal strip under the stage. |
| B3 ✅ | Payments without Stripe | With no Stripe keys on the site, the green $ is greyed out. Auction winners are told "the host will be in touch", and shop items open the store's own site. The host has no in-app way to get paid until Stripe is set up. | Make the Stripe setup obvious: one "Get paid" checklist in Audience → Get paid (site keys present → connect your Stripe → test payment), and an empty-state that says exactly what's missing. Consider a gather-held Stripe platform account so hosts only connect. |
| B4 ✅ | Studio → incoming super chats | The host-side "Check it arrived, then confirm" flow for app-paid super chats can no longer receive anything (the server refuses them), but the code is still there. | Delete the pending/confirm UI and server branch (`audience.js` pending handling, `hostSuperchat` confirm for non-card). |
| B5 ✅ | Raise hand → Bring on | The studio matches the arriving guest to the raised hand **by name**, so two viewers with the same name could be put on stage wrongly. "Join by voice" turns the camera off, but the green-room dialog can turn it back on. | Pass the lobby entry id through the join (the pass already contains it) and stage that member id. Lock the camera off in the green room for voice joins. |
| B6 ✅ | Studio layout at 1024 / 1440 | The audit found: the green-room dialog's Close button is under the top bar at 1440; Chat options' first switch is under the top bar at 1024; "Use a photo" and "Remove" overlap in the profile hint. | Give dialogs and popovers a top inset below the 52 px header; fix the overlap. |
| B7 ✅ | UI audit script | Its feature checks crash on old selectors (AI chat, AI image maker, banner editing, PDF, QR hide, video upload), so they report P1s that aren't real. The Present menu P0 was checked by hand and works. | Update `scripts/audit.ts` selectors to the current UI so the audit is trustworthy again. |

## 2. Gaps in workflows that exist but stop short

- **Live and People tabs on the watch page** were renamed but are still mostly empty states. Live should show the running poll, prediction, drop or auction as one card, with the queue under it. People should show who's here, top fans with XP and the host's moderators.
- **Sam for viewers** answers from what it's given. It can't see the picture, and the recap depends on live captions being on. Turn captions on by default for the transcript, even when they aren't shown on stage. Give Sam the last 10 minutes of captions, and allow a "@Sam recap" command.
- **Total live viewers** counts the watch page, YouTube and Rumble. Twitch and Kick need their API keys (Twitch Helix client id; Kick's public API is blocked by Cloudflare from servers). Add Twitch via the host's Twitch sign-in.
- **Sales report** keeps 30 days and lists one show at a time. There's no history across shows, no payouts view, and no refunds.
- **Notifications** still stack: toasts, the scene suggestion pill and the "Next:" coach can all show at once. Use one queue, one at a time.
- **Light mode** in the studio: several panels still use dark-only fills.
- **Recording** is local only. Nothing uploads automatically, there are no per-guest tracks, and a closed tab loses the recording.
- **Watch-page chat** polls every 2 seconds, so messages arrive 2–4 s late. Use server-sent events on the long-running server and keep polling on Vercel.

## 3. Features to build (from the competitor check)

In order of value for effort:

1. **AI highlight clips after the show** (Riverside Magic Clips, StreamYard AI Clips). This builds on B1's buffer, plus the recording, super chats, hype spikes and captions. It suggests 5–10 vertical clips with captions, ready to post. The biggest gap with creator studios.
2. **Cart and one checkout** for live shopping (TikTok Shop, Amazon Live): several pinned items, one Stripe session.
3. **Spend XP on rewards** (Twitch channel points): host-defined rewards like song pick, shoutout or "join the stage". XP is earned today but can't be used.
4. **Instant replay on stage** (OBS replay buffer): play the last 30 s back from B1's buffer.
5. **Per-guest recordings** (StreamYard ISO): each guest records their own track and uploads it when the show ends.
6. **Shoppable replays with chapters** (Amazon Live): the replay with product links at the times they were shown.
7. **Shopify sync** (Whatnot, April 2026): products, stock and orders in sync both ways.
8. **Simulcast in several aspect ratios** (StreamYard MARS): send 16:9 to YouTube and 9:16 to TikTok from one show.
9. **Producer seat** (StreamYard): a co-host who runs scenes and chat without being on camera.

## 4. Code health

- `app.js` is about 5,800 lines. The next extraction is stage drawing (about 550 lines), then signaling and peers.
- `style.css` is about 5,400 lines of layered overrides; this round replaced several layers (rail, Audience, deck) with single definitions. Continue panel by panel, moving colours to tokens.
- The CI suite takes about 25 minutes. Split it into parallel jobs.

## Suggested order

1. Merge to `main` and set the Stripe and house AI keys (section 0).
2. B1 clip buffer, then B2 phone studio, then B4 and B5 cleanups and B6 layout fixes.
3. The Live and People tabs, Sam recap, and one notification queue.
4. AI highlight clips (it reuses B1), then cart, then XP rewards.

---

# Plan, round 2 (after B1–B7)

Done since round 1: notification bar, phone studio, calmer scene cards, studio dock, Sam inside the studio chat,
the watch page glow.

**Only the site owner can do:** set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `HOUSE_AI_PROVIDER` and `HOUSE_AI_KEY` in hosting.

| # | What | How | Done when |
|---|------|-----|-----------|
| R1 ✅ | **Vertical and widescreen at once** | The compositor draws each frame twice: the 16:9 program, then a 9:16 companion on a second canvas. Built-in layouts reflow (stack instead of side by side); custom scenes map to the matching vertical template (slides → Vertical presentation, AI → Vertical AI, chat → Vertical + chat, 2+ people → Stacked duo, else Vertical solo); lower third, ticker and logo move to their vertical spots. Each destination gets a format (Auto: TikTok and Instagram tall, the rest wide). Go live opens one relay lane per format; the relay allows one stream per studio *per lane*. A "Tall preview" shows the companion. | TikTok gets 9:16 and YouTube 16:9 from one Go live; tests cover the lane split and the companion render. |
| R2 ✅ | **Watch page Live and People tabs** | Live: the running poll, prediction, auction or drop as one card plus the play-with-me line. People: who's here, top fans, moderators. | Tabs show real data from the feed; test. |
| R3 ✅ | **@Sam recap** | A viewer types "@Sam recap" or taps "What did I miss?": Sam summarises the last 10 minutes of captions and chat. | Answer in the watch chat; test with a mocked AI. |
| R4 ✅ | **Instant replay** | The host taps Replay: the last 30 s from the clip buffer plays on stage as a media layer, then the scene comes back. | Replay plays and returns; test. |
| R5 ✅ | **Auto highlight clips** | Chat spikes, super chats and big reactions mark a moment by themselves (rate-limited) and show in Moments. | Moments appear without a click; test. |
| R6 ✅ | **Cart** | Viewers add several shop items, then pay once with Stripe Checkout. | One checkout for many items; pay test with the Stripe mock. |
| R7 | **Spend XP** | Viewers spend XP on a highlighted message or a song request. | XP goes down and the reward shows; test. |

Order: R1 → R2 → R3 → R4 → R5 → R6 → R7. After each: `npm run check`, the affected suites, commit, push to main.
