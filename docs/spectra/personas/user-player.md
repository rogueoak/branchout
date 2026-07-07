# 👤 User (Player)

See `persona.md` for how to review and comment.

Review whether the change actually serves this customer profile.

## Applies when

- Anything a player touches: joining or hosting a room, the lobby, picking a game,
  interactive vs. remote mode, in-game screens, round results, scoring and stars.
- Profile and social surfaces: gamer tag, nickname, avatar picker, stars badge, play
  timeline, online status, friend search and invites, profile privacy.
- Onboarding and account flows as felt by a player: playing anonymously, being nudged to
  sign up, subscription tiers and credit balance where they appear in the play path.
- Copy, empty/loading/error states, and latency on any of the above.

## Skip when

- Pure back-office or operator concerns with no player-visible surface: billing
  reconciliation internals, control-plane bookkeeping, game-engine orchestration plumbing,
  CI, infra, and other changes a player never sees or feels.

## Profile

- **Who** - a casual player who shows up to have fun with friends (party games) or to kill
  time solo. Ranges from a signed-in regular chasing stars to a friend who was just handed a
  room code and wants in right now.
- **Goals (JTBD)** - get into a game with friends in seconds; understand how to play without
  reading a manual; win some stars and show them off; come back and find their friends.
- **Pain points** - forced signups before they can play; confusing lobby/mode choices;
  laggy or out-of-sync game state across devices; surprise paywalls mid-fun; not being able
  to find or invite a friend.
- **Technical level** - non-technical. Expects console/app-store level polish. Will not read
  docs, tolerate jargon, or debug anything. One wrong screen and they drop.
- **Device** - shows up on a phone first. Plays on mobile web in a portrait browser, often
  one-handed, sometimes on a flaky connection. A larger screen is the exception, not the
  default.
- **Values** - speed to fun, low friction to join, clarity of what to do next, feeling
  social and seen (tag, avatar, stars), fairness in scoring, and playing free without being
  cornered into paying.
- **Would reject** - being forced to create an account just to join; a join flow longer than
  a room code; unclear whose turn it is or how to act; competing calls to action; anything
  that feels like a spreadsheet instead of a game; any screen that is cramped, overflowing,
  or tap-hostile on a phone.

## Review - on the user's behalf

- **Serves the goal** - does this get a player into fun faster, or only make the system
  tidier? Anonymous join and host paths stay intact unless the spec says otherwise.
- **Matches their level** - no jargon, no manuals; the next action is obvious on every
  screen, including interactive vs. remote mode.
- **Mobile-first** - the surface is designed for a phone before a desktop: it works and looks
  right at ~360px wide in portrait, taps land, nothing overflows or gets cramped, and it
  scales up cleanly to larger screens.
- **Eases a pain** - relieves a real player frustration (friction, confusion, lag, surprise
  cost) rather than inventing a new one.
- **Honors their values** - protects speed-to-fun, low-friction join, fairness of stars, and
  the free tier's dignity; free players are nudged, not cornered.
- **No dealbreakers** - introduces nothing from "Would reject": no forced signup to join, no
  hidden paywall, no ambiguous turn/state, no silent credit exhaustion.
- **Affordances** - the defaults, microcopy, empty/loading/error states, and credit/tier
  messaging a player needs are actually present and reassuring.
