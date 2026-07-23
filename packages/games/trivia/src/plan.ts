// Round-plan builder (spec 0074). A duration (or a custom count set) resolves to a composition -
// how many multiple-choice, true-false, and open rounds a game runs - and this pure builder turns
// that composition into an ORDERED list of round types. The order is fixed by the placement rule
// below and a deterministic shuffle of the remaining rounds, so a seeded rng replays a whole game
// identically. `configure` runs this once and stores the plan in scratch; `startRound` reads the
// type for the current round out of it.

/** The three runtime round types a Trivial Matters game draws (spec 0074). */
export type RoundType = 'multiple-choice' | 'true-false' | 'open';

/** How many rounds of each type a game runs. `open` rounds are the free-text, dispute-eligible ones. */
export interface Composition {
  multipleChoice: number;
  trueFalse: number;
  open: number;
}

/**
 * Fisher-Yates shuffle in place, driven by the injected `rng` (in [0, 1)). Deterministic under a
 * seeded rng, so a whole game's ordering replays identically in tests.
 */
export function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/**
 * Build the ordered round plan for a composition (spec 0074).
 *
 * `N = multipleChoice + trueFalse + open`, `K = open`. The K open rounds land at positions
 * `ceil(i * N / K)` (1-indexed) for `i` in `1..K`, so they are evenly spaced and the LAST question is
 * always open (i=K gives `ceil(N) = N`). Those positions are strictly increasing (and so distinct)
 * for `K <= N`, which always holds since `open <= N`. The remaining slots are filled with a shuffle
 * of the multiple-choice and true-false rounds. `K = 0` places no opens - all N slots are the
 * shuffled MC/TF fill (the tail rule simply does not apply).
 *
 * Pure: the only nondeterminism is the injected `rng`, so a seeded rng yields a fixed plan.
 */
export function buildRoundPlan(composition: Composition, rng: () => number): RoundType[] {
  const { multipleChoice: mc, trueFalse: tf, open } = composition;
  const total = mc + tf + open;
  const plan: (RoundType | undefined)[] = new Array<RoundType | undefined>(total).fill(undefined);

  // Place the open rounds at evenly spaced positions, last always open.
  for (let i = 1; i <= open; i += 1) {
    const pos = Math.ceil((i * total) / open); // 1-indexed
    plan[pos - 1] = 'open';
  }

  // Fill the rest with a deterministic shuffle of the MC and TF rounds.
  const fillers: RoundType[] = [
    ...Array<RoundType>(mc).fill('multiple-choice'),
    ...Array<RoundType>(tf).fill('true-false'),
  ];
  shuffleInPlace(fillers, rng);

  let f = 0;
  for (let i = 0; i < total; i += 1) {
    if (plan[i] === undefined) {
      plan[i] = fillers[f]!;
      f += 1;
    }
  }

  return plan as RoundType[];
}
