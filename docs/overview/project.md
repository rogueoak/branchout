# Project

## Mission

Branch out is a subscription platform for online shared games - mostly party games you play
together, with some solo games. The promise: get friends into a game in seconds, keep the fun
fair and social, and let people play free without being cornered into paying.

Tagline: **where game night grows.**

## Who it is for

- **Players** - casual, non-technical, here to have fun with friends or kill time solo. They
  may be signed-in regulars chasing stars or a friend who was just handed a room code. See the
  👤 Player persona in `docs/spectra/personas/user-player.md`.
- **Hosts** - a player with an account who starts a room and whose subscription allowance
  covers the games played in it.
- **Observers** - a viewer in a shared space (for example a TV) that all players can see.

## Principles

- **Free by default.** No account needed to play; an account is only required to save progress
  or host. Free tier gives 10 credits a day. Nudge, never corner.
- **Speed to fun.** Joining should be no longer than entering a room code. Anonymous join and
  host paths stay intact.
- **Fair and social.** Stars are a cross-game reward anyone can see; profiles, avatars, and
  friends make it feel like a place, not a spreadsheet.
- **Modular games.** The platform runs the accounting and orchestration; the game engine runs
  the games. Games stay pluggable so the catalog can grow.

## Monetization

Three tiers. Rounds cost credits (usually 1 credit per round); some games charge by time or
action and advertise their cost. You cannot start a game with more rounds than your balance.

| Tier | Credits/day | Price |
|---|---|---|
| Free | 10 | free |
| Gathering | 50 | 7 USD / 10 CAD per month |
| Party | unlimited | 10 USD / 14 CAD per month |

## Status

Greenfield. The current work establishes brand, theme, and the spec roadmap. No application
code has shipped yet - see `docs/specs/README.md` for the ordered breakdown and
`features.md` for the capability map.
