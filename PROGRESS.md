# gather: progress

## Watch party and studio: join the show, Sam in chat, clips, viewer count

- **Raise your hand:** the hand in the watch chat opens Join on camera / Join by voice / Leave a voice message / Ask in chat. Joining knocks on the studio's waiting room ("Raised hand · camera", with **Bring on**); once let in, **Join now** opens the studio with a one-time pass, straight in, and the host's studio puts them on stage. Suite: `hand`.
- **Sam in the watch chat:** anyone can @Sam (or tap ✦ Ask Sam). The question and Sam's answer show for everyone. Sam answers from the show's facts (about, links, what's next, notices, shop, poll, recent captions and chat) and explains the page; it never runs anything for a viewer. Uses the site's house AI key (`HOUSE_AI_PROVIDER` + `HOUSE_AI_KEY`); limits: one question per viewer every 8 s, 15 a day per viewer, 300 a day per show. Without a key, viewers are told Sam isn't on. Suite: `sam`.
- **The chat never starts empty:** the streamer's welcome is the first message (pinned), then Sam's hello and one-tap starters (Say hi, Let's go, Ask Sam, What did I miss?). Messages slide in; paid ones glow once.
- **Sidebar tabs:** Chat, Live (polls, drops, queue), People. The emoji row and the separate Tip button are gone; the green $ in the chat box greys out when tips aren't available.
- **Show & Host drawer:** flush right, rounded inside edge only, a real show card, and About this show (about, notices & links, what's next, AI spotlight) moved in from the tab under the video.
- **Watch page:** the page-wide blurred live video works again; the green "Direct · 0.1 s" badge is gone; the show card's photo fits its ring (no second avatar).
- **Studio:** host-only **Mark clip** on the stage on hover; a **watching** pill with the total live viewers (watch page, YouTube when Google is connected, Rumble) and a breakdown on hover; scene cards under the video use the Scene templates design.
- **Not done:** the Live and People tabs got new names but not new content; Twitch and Kick viewer counts need their API keys.

## Design pass: home on phones, rail, deck, Audience, Get paid

- **Home page on phones and tablets:** one screen tall like desktop. Heading and subtitle two lines each, then Go Live and Join, then the preview cut off at the bottom. Removed everything under the preview (two feature-card lists, the platform strip, the footer). Fixed light-mode contrast in the preview and the Schedule link.
- **Sidebar rail:** one definition replacing about eight layers of overrides. No background on hover or when selected; selected = accent icon, bold label and a short accent bar. Nothing scales or moves, so hovering doesn't flicker.
- **Under the video:** underline tabs, quiet filter chips with 28px tap targets, outlined scene and people cards (accent ring when selected), and suggestion copy that fits ("Just 1 on stage. Use Solo?").
- **People cards:** "mic on" / "muted" / "no mic" now uses the same test as the muted badge, so they can't disagree. On stage, the muted icon sits inside the name tag.
- **Audience tab:** Audience, Polls and Play share one header (same icon, single row of tabs, status pinned so nothing shifts). "Stage" sub-tab renamed "Studio". Switches are a plain list, not cards inside cards; section hints wrap instead of being cut off.
- **Get paid:** "Card payments" (Stripe status, Take super chats, minimum) and "Tip QR cards on stage", moved here from Shop. The duplicate PayPal / Venmo / Cash App fields are gone.
- **Payments stay in the app:** super chats are paid by card in Stripe's embedded checkout on the watch page, nothing else. The server refuses "paid in another app" super chats, no longer sends payment handles to viewers, and an auction won without card payments no longer hands out outside pay links. A new "Your watch page" tip QR card sends platform viewers to the in-app card tray (`/w/<studio>?tip=1`).
- **Watch page:** the Made in Texas bar is gone (Terms and Privacy stay in sign-in).
- **Audit script** updated to the current flow (agree to Terms, "Start a broadcast" step, tip cards in Get paid).
- **Not done yet:** the studio on phones: the side panel covers the scene strip and the bottom tab bar sits under the dock. It needs its own mobile layout.

## Competitor round: seller analytics and pop-out chat

Checked against StreamYard (April 2026 updates), Riverside, Restream and Whatnot (2026 seller tools). gather already had a go-live ready check, so this round adds the two gaps that matter most and were cheap to do well.

- **Sales this show** (Shop panel, top). Live totals for shop sales, auction wins and super chats, buyers and viewers, top buyers, best sellers, and a CSV of every line. This is Whatnot's live seller panel.
  - The server keeps a sales ledger (`g:<studio>:orders`, 30 days). Shop orders without Stripe and auction wins are now recorded too. When an auction is paid by card, its win is marked paid.
  - Host-only `sales` op in `lib/studio.js`; report built by `hostSales` in `lib/watch.js`; panel in `public/sales.js`.
  - CSV cells that start with `= + - @` are escaped so spreadsheets don't run them as formulas.
- **Pop-out chat.** Chat options → **Pop out chat** opens the viewer chat in its own window, for a second screen or an OBS browser source. **On your phone** shows a QR code for the same page. This is StreamYard's pop-out chat.
  - The page is the watch page with `?chat=1`: chat only, filling the window, and it pulls no video, so it doesn't use a viewer seat.
- **Tests:** `auction` checks the sales panel and CSV; new `popchat` suite.
- The watch page's start-up code had landed inside `watch-superchat.js` during the module split; it's back in `watch.js`.
- **Next:** AI highlight clips after the show (Riverside Magic Clips, StreamYard AI Clips).

## Module split

`public/app.js` was 9,346 lines and `public/watch.js` 3,229. Both are now split by feature. The moved code is unchanged.

- **How it's wired:** each module exports `createX(app)`. `app` hands over the state and helpers the module uses, with getters for anything that gets reassigned. The module returns what the rest of the page calls, and `app.js`/`watch.js` keep one-line forwarders, so call order is the same as before.
- **Studio (`app.js`, now about 5,800 lines):**
  - `audience.js`: watch page settings, bounties, Stripe card payments, shop, polls, play-with-me queue, emotes, voice questions
  - `livechat.js`: mood meter, moderation, message chrome, YouTube and Rumble chat
  - `golive.js`: recording and going live
  - `account.js`, `designer.js` (AI designer), `broadcast.js` (stream tab and launchpad), `invite.js`
  - `assistant.js` (the AI panel) and `producer.js` (the AI producer and speech recogniser)
- **Watch page (`watch.js`, now about 2,080 lines):** `watch-stats.js`, `watch-superchat.js`, `watch-deck.js`, `watch-party.js`, `watch-clip.js`, `watch-hub.js`.
- **Still in `app.js`:** stage drawing, signaling and peers. Stage drawing is the next candidate.

### Removed
- Unused functions and imports: `generateLookAsset`, `drawGoal`/`goalRaised` (the goal shows on the watch page only), `chooseLayout`, `revealSide`, `AI_COLOR`, `callinLink`, `syncThemeSelection`, `syncMoodState`, `withBusy`.
- Code for elements that no longer exist: the old watch-page mood meter, `wJoinBtn`, `wCntNext`, `moreLayoutsBtn`, `knockNote`, `wAiProv`, `wpJoin`, `chatMoodMeta`.
- The "Moderation & AI Guard" drawer in studio chat. Its button had no code behind it. The markup and about 140 lines of CSS are in git history if it gets built.
- `_pw_verify/`: one-off verification scripts nothing referenced.

The stack is plain ES modules in the browser plus Node serverless functions on Vercel (`api/`, `lib/`). There is no TypeScript, no bundler and no lint config, so verification is `node --check` on every file plus Playwright end-to-end suites.

## Round 5 (this round)

### Presenting
- You can drop a PDF, video or image anywhere on the stage, or click an empty presentation area to pick one. Images are also in the Present menu.
- The "Full-screen slides" scene puts the slides edge to edge, with cameras as small blocks on the right. Presenting switches to this scene automatically.
- The slide and video controls sit on the stage as glass. Only the presenter sees them; they are DOM elements, not drawn into the program.

### QR cards
- Support-link and call-in cards draw the QR on whole-pixel cells, sized larger, from a normalised `https://` link.

### Host controls
- From each person card the host can put them on or off stage, ask them to mute, or remove them (two clicks to confirm). The server blocks a removed person's session.
- **Lock** sends new guests to a waiting room. The host gets a chime, and the deck jumps to **Waiting**, where the host can let them in or decline.

### Call-in line
- `/c/<code>` is a WebRTC call-in link. Callers always queue for the host to admit them.
- The call-in QR card can go on stage. It has a headline and an optional phone or note line.

### Studio layout
- The studio column no longer scrolls. The stage sizes to the space left (container query).
- The deck below it swaps Scenes, In the studio and Waiting. Mouse wheel and swipe animate between them.
- People cards are compact, sized like scene cards.

### Camera-off tile
- The tile shows the person's own uploaded background (Settings → Camera-off background), or a blur of their photo.
- Voice rings and a level meter are smoothed with attack and release.

### Brand
- **Panels:** Glass or Solid colour, applied to the AI window, chat overlay and camera-off tiles.
- **Logo:** has its own section.
- **Sponsors & ads:** up to 8 rotating images, with a position and duration. A sponsor ad avoids the call-in card's corner.

### Background images
- Pictures (avatar, camera background, camera-off background, brand images) moved from localStorage to IndexedDB. The ~5 MB quota had been silently dropping new pictures, which is why background images couldn't be changed.

### AI producer
- You name it (default "Sam").
- You can type to it from the stage orb, push-to-talk, or say "Hey Sam …" (Chrome/Edge).
- **What it can do:** switch scenes by name, present items from the media library, show and hide banners, start countdowns, and find YouTube videos or sites.
- **Opening a site or video:** browsers can't silently capture a page, so the host clicks "Open", then shares that window.
- **Voice:** "Me" (browser speech, only the host hears it), "Stream" (OpenAI TTS mixed into the stream and recording), or "Off".
- **Media library:** stored in this browser (IndexedDB). Saved scenes can open with a library item.

### Step into the studio
- New layout with background chips and camera/mic pickers, plus a "Waiting for the host" screen for locked studios and callers.

### Editor-only enforcement
- Host-only hints draw through `editorOnly()` onto `#editorCanvas`. That canvas sits over the stage and is never passed to `captureStream`. Hints covered: empty stage, empty camera slots, empty image and media placeholders.
- "You are presenting" was being recorded into the program. It is now the presenter's name.

## Verified
- Playwright suites e2e, feat, mod, twitch, round, round4 and the new round5 all pass. The only console errors are the sandbox blocking Twitch's websocket.
- round5 covers:
  - green-room chips
  - camera-off background sync, stored in IndexedDB
  - PDF drag and drop, full-bleed on the guest's screen, presenter-only controls
  - wheel deck swap with no page scroll
  - mute
  - lock, call-in knock and admit
  - removing a caller
  - call-in card, sponsor ad and solid panels syncing
  - AI producer switching scene and banner on the guest's screen (provider response mocked)
- editorOnly check: the empty-stage hint has 0 pixels on the program canvas and 3,190 on the editor canvas.
- Screenshots in `audit/screens`: `before-*` (previous commit) and `after-*` at 1440, 1024 and 390 for home, green room and studio, plus `r5-*` feature shots.

## Not done / known limits
- Platform restreaming (RTMP to YouTube, Twitch, etc.) still needs a relay; browsers can't send RTMP.
- The AI can't capture a website without the host's click and screen-share pick (a browser security rule).
- Phone-number dial-in (PSTN) isn't built. The call-in line is WebRTC links only; a phone field on the card can carry a number from an outside service.
- Removing someone ends their session, but they can come back through the link. Lock the studio to keep people out.
- Scheduled-stream email needs `RESEND_API_KEY`, `MAIL_FROM` and `APP_URL` set in Vercel.

## Audit (part A): no app changes
- `scripts/audit.ts` is a strict TypeScript Playwright audit. Node 22.18+ runs it directly, and it typechecks with `tsc -p scripts` (needs `playwright` and `typescript` installed).
- **What it covers, at 1440, 1024 and 390:**
  - It signs up a host, opens every panel, dialog, menu, dock tool and deck layer, and clicks every control.
  - File pickers are answered with `scripts/fixtures`.
  - It records errors and failed requests, flags dead controls, and checks overlap, overflow, off-screen controls, clipped text, tap targets and focusable hidden layers.
  - It also runs functional checks on the AI image maker, AI chat, AI voice, the AI producer, video upload, PDF presenting, QR hide, banner editing, the editor-only layer and the guest view.
- **Output:** `AUDIT.md`, `audit/findings.json`, and about 600 screenshots in `audit/screens/auto/` (gitignored, about 35 MB).
- **How the findings were triaged:**
  - Earlier runs produced false positives: hidden deck layers, the sticky phone dock, a light stage background mistaken for hint text, and the wizard's first step. The script now handles each of these correctly.
  - The editor-only check compares the host's and a guest's program frames pixel by pixel.
  - Confirmed root causes carry specific fixes in `KNOWN`.
- **Intermittent:** the pdf.js "same canvas during multiple render()" error showed up in 2 of 4 runs, when slide changes come in fast.

## Design tokens and primitives (part B)
- **`public/tokens.css`:** the single source of truth for every value, with a dark default and a light override. It covers:
  - colour
  - glass: `rgba(255,255,255,.06)`, `blur(20px) saturate(140%)`, 1px `rgba(255,255,255,.10)` border, inset top highlight, `0 8px 32px rgba(0,0,0,.35)` shadow, 2% SVG noise, and a solid fallback when `backdrop-filter` is unsupported
  - space on a 4px grid
  - radii 8/12/16
  - control heights 28/36/44
  - type: Plus Jakarta Sans for display, Inter for the UI
  - icons 16/20 at stroke 1.75
  - motion: 180ms ease-out, a `linear()` spring, and ~0ms under `prefers-reduced-motion`
  - layers
- **`public/ui.css` + `public/ui.js`:** the primitives.
  - Button (primary, secondary, ghost, danger, live, link, on-media), IconButton (plus stacked, mutes, light, primary, filled), SegmentedControl, Toggle (with row and inline forms), Pill, GlassPanel (plus raised and on-media), Popover (native `[popover]`, anchored, with MenuItem), Modal, Tooltip (from `data-tip` or the aria-label of icon-only buttons), Input, Tile and Spinner.
  - Every primitive has hover, active, focus-visible, disabled and loading (`aria-busy` via `busy()`), plus pressed or selected where it applies.
  - Primitives placed on video surfaces (`.stage`, `.on-media`) re-scope the tokens, so they read correctly in both themes.
- **`public/style.css`:** rewritten to only arrange primitives using tokens. Every interactive control in `index.html` and `app.js` now uses a primitive class. The audit checks this ("Control not built from a primitive").
- **Icons:** Lucide only (46 icons). `scripts/build-icons.ts` builds them into the `public/icons.svg` sprite. All 34 hand-drawn SVGs and the `✕ ↑ ↓` glyphs were replaced.
- **Fonts:** the UI loads only Inter and Plus Jakarta Sans. The stage's brand fonts (Onest, JetBrains Mono, Playfair, Bebas, DM Serif) load separately without blocking, and only the program canvas uses them.
- **Motion:**
  - Dragged layout boxes lift while dragging and settle back with a spring when released.
  - Deck layers and the Toggle knob move on the spring curve.
  - JS smooth scrolling also respects reduced motion.
- **Fixed by the primitives:** the phone Present menu (audit P0) is now a top-layer Popover, so the dock can no longer clip it. Chat time-outs use one shared Popover instead of `<details>`.
- **Verification:**
  - `/ui-kit.html` shows every primitive in every state.
  - `node scripts/ui-kit.ts` screenshots each state in both themes (`audit/screens/ui-kit/`, 214 images) and checks the token contract in the browser: heights, radii, icon size and stroke, fonts, tabular numbers, glass values, motion and reduced motion, Popover, Tooltip, loading state, no hand-drawn SVGs, and only two UI fonts.
  - `node scripts/ui-shots.ts before|after` captures 14 states × 3 widths (`audit/screens/before`, `audit/screens/after`).
  - All seven Playwright suites pass.

## Phase 3: layout engine and video effects
### Layers (public/layout.js)
- **Fixed tiers**, painted in this order:
  - stage (cameras, colour blocks)
  - media (presentation, images)
  - overlays (lower thirds, logo, QR and call-in cards, text, timers, AI window, sponsor ads)
  - chat & super chat
  - ticker
  - system (captions)

  Inside a tier, list order decides what's on top. Host-only editing UI stays on its own canvas and DOM, so it never reaches the program.
- **System layers:** banners, the ticker, the logo, sponsor ads, the featured chat card and captions used to be drawn at fixed spots. They are now real layers that can be moved, resized, hidden, locked, reset and saved per scene.
- **Editor:**
  - Drag, plus resize from all four corners.
  - Snapping to the 8px grid, the title-safe and action-safe areas, the stage centre and other layers' edges and centres. Guides show while you drag.
  - Arrow keys nudge 8px (Shift: 40px). Esc deselects. The selected box always sits on top, so you can grab it.
- **Collision avoidance:** layers can't overlap unless one is stacked on purpose: Alt-drag, the "Allow overlap" switch, or a preset that designs it.
  - A blocked move slides along the free axis and highlights the blocker in red.
  - Adding a layer finds the first free spot, or adds it stacked and says so.
  - A carried card that would collide in a new scene is hidden, and a toast says so.
  - Showing a hidden layer, or turning stacking off, never creates an overlap.
- **Layers list:** grouped by tier, with show/hide, lock and reset. Each layer's settings add stacking, picture-in-picture (a camera drawn above slides), bring forward / send back, a pixel readout and delete.
- **Per-scene memory:** every edit saves the scene's arrangement (IndexedDB, images included). Switching away and back restores it, the last scene and its arrangement come back after a reload, and "Reset scene" restores the design.
- **Presets:** Cinematic solo (2.39:1 letterbox), Interview panel, Slides + speaker (PiP), AI arena, Chat-led show and Newsroom. They're designed on 8px steps inside action-safe, with no unintended overlaps; this is checked in the browser by round6 and the preset audit. "Full-screen slides" (auto-present) and "Screen + AI" remain. The six generic templates they replace are gone.
- **Brand controls:** the logo position/size and sponsor position controls now move those layers.

### Green screen and background blur (public/fx.js)
- **Multi-pass WebGL2 pipeline.**
- **AI mask:**
  - Motion-adaptive temporal smoothing of the AI mask.
  - Joint-bilateral upsampling guided by the full-resolution frame.
- **Background blur:**
  - Premultiplied, mask-weighted background blur (three Gaussian rounds at quarter resolution), so no person-coloured halo.
  - Light wrap.
- **Chroma key:**
  - Keying on chromaticity (shading-invariant) with an off-hue penalty.
  - A 3×3 matte.
  - Hue-aware spill removal (chromaticity projection weighted by hue alignment, plus a channel limiter).
- **New controls:** automatic screen-colour pick from the frame border, plus spill, edge-softness and blur-amount controls.
- **Fixed:** a picture chosen before it finished loading never painted.
- **Measured by `node scripts/fx-bench.ts`** against ground truth: the previous algorithm, reimplemented exactly from commit 349f8aa, vs the current `fx.js` on identical synthetic frames (green screen with spill and shadow, room with noisy model-resolution masks, perfect-mask blur). Results are in `audit/fx-bench.json`:

| Measure | Before | After | Better by |
|---|---|---|---|
| Green screen matte error, whole frame | 0.0821 | 0.0129 | 6.4× |
| Green screen matte error, edges and hair | 0.2437 | 0.1293 | 1.9× |
| Green cast near the subject's edge | 14.8 | 7.0 | 2.1× |
| Subject colour error (noise floor) | 3.80 | 3.51 | 1.1× |
| AI mask error, whole frame | 0.0058 | 0.0028 | 2.1× |
| AI mask error, edges and hair | 0.1252 | 0.0606 | 2.1× |
| AI mask edge flicker | 0.0909 | 0.0115 | 7.9× |
| Blur halo (person colour in background) | 16.7 | 2.5 | 6.7× |

Three of the eight measures beat the "250% better" target (3.5×): the overall green-screen matte, edge flicker and blur halo. Edge and hair accuracy is about 2×, capped by the segmentation model's 256×144 mask. The geometric mean across all eight measures is 2.98× (198% better).

### Verified
- All eight Playwright suites pass, including the new round6 (layout engine).
- `scripts/ui-kit.ts` contract checks pass.
- Live green screen with auto key and a picture background, and live MediaPipe blur, were checked in Chromium with the fake camera.
- Screenshots are in `audit/screens/after` at 1440, 1024 and 390.

## Cut-out edges, blur halo and green-screen detection
Feedback: the line around the person was pixelated, Blur left a halo, and Green screen did nothing.
- **Guided filter** (He, Sun & Tang) in `public/fx.js`, at up to 640 px on float textures. It rebuilds a full-resolution, edge-following matte from the model's 256×144 mask, using the camera picture as the guide, so the outline lands on the real edge and comes out smooth instead of stair-stepped. Without float render targets, it falls back to the joint-bilateral path.
- **The MediaPipe general model** (`modelSelection: 0`), whose edges are more accurate than the landscape model's. Weak detections go through a confidence curve before refinement.
- **Stray-patch cleanup:**
  - The mask is split into connected regions at model resolution.
  - Kept: large regions, confident ones (a hand waved clear of the body) and anything entering from the bottom edge.
  - Dropped, together with their soft fringe: weak islands such as lamps, chair backs and posters.
- **Green screen with no screen.** Green screen only removes a real coloured backdrop. The app now samples the top and sides of the picture.
  - If no green or blue backdrop fills them, it says so and offers **Use Blur** and **Use Replace**.
  - If a backdrop is there but the picked colour is off, it picks the right one automatically.
  - "Pick automatically" ignores the bottom edge and requires a clearly green or blue backdrop. It used to be able to take a blue shirt as the screen colour.
- **Benchmark** (`npm run bench`): the mask simulation is now realistic, with a 2–3 px soft band, noise, jitter and false-positive patches. It saves close-ups to `audit/fx-bench-*.png`.

| Measure | Before | After | Better by |
|---|---|---|---|
| AI mask error, whole frame (incl. stray patches) | 0.0174 | 0.0033 | 5.3× |
| AI mask error, edges and hair | 0.1590 | 0.0705 | 2.3× |
| AI mask edge flicker | 0.1073 | 0.0176 | 6.1× |
| Blur halo | 16.7 | 2.3 | 7.3× |
| Green screen matte error, whole frame | 0.0821 | 0.0129 | 6.4× |

The geometric mean across all eight measures is 3.31× (231% better).
- **Verified:**
  - `npm run fx:live`, now in CI, runs the real app twice. With Chromium's green fake camera, the screen is found and there's no warning. With a room camera that has no screen, the warning shows and "Use Blur" switches to Blur. Blur and Replace never warn.
  - Screenshots: `audit/screens/fx-green-*.png`.
- **Limit:** fine hair strands thinner than the model can see are still smoothed into the head outline rather than kept strand by strand.

## V3: chrome, one AI assistant, one composer
See `AUDIT-V3.md` for the findings and plan. Screens: `audit/screens/v3-before` → `audit/screens/v3-after` (1440 / 1024 / 390).
- **Header:**
  - Just the wordmark until you're in a studio, so a title saved in an earlier session no longer appears while you're logged out or outside a studio. Inside a studio it shows the title and a plain-text connection status.
  - One button family: same height, radius and weight. Secondary buttons are quiet outlines. One primary button, which reads "Enter studio" or "Invite"; "Room details" opened the same dialog, so it's gone.
  - "Studio offline" is no longer shown on the home screen.
- **Filler copy removed:**
  - the header tagline
  - "Your studio. Your conversation."
  - "Your crew, connected."
  - the marketing panel subtitles (they're now one functional line each)
  - The home stage text now says what the product does.
- **Dock:** the Invite and Settings duplicates are gone (the header and the rail have them). There's a new assistant button, and "Leave" shortens on phones so the dock fits at 390.
- **AI, one assistant:**
  - The AI panel is a conversation with your assistant (default name Sam) that both answers questions and runs the studio. It replaces the separate "On-air AI" research box and the stage-only producer.
  - Setup (provider, key, model, name, voice, wake word) folds behind a settings button. It opens by itself only until a key is saved.
- **AI streams and acts:** `/api/ai` `mode: 'agent'` streams NDJSON events.
  - Claude gets real tool definitions (open a page, switch scene, present, stop, banner, hide banner, countdown) plus web search, in a tool loop. Tool input is validated, and non-https links are refused.
  - ChatGPT, Gemini and Grok reply with a JSON object mapped onto the same events.
  - Actions run as they arrive and show as chips under the answer.
  - The old plain-text research endpoint is removed.
- **On stage only when wanted:**
  - The permanent "Sam" chip over the program video is gone.
  - The assistant opens from the dock button or the `/` key in a floating bar that closes with Esc.
  - Each answer has **Show on stage** / **On stage**, which adds or removes the AI window without changing the scene. Pinning an older answer keeps it there; a new question takes over.
  - The AI window's empty state no longer shows editor instructions to viewers.
- **One composer** for chat, the AI panel and the command bar:
  - a rounded field that grows with the text, with an inline send button
  - Enter sends and Shift+Enter adds a line (chat is now multi-line)
  - a mic button for talking to the AI.
- **Verified:**
  - `tests/ai.test.js` runs `lib/ai.js` against a local stand-in for the Claude API. It covers the streamed text, tool calls becoming actions, an invalid link refused, tool results sent back with errors flagged, the host key used, and the JSON path.
  - round and round5 now cover "Show on stage keeps the scene" and "AI hidden until asked for".
  - All 10 suites, `npm run check`, `npm run ui-kit` and `npm run fx:live` pass.

## Monte Carlo roadmap, executed
`node scripts/roadmap-mc.ts` simulates 20,000 futures for 14 options: uncertain reach, impact, chance of working, build days and monthly cost, with sources and ranges listed in `ROADMAP-MC.md`. Group winners:

| Job | Winner | Wins its job |
|---|---|---|
| Go live | gather relay (WebSocket + FFmpeg) on Fly.io | 72% |
| TURN | Cloudflare Realtime TURN | 79% |
| Bigger studios | Cloudflare Realtime SFU | 69% |

- Cloudflare Stream was ruled out: its docs say browser (WHIP) inputs can't be restreamed.
- The SFU won its group but is too large for a 10-day plan.
- The 10-day plan was: first-run guide → AI allowance → go live → built-in TURN → watch page. All five shipped:

- **Built-in TURN** (`lib/studio.js`):
  - Each join gets 24-hour Cloudflare TURN credentials, minted on the server (the API token never reaches a browser) and cached for an hour.
  - Port-53 URLs are dropped. A Cloudflare outage falls back to STUN.
  - Env: `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`.
  - `tests/turn.test.js`.
- **First-run guide:** one next step at a time in the dock (name your show, camera and mic, invite, pick a scene, record or go live). Each step ticks itself off from what actually happened. You can hide it, and it's shown once.
- **AI allowance:**
  - With `HOUSE_AI_PROVIDER` + `HOUSE_AI_KEY` set, hosts without a key get `HOUSE_AI_DAILY` (default 25) assistant requests per studio per day. Each network address gets three studios' worth.
  - The panel shows how many are left. Over the limit, a clear message suggests adding your own key.
  - Tests are in `tests/ai.test.js`.
- **Go live:**
  - `relay/` is a Node + FFmpeg service (Dockerfile, fly.toml, README). The host's browser streams the program over WSS with a two-minute HMAC token, which gather issues to the host only.
  - H.264 is passed through; VP8 from other browsers is re-encoded. Output goes to up to 6 RTMP(S) destinations at once.
  - The Stream tab has destinations (YouTube, Twitch, Kick, Facebook, X, Rumble, other). Stream keys stay in the browser and are never synced.
  - There's a **Go live** button in the dock, a Live timer in the header, and live stats.
  - Env: `RELAY_URL`, `RELAY_SECRET`.
- **Watch page** (`/w/<studio>`):
  - Shows the live YouTube, Twitch or Kick player with a tab for each platform, plus links out to the others.
  - Says "not live" before and after the show and checks again every 15 seconds.
  - Public data only (title, live state, the watch links the host chose).
- **Verified:**
  - `tests/live.test.js` runs a real browser → relay → two local RTMP servers. Both receive 1280×720 H.264 + AAC.
  - Forged and missing tokens are refused, and guests can't get a token.
  - Stream keys never reach gather's server or the relay log.
  - The watch page goes from not live → playing → not live.
  - The VP8 re-encode path was checked separately.
  - All 12 suites, check, ui-kit and fx:live pass.

### To switch these on (owner)
1. **TURN:** Cloudflare dashboard → Realtime → TURN → create a key. In Vercel, set `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN`.
2. **Go live:** deploy `relay/` (see `relay/README.md`, about $2–5/month on Fly.io). In Vercel, set `RELAY_URL` and `RELAY_SECRET`.
3. **AI allowance (optional):** in Vercel, set `HOUSE_AI_PROVIDER` (e.g. `gemini`), `HOUSE_AI_KEY` and, optionally, `HOUSE_AI_DAILY`.

## V4: design-team audit, then a simpler, less generic interface
Five reviewers (flow, visual, layout, interaction/accessibility, simplification) audited every element. Their reports and the merged plan are in `audit/design-team/`. Screens: `audit/screens/design-before` → `audit/screens/design-after` (1440 / 1024 / 390).

- **Navigation:** the rail goes from 8 tabs to 4: **Chat · Show · Look · AI**.
  - Show holds banners, ticker, captions, the chat overlay and the call-in card.
  - Look holds Layout and Brand, switched by a toggle at the top.
  - Settings and Help are header icons that open dialogs. Platform-chat connections and Drive live under Settings → Connections, and TURN sits under an "own relay server" disclosure.
  - Stream became the **Go live** dialog: destinations, format, schedule and upcoming shows.
  - Guests see only Chat (no AI, no rail). The AI is host-only.
- **Header:**
  - Wordmark, then the show title (the host clicks it to rename), then a status that appears only while connecting.
  - On the right: ?, ⚙, account, Invite, and **Go live**, the one primary action, which turns into a red Live timer while broadcasting.
  - Before entering a studio, the page is just the stage hero, with "Create or join" and "schedule one for later". Upcoming shows sit under the hero when you have any.
- **Look:**
  - Flat, docked regions divided by 1 px hairlines. No floating cards, drifting blobs or glass on static regions; glass is kept only for controls over video and overlays.
  - The surfaces are a deep blue-graphite. The accent is #2f6bf0 (4.7:1 contrast with white text) and the lightest grey text is #8a97ae (≥5:1).
  - Radii are 6/8/12 and controls are 28/34/42.
  - Red now means only live or recording: the selected scene uses the accent, and people cards say "On stage".
- **Behaviour:**
  - Leave asks first when it would end a stream or recording, or hand the studio to a guest.
  - Muting now releases the microphone, so the browser's mic indicator goes off.
  - The AI wake word never listens outside a studio, which was keeping the mic on at the home page.
  - The invite dialog's primary button copies the link.
  - A button hides or shows the side panel.
  - On phones, the bottom bar is fixed and the chat box stays above it.
- **Record icon:** the ring and dot are drawn on one grid, so the dot is centred. The ring is neutral with a red dot. While recording, the button is red with a white stop square and the timer.
- **Accessibility:**
  - Esc closes menus again, since a global handler no longer swallows it.
  - Every button variant shows a focus ring.
  - Segmented controls and tabs announce their selected option (aria-checked / aria-selected) and move with the arrow keys.
  - The rail marks the open tab with aria-current.
  - Single-key shortcuts don't fire while a control has focus, and can be turned off in Help.
- **Copy:** panel subtitles, "Scroll to switch", the X/TikTok "soon" rows and the extra Invite buttons are gone. One verb per action. "Live" means only broadcasting.
- **Verified:** all 12 suites (updated for the new structure), `npm run check` and `npm run ui-kit` (with the contract updated to the V4 spec) pass.

## Sign-in to host, Google sign-in, backstage, quick invite, folding deck, host tour
- **Starting a studio needs an account.** Guests joining never need one. This is enforced on the server (`ALLOW_ANON_STUDIOS=1` turns it off, which the test servers use). The landing page and the green room ask you to sign in first, then carry on to the green room.
- **Google sign-in.** "Continue with Google" appears in the account dialog when `GOOGLE_CLIENT_ID` is set.
  - The ID token is checked with Google's tokeninfo endpoint, and must be for this site (audience), from Google (issuer), unexpired and with a verified email.
  - Sign-in finds the account by Google ID, otherwise links an existing account with the same email, otherwise creates one.
  - Google-only accounts confirm deletion by typing their email.
  - Tests: `tests/acct.test.js`.
- **Backstage.**
  - New guests wait off stage. The host gets a toast with "Put on stage", and can click anyone's picture to bring them on or send them back.
  - People cards say On stage or Backstage.
  - Show → "Guests go straight on stage" restores the old behaviour.
- **Quick invite.** The footer shows Copy link and the studio code (click to copy) next to "Waiting for guests".
- **Folding deck.** A chevron hides or shows Scenes / In the studio and the choice is remembered. Clicking a deck tab opens it again.
- **Host walk-through.**
  - Ten steps, each lighting up one part of the studio: stage, scenes, backstage, present, record, Show, Look, AI producer, invite, go live.
  - It runs once, the first time you host (not under browser automation), and any time from Help → "Take the studio tour".
  - Esc or arrow keys work, and steps whose part isn't on screen are skipped.
- **Verified:** all 13 suites pass, including the new acct test and the backstage, deck and tour checks in `feat`.

## Plan execution: B2–B7, notification bar, compact phone studio
- **Notification bar (studio).** Notifications show in their own row under the header: a slim bar that opens, says one thing, and folds away.
  - It never sits over the stage, the scenes or the controls.
  - While a dialog is open it floats above the dialog, then goes back into the page.
  - On the watch page the bar slides in over the header row for a moment, never over the video or the chat.
- **Phone studio (B2).** The whole studio fits on one phone screen:
  - A 48px header with icon-only Watch page and Invite.
  - The video edge to edge, with the on-air pill in its corner.
  - Scenes as a 3-column grid filling the space under the video.
  - One row of controls above the tab bar.
  - Panels open as a sheet from a tab. Tapping the same tab or the stage closes it, and the sheet starts closed.
- **B3.** Audience → Get paid shows three setup steps: card payments on this site → your Stripe → super chats on. Each step says what's done and what to do next.
- **B4.** The old "payment arrived · confirm" super chat flow is gone in the studio and on the server. Card super chats are confirmed by Stripe.
- **B5.**
  - A raised hand the host lets in is put on stage by its lobby id, not by name.
  - A voice join keeps the camera off after joining.
- **B6.** The profile hint's "Use a photo" and "Remove" no longer overlap.
- **B7.** The audit's banner, Present menu, share and AI chat steps use the current UI.

## Polish round: scene previews, phone header and motion, watch page glow
- **Scene previews (deck and sidebar).**
  - One calm palette: dark glass tiles tinted by what each block is, a soft person mark, and a 4px gap between blocks so nothing butts together.
  - Cards have more room inside (10px), a gentle lift on hover and a press on tap.
  - Only the selected scene gets a bright accent ring.
- **Phone header.** The logo on the left, then four even 36px controls: Watch page, Invite, a Go live pill and your account. Help joins Settings in the account menu.
- **Phone layout.**
  - The scenes fill the space under the video as a grid with a soft fade at the bottom.
  - The panel sheet slides up over a dimmed stage and slides away.
  - Tab icons spring when chosen, and every control presses on tap.
- **Watch page glow.** With the direct video the whole page glows with the blurred picture, like the studio. Before the picture arrives, or when the show plays on another platform, a slow wash of the host's brand colour keeps the page from going flat.

## Dock, Sam in the chat, phone sheet
- **Studio dock.**
  - Each control is an icon tile with its word underneath. The tile shows the state: red when muted, a live red when recording, the accent colour when on.
  - Controls are centred, the getting-started guide is on the left, and Leave is a red pill with an icon (a round button on phones).
- **Sam in the one studio chat.**
  - The separate "Ask Sam" composer is gone. Starter prompts (Show intro, Poll idea, Recap chat, Guest questions, Fact-check, Banner, 5-min countdown) sit above the composer.
  - The Sam orb in the composer starts an @Sam message.
  - Sam posts short notes with action buttons: a hello, going live, viewer questions ("Show on stage" / "Draft an answer") and a quiet chat. Notes cost no AI request, and AI settings → "Notes in the chat" turns them off.
- **Phone chat sheet.** The chat fills the sheet, with the composer at the bottom.
- **Notification bar.** Back-to-back notifications swap text in place, so the page below doesn't jump.
- **Test note.** This sandbox renders without a GPU, so the studio runs at about 6 fps here, and did before this round too. The composer orb holds still to save frames. `store` clicks the Chat tab directly, because Playwright's "wait until stable" can starve on a page this slow. `live` and `livebuiltin` time out waiting for web fonts in this sandbox, on the previous commits as well.

## R1: vertical and widescreen at the same time
- **Compositor.** Every frame is drawn twice when a tall destination is live, or while its preview is open: the 16:9 program, then a 720x1280 companion on its own canvas.
  - The drawing context is a small proxy, so the same draw code, and the modules that were handed `g`, paints either canvas.
  - Each picture keeps its own tile animations.
- **Reflow.**
  - Built-in layouts stack people on the tall stage.
  - Custom scenes map to the vertical template with the same parts: slides → Vertical presentation, AI → Vertical AI, chat → Vertical + chat, 2+ on stage → Stacked duo, else Vertical solo.
  - The lower third, ticker and logo move to their vertical spots, hidden where the scene hides them.
  - Cameras crop to their centre in the tall picture.
- **Go live.**
  - Each destination has a shape menu: Auto (TikTok and Instagram 9:16, the rest 16:9), 16:9 or 9:16.
  - Go live opens one relay lane per shape. The relay allows one stream per studio per lane, and the token carries the lane.
  - If one lane drops, the other keeps going.
  - The dialog shows a live 9:16 preview while a tall destination is on.
- **Verified.** `live` streams to two local RTMP servers at once. The first receives 1280x720 and the second 720x1280, both H.264 + AAC, and no stream key reaches gather or the relay log. `livebuiltin` passes too.

## R2: watch page Live and People tabs
- **Live tab.** A running auction or giveaway shows as a card next to polls, predictions, drops and the play-with-me line. It says who leads, and a "Bid now" / "Enter now" button jumps to its controls under the video.
- **People tab.**
  - Top fans by XP this show (your own row highlighted).
  - The host and moderators, with Host / Mod tags.
  - The feed carries moderators' names only, never their platform user ids.
- **Tests.** `auction` checks the Live tab card. `watch` checks the moderators in the feed.

## R3: @Sam recap
- "@Sam recap", "What did I miss?" (the chip in the watch chat), "catch me up" and "sum it up" switch Sam into recap mode.
- Sam gets the last 10 minutes of captions (up to 50 lines) and chat (up to 40 messages, super chats marked).
- It answers in two to four sentences, ending with what's happening now. With nothing recorded, it says so and gives what the show is about and what's next.
- Recaps get a slightly longer answer allowance.
- **Tests.** `sam` checks recap detection and that the prompt carries the whole window.

## R4: instant replay
- **Replay** sits next to Mark clip on the stage (host only), as "Instant replay" in the Present menu, and on the I key.
- It plays the last 30 s from the clip buffer on stage as a presentation, with a REPLAY badge and a progress line, then hands the stage back by itself.
- The replay is muted, so voices from a moment ago don't talk over the host.
- **Tests.** `clips` checks that Replay goes on stage and ends by itself.
- **Note.** M is listed in Help for both "Mute" and "Mark highlight". That clash was already there; I is used for replay so it doesn't add another.

## R5: auto highlight clips
- Big moments mark themselves in the clip buffer (`public/auto-moments.js`):
  - a chat spike: 8+ viewer messages in 15 s, well above the minute before
  - a burst of 12+ reactions in 10 s
  - every paid super chat
- At most one automatic moment every 45 s (15 s for super chats).
- Sam posts "Clipped that: …" in the studio chat with a **Save 9:16** button.
- Clip & post → "Clip big moments for me" turns it off.
- **Tests.** `clips` checks that a chat spike clips itself and that Sam's note has the button.

## R6: one checkout for the bag
- **Watch page.** When card checkout is on, the shop bag has one **Pay $total · one checkout** button. It opens the same in-page Stripe checkout as Buy now (card, Apple Pay, Google Pay) and empties the bag once paid.
  - Without card checkout, each item keeps its store link as before.
- **Server (`wcartbuy`).**
  - Prices, flash-sale discounts and stock are checked on the server. The page's prices are never trusted.
  - Up to 10 lines of up to 9 each.
  - When Stripe confirms, `wshopdone` takes every line out of stock, posts one "Just bought 2× …" per line, and keeps the bag as one line in the sales report.
- **Tests.** `pay` checks the stock limit, one checkout at the server's prices ($55 for 2× $20 + $15, even with a forged $0.01), nothing leaving stock before payment, stock after payment, and one sales line.
