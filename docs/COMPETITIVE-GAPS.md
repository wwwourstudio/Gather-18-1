# What other streaming tools have, and where gather stands

Compared against: **StreamYard** and **Restream Studio** (browser studios), **Twitch** (creator and gaming tools),
**Whatnot**, **TikTok Shop LIVE** and **Amazon Live** (live shopping), and **OBS**/**Streamlabs** (producer tools).
Status as of this branch.

Legend: ✅ gather has it · 🆕 added in this change · 🟡 partial · ❌ missing

## Live shopping

| Tool | Who has it | gather |
| --- | --- | --- |
| Pinned product with price on stage | TikTok Shop, Amazon Live, Whatnot | ✅ (the stage badge didn't render before; fixed here) |
| Buy without leaving the stream | TikTok Shop, Amazon Live | ✅ embedded Stripe checkout |
| Stock counter / "only 3 left" | Whatnot, TikTok Shop | ✅ (could oversell on concurrent buys; fixed here with a server lock) |
| Flash sale with code and timer | TikTok Shop | ✅ |
| "Jordan just bought…" social proof | Whatnot, TikTok Shop | ✅ |
| **Live auctions**: bid timer, increments, anti-snipe, sudden death | Whatnot (its core feature), eBay Live | 🆕 |
| **Giveaways** with a fair server-side draw | Whatnot, TikTok Shop, Twitch extensions | 🆕 |
| Auction winner checkout | Whatnot | 🆕 (Stripe when connected, else the host's pay links) |
| Cart (several items, one checkout) | TikTok Shop, Amazon Live | ❌ next: one Stripe session for several items |
| Shipping address and tax at checkout | Whatnot, TikTok Shop | 🟡 Stripe can collect them; not configured |
| Seller dashboard: sales per show, top buyers, export | Whatnot, TikTok Shop | 🆕 Shop → Sales this show: live totals, top buyers, best sellers, CSV |
| Shoppable replay (products linked at timestamps) | Amazon Live, TikTok | ❌ |
| Product queue / run of show (next item lined up) | Whatnot | 🟡 the catalogue can be pinned in order; no queue |

## Gaming and creator tools (Twitch)

| Tool | Twitch | gather |
| --- | --- | --- |
| Predictions with points | ✅ | ✅ (XP stakes) |
| Polls | ✅ | ✅ |
| Viewer queue ("play with me") | extensions | ✅ |
| Bounties / challenges | extensions | ✅ |
| Scoreboard overlay | extensions | ✅ |
| **Shoutout** card | `/shoutout` | 🆕 |
| **Raid** (send viewers to another show) | `/raid` | 🆕 countdown, "Stay here" opt-out, arrival toast |
| Channel points with custom rewards | ✅ | 🟡 XP is earned (bids, predictions, entries) but can't be spent on rewards yet |
| Clips | ✅ | ✅ 30-second clip studio |
| Hype train / goals | ✅ | ✅ goals with effects, hype meter |
| Followers / subscriptions | ✅ | 🟡 email live alerts; no paid tiers |
| VODs with chapters | ✅ | ❌ |
| Mod tools (timeouts, blocked words, slow mode) | ✅ | ✅ plus AI moderation |
| Instant replay of the last 30 s on stage | OBS replay buffer | ❌ next: the program canvas is already recorded |

## Studio production (StreamYard / Restream)

| Tool | StreamYard | gather |
| --- | --- | --- |
| Browser studio, guests by link | ✅ | ✅ up to six |
| Backstage / green room | ✅ | ✅ |
| Multistream to several platforms | ✅ | ✅ via the relay |
| Comments on screen from every platform | ✅ | ✅ Twitch, YouTube, Rumble |
| Pop-out chat (own window, or phone by QR) | ✅ (April 2026) | 🆕 Chat options → Pop out chat / On your phone |
| Lower thirds, banners, ticker, logo, brand kit | ✅ | ✅ |
| Countdown / "Be right back" screens | ✅ | ✅ (never drew on stage before; fixed here) |
| Local recording per guest (ISO tracks) | ✅ paid | ❌ only the program mix is recorded |
| Producer-only seat | ✅ | ❌ |
| Webinar registration page | ✅ | 🟡 scheduled shows with email reminders |
| Hotkeys / Stream Deck | OBS | 🟡 number keys switch scenes |

## Suggested order for what's left

1. ~~**Seller dashboard**~~ Done.
2. **AI highlight clips after the show** (Riverside Magic Clips, StreamYard AI Clips): the biggest gap with the podcast and creator studios.
3. **Cart**: let a viewer add several pinned items and pay once.
4. **Channel-point rewards**: let viewers spend XP on host-defined rewards (pick the next song, a shoutout). This completes the XP loop.
5. **Instant replay**: keep the last 30 s of the program in memory and play it on stage.
6. **ISO recordings**: record each guest's own track for editing.
