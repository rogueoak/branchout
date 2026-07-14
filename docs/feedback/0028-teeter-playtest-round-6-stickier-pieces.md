# 0028 - Teeter Tower playtest round 6 (stickier pieces)

## Symptom

The game is too hard: pieces slide and topple off the tower too readily on landing, so building any
height is frustrating. The ask: make the pieces **way stickier** so a piece that lands tends to grab
and stay put rather than skate off.

## Root cause / design

Stability is governed by the piece contact tuning in `packages/games/teeter-tower/src/levels.ts`
(applied to every piece, the platform, and the walls in `physics.ts`). Restitution is already `0` (no
bounce), and kinetic `PIECE_FRICTION` is already at `1.0` - Matter's tangential impulse saturates near
1.0, so raising it further does little (the ported note in `levels.ts` says as much). The lever that
actually makes a resting piece resist sliding is **`frictionStatic`** (the force it takes to break a
piece free from rest), and **`frictionAir`** damps the skitter/wobble energy a piece carries on landing
so it settles planted instead of walking off an edge.

Change (grip, not shape):

- `PIECE_FRICTION_STATIC`: `6 -> 20`. Much grippier resting contact - a landed piece needs far more
  sideways push (from the next impact or a lean) before it starts to slide, so it stays where it lands.
- `PIECE_FRICTION_AIR`: `0.03 -> 0.05`. A touch more damping so a piece bleeds off its landing energy
  faster and stops skittering, without feeling floaty on the way down.
- `PIECE_FRICTION` (kinetic) stays `1.0` and restitution stays `0` - already maxed for grip / no bounce.

These are shared constants, so the platform and side walls get the same extra grip, which also helps
the base course hold the first pieces.

## Verification

- `packages/games/teeter-tower` unit tests stay green (no test pins these constants; the settle-gate
  behaviour is unchanged - a stiller tower simply settles a hair sooner).
- The Teeter e2e drop still plays through (CI).
- Manual: on the insider site, drop a piece off-centre and confirm it grabs and holds instead of
  sliding off; the tower is meaningfully easier to build. Tune further (or soften landings via
  `MAX_FALL_SPEED`) if it is still too hard.
