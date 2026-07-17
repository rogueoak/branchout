# 0060 - Nightleaf: cooperative, silent, ascending-number game (insider-only)

## Problem

We want a purely cooperative insider game with a real hidden-information hook - a game whose whole
point is that each player holds a secret and the group succeeds or fails together. Working title
**Nightleaf**: a real-time, silent, ascending-number climb. Each player holds a private hand of
numbered leaves, and across a level the whole group must play every leaf onto one shared pile in
strictly ascending order - with no communication about the numbers. It ships behind the existing
insider surface (spec 0035) so it never touches the public catalog until it is ready.

The heart of the game is **silence under shared risk**: you can feel the tension of "is my leaf next?"
but you may not say. A leaf played out of order (a lower one still held by anyone) costs the group a
life. That only works if a player's hand is a genuine secret on the wire - a player must never be able
to read another player's leaves off a frame. So Nightleaf is the first game to lean on the per-player
private-payload channel (spec 0052): a hand is delivered only to its owner and never broadcast.

## Outcome

- Two to six insiders can create a room, pick **Nightleaf** (visible only to insiders), and play: each
  player gets a **secret hand** of numbered leaves (1-100, unique) delivered only to their own device.
  Together, in real time and in silence, they play their leaves onto the shared **trunk** in strictly
  ascending order.
- Playing a leaf while any player still holds a **lower** one is a misplay: the group loses a **bud**
  (life) and a misplay banner flashes, but the leaf still lands. Run out of buds and the grove falls
  (a shared loss).
- Clearing a **tier** (every hand emptied) climbs to the next, bigger tier - tier N deals N leaves to
  each player. Clearing the final tier wins the game for the whole grove.
- An optional **hush** (spend a shared **firefly**): once every player still holding leaves proposes
  it wordlessly, everyone discards their lowest leaf at once - no bud cost. A wordless reset when the
  gap is unreadable.
- Nightleaf is **purely cooperative**: everyone shares one final standing (win or lose together).
- Each player's hand is a real secret on the wire: the broadcast `sim` carries only shared, safe state
  (the trunk, buds, tier, fireflies, and each hand's leaf COUNT). A player's exact leaves ride the
  per-player `private` channel (spec 0052) and are delivered only to that player's device(s). A player
  can never read another player's hand off any frame.
- The game is absent from the public game picker, public game pages, and the sitemap. A non-insider
  cannot see or start it.

## Scope

**In:** a new engine game plugin (`packages/games/nightleaf`) - a deterministic, live (spec 0044)
cooperative module: a seeded per-tier deal, a shared trunk, per-player secret hands, misplay
detection, tier advance, win/loss, and the hush. Its web UI module (`apps/web/lib/games/nightleaf`) -
a shared **Viewer** (the grove: trunk, buds, tier, fireflies, per-player counts, banners) and a
private per-player **Remote** (this player's own hand + the play / hush moves). A brand mark
(`packages/brand/src/nightleaf.ts`). Registration in the engine, worker, and web registries; a
marketing catalog entry; a library (spec 0051) entry. Engine unit tests and a real multi-player e2e
at 360px.

**Out:** individual scoring or a competitive mode (Nightleaf is purely co-op); a content bank (the
numbers are the content, dealt from a seeded rng); rich animation of the grove; matchmaking.

## Approach

- **Live model (spec 0044).** Nightleaf implements `tick` and sits in one continuous phase. The whole
  grove is fully serializable in scratch (the seed, the tier, buds, fireflies, each hand, the trunk),
  so a reconnect / engine restart rebuilds it with no in-process world (no `disposeLive`).
- **Deterministic deal.** `configure` derives one base seed from `services.rng`. Each tier's hands are
  a pure function of `(seed, tier, players)`: draw `tier * playerCount` distinct leaves from [1, 100]
  via a seeded partial Fisher-Yates, deal round-robin, sort each hand ascending. No content bank.
- **The secret seam (spec 0052).** `startRound` and every `tick` return `private: { [playerId]: hand }`
  and the engine delivers each entry only to that player's device(s). The broadcast `sim` never
  carries a leaf value from any hand - only public counts. A player's hand is re-emitted every tick so
  a play / hush / fresh deal re-sends it and a reconnecting device catches up.
- **Moves.** `collectMove` takes `{ kind: 'play' }` (play THIS player's own lowest leaf - the client
  is never trusted with, and does not need, a value) or `{ kind: 'hush' }`. A play detects an
  out-of-order leaf (a strictly lower one held anywhere) and debits a bud; the leaf still lands. A hush
  fires once every holder has proposed it, spending a firefly and discarding every lowest.
- **Banner beats.** A tier-clear pause, a misplay flash, and the win/loss result are server-authoritative
  beats `tick` counts down, holding the grove and rejecting moves so the pause is real and consistent.
- **Cooperative standing.** Every player shares the outcome: 1 for a win, 0 otherwise, all tied at
  rank 1.

## Acceptance

- An insider can create a room, pick Nightleaf (a non-insider cannot see it), start it with 2+
  players, and each player is dealt a secret hand shown only on their own device.
- Playing leaves in ascending order clears a tier; clearing the final tier wins; the win/loss standing
  is shared by every player.
- A leaf played while a lower one is still held loses a bud; zero buds loses the game.
- A hush, once every holder proposes it, spends a firefly and discards every player's lowest leaf.
- The deal is deterministic from a fixed seed; the same seed deals the same hands.
- A test proves a player's hand is delivered only to that player and never appears in the broadcast
  `sim` or another player's private payload (spec 0052 secrecy).
- A multi-player e2e drives two insiders through a full cooperative play-through to a shared win, at
  360px, and asserts each device shows only its own leaf.
- typecheck, lint, unit tests, `next build`, and prettier all pass; no non-ASCII in the new files.
