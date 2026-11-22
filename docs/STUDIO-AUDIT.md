# Studio audit and to-do list (November 2026)

This audit comes from going through every side panel and the stage itself, with screenshots, after this round's refactor.

## Done in this round

- **Every side panel uses the same header.** It shows the tab's icon on an accent-coloured tile, the panel's name, and one line saying what the panel is for.
- **Long panels can be searched.** Show, Look and Shop have a "Find a setting" box. Below it are chips that jump to each section and open it.
- **Sections animate open and closed.** They also remember how you left them. An open section gets an accent edge.
- **Panels slide in when you switch tabs.** Buttons and the side tabs respond when you press them, and the selected tab glows in your accent colour.
- **Everything uses your accent colour.** The default stage backdrop ("Accent", formerly Dusk), speaking rings, name tags, frames, cards for people without a camera, the AI orb, scoreboard defaults, scene previews, small super chat alerts, selected segments and primary buttons all follow it. No fixed blue is left.
- **Themes.** Eight one-tap themes set colour, font, name-tag style, banners, animation, frame and panel style together: Midnight Pro, Creator Pop, Esports, Luxe, Clean Studio, Live Shop, Calm and Dev Stream.
- **Brand from my logo.** Upload your logo and it becomes your on-stage logo. Its main colours are pulled out, the strongest one becomes your accent, and you can tap any of the others.
- **Built-in music.** Lo-fi, Chill, Upbeat and Hype loops are made in your browser on the spot. They're free to stream, so no copyright strikes, and they duck under speech like your own tracks.
- **AI quick actions.** One tap for:
  - Design an overlay
  - Make a thumbnail
  - Design a backdrop
  - Create a logo
  - Title, description and tags
  - Sum up the chat
  - Start a poll
  - Run of show

## What still needs doing (in priority order)

1. **Notifications pile up.** Toasts, the yellow "switch back to Solo?" bar and the "Next: invite a guest" coach all show at once, and a burst of actions stacks three or four toasts. Use a single queue that shows one at a time, merges repeats and lets you dismiss it with a swipe.
2. **The Show panel is about 2,800 px tall.** Split it into Watch page, Viewers, Super chats and Stage behaviour. The finder helps for now, but the panel is still too long.
3. **There are 8 side tabs.** Merge them into 5:
   - Chat
   - Stage: Look + Music
   - Audience: Show + Polls + Play
   - Shop
   - AI
4. **There's no check before going live.** Before you press Go live, show a checklist: camera, microphone, relay reachable, stream key, bitrate test. Each failure should come with a one-line fix.
5. **The scenes strip takes a third of the screen.** Collapse it into one row of thumbnails, with the layout cards behind a "More layouts" button.
6. **Element editing is hidden.** The element editor only appears after you click "Edit on stage". Add hover handles on the stage itself, a right-click menu, and keyboard nudging with alignment guides.
7. **The theme buttons can't remember your edits.** Add "Save my look as a theme", and export/import a brand kit file so teams can share it.
8. **AI keys are confusing.** There are four providers, each with its own key and model. Default to the house Gemini key, and tuck "Use my own key" under Advanced.
9. **Many settings are only for the host, but you can't tell.** Co-hosts see controls they can't use. Hide them, or show a lock with "Ask the host".
10. **The studio is hard to use on phones.** The rail and panel squeeze the stage. Switch to bottom tabs and a sheet-style panel below 720 px wide.
11. **The code is too big.** `app.js` is now about 8,400 lines. Move panels, stage drawing, payments and the AI tools into their own modules; `panels.js` is the first step.
12. **Light mode.** Every panel still needs a pass in light mode. Several cards still use dark-only fills.

## 10 features to add

1. **Brand kit importer.** Paste your website address and we read its logo, colours and fonts, then build a full theme plus matching overlays.
2. **AI scene builder.** Describe a scene ("interview with a product shot on the right and a QR code") and Sam lays out the elements on stage. You can then edit it like any layout.
3. **Motion presets for graphics.** Pick an entrance and exit style for every banner, lower third and alert (cinematic, playful, esports, luxury) in one place.
4. **Pre-made overlay packs.** Ready packs for talk shows, shopping, gaming, church, education and podcasts. Each pack's starting screen, intermission, BRB and ending screens follow your theme.
5. **Countdown starting screen.** A themed "Starting soon" scene with a countdown, music and a chat preview. It cuts to you live automatically.
6. **Sponsor slots.** Schedule sponsor cards and spoken reads, then get a report of how often they were on screen and how many clicks they got.
7. **AI director.** Sam switches layouts on its own: whoever is talking gets the big tile, product close-ups when you hold up a product, and the scoreboard when a round ends.
8. **Guest green room.** Guests wait backstage with a preview and a mic check. You bring them on with a tap and a branded intro.
9. **Clip and post.** Mark a moment with one key, and the clip is cut to vertical, captioned in your font, and ready for TikTok, Reels or Shorts.
10. **Team workspaces.** Shared brand kits, saved scenes and roles (producer, moderator, guest) so a whole team can run a show together.
