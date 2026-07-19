# Spec 0068 - Trivia setup config overhaul (WS3)

## Why

Trivia's host setup is a single-category picker, a raw rounds field, and two 1-10 difficulty
sliders. It exposes the engine's internal difficulty numbers, offers no quick presets, and has no
way to play more than one category short of "Random". The answer timer and the auto-advance pacing
are hard-coded in the engine, so a host cannot slow the game down or turn auto-advance off. This spec
reworks the host setup into a mobile-first standard panel (categories, rounds, difficulty as
presets) plus a collapsed Advanced panel (auto-advance, advance delay, answer time limit) and wires
the new pacing fields all the way to the engine.

## Standard config (always visible in Game setup)

1. **Categories - Random or a subset.** Replace the single-category select with a "Random" choice
   (spans all eight categories, mutually exclusive) OR a multi-select of one-or-more of the eight.
   Random is the default and is represented as an EMPTY selection.
2. **Rounds - presets + custom.** Presets: 10 = Fast, 20 = Medium, 40 = Long, plus Custom (a number
   in the existing 1-100 bounds). Preset selector + a custom number field.
3. **Difficulty - presets, label only.** Presets map to the existing `difficultyMin`/`difficultyMax`
   band: Easy = 1-4, **Medium (default) = 3-6**, Moderate = 4-8, Hard = 6-10, plus Custom (shown only
   when the current band matches no preset, e.g. a legacy room). The numeric 1-10 ranking is NOT
   shown - only the label + a one-line description. The old sliders are removed.
4. **How to play** sits inline on the same row as the room code (right-aligned) on the running game
   surface, saving a row on a phone.

The difficulty selector reuses the same radio-style option selector as the lobby "Your mode" picker
(extracted to a shared `OptionSelector`), so the two read the same.

## Advanced config (collapsed accordion below Game setup)

The lobby exposes an optional `advanced` slot rendered as a collapsed "Advanced settings" accordion.
Trivia fills it with:

5. **Auto advance** toggle, default ON. When on, the game auto-progresses answer screen -> leaderboard
   and leaderboard -> next question. When off, the host taps to advance both hops.
6. **Advance after** (seconds), default 5, min 1, max 60. The dwell for both auto-advance hops.
7. **Time limit** (answer window), default 60, min 10, max 180. Maps to the engine move window.

## Config contract

`TriviaConfig` (host -> control-plane -> engine handoff, opaque blob) gains these fields. All are
optional; an omitted field takes its default, so a legacy room with none of them plays like today.

| field                | type       | default | bounds        | notes                                        |
| -------------------- | ---------- | ------- | ------------- | -------------------------------------------- |
| `categories`         | `string[]` | `[]`    | subset of 8   | `[]` (or omitted) = Random (all categories)  |
| `category` (legacy)  | `string`   | -       | one of 8/Random | still accepted; `Random` -> `[]`, else `[it]` |
| `rounds`             | `number`   | `10`    | 1-100         |                                              |
| `difficultyMin`      | `number`   | `3`     | 1-10          | Medium band floor                            |
| `difficultyMax`      | `number`   | `6`     | 1-10          | Medium band ceiling; min <= max              |
| `autoAdvance`        | `boolean`  | `true`  | -             | gates the dwell timers                       |
| `advanceAfterSeconds`| `number`   | `5`     | 1-60          | dwell for both auto-advance hops             |
| `timeLimitSeconds`   | `number`   | `60`    | 10-180        | answer window -> engine `moveWindowMs`       |

### How pacing reaches the engine

Trivia's `configure()` resolves the config and returns to the engine, via `ConfigureResult`:

- `moveWindowMs = timeLimitSeconds * 1000` - the answer window (always on).
- `disputeWindowMs = autoAdvance ? advanceAfterSeconds * 1000 : 0` - the answer-screen (reveal /
  dispute) dwell; `0` makes it host-advanced.
- `autoAdvanceMs = autoAdvance ? advanceAfterSeconds * 1000 : 0` - a NEW `ConfigureResult` field the
  engine uses to auto-advance the `leaderboard` phase to the next round; `0` keeps today's
  host-advanced behavior.

The engine gains a `leaderboard`-phase window (`windowMsFor` + `armWindow('leaderboard')`, re-armed
across pause/resume like the dispute window) driven by `SessionState.autoAdvanceMs`. When
`autoAdvanceMs` is 0 (the default for every other game and for auto-advance-off), the leaderboard
waits on the host exactly as before.

## Backward compatibility

- No config / `{}` -> Random, 10 rounds, difficulty 3-6, auto-advance on at 5s, 60s answer window.
- Legacy `category` string still validates (`Random` -> all; a named category -> that one).
- A pre-WS3 persisted scratch (single `category`) is read as the equivalent `categories` list, so an
  in-progress game survives an engine deploy.
- `autoAdvanceMs` is additive and optional on `ConfigureResult`; games that never set it are
  unaffected.

## Testing

- Trivia plugin: resolve/validate (categories subset + Random + legacy `category`, rounds bounds,
  difficulty defaults 3-6, new pacing defaults + bounds), pool draw across a subset, configure result
  (move/dispute/auto-advance ms from the config).
- Engine: a stub with `autoAdvanceMs` auto-advances `leaderboard` -> next round after the dwell and
  re-arms across pause; `moveWindowMs` from config still force-closes the answer round.
- Web: ConfigPanel renders category multi-select + Random, rounds presets + custom, difficulty via
  the shared option selector; AdvancedConfigPanel renders the toggle + two numbers with min/max;
  validation mirrors the engine.
