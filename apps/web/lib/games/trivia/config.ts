// Host-facing Trivial Matters configuration for the lobby, mirroring the engine's rules (spec 0008,
// spec 0068, spec 0074, packages/games/trivia/src/trivia.ts). The engine re-validates every config on
// the start handoff and owns the authority; this mirror lets the lobby show a valid form and a plain
// reason before a doomed round trip. Keep the ranges, category list, duration compositions, per-type
// timers, and defaults in step with the engine (the LOCKED contract in docs/plans/0074-trivial-
// matters.md is the source of truth).

/** The runtime round types a question is drawn as (spec 0074). */
export type TriviaRoundType = 'multiple-choice' | 'true-false' | 'open';

/** The ten question categories a host may pick a subset of. Matches the engine's `CATEGORIES`. */
export const CATEGORIES: readonly string[] = [
  'Nature',
  'Food',
  'Animals',
  'Science',
  'People',
  'Places',
  'Things',
  'History',
  'Movies',
  'Music',
];

/** The label for the "all categories" choice. On the wire it is the EMPTY `categories` list. */
export const RANDOM_CATEGORY = 'Random';

/** The full set of choices a host may configure: the ten categories plus `Random`. */
export const CONFIGURABLE_CATEGORIES: readonly string[] = [...CATEGORIES, RANDOM_CATEGORY];

/** The duration presets (spec 0074) plus the `custom` escape hatch. Mirrors the engine `Duration`. */
export type Duration = 'fast' | 'standard' | 'long' | 'marathon' | 'custom';

/** The per-type question composition of a game: how many of each round type it runs. */
export interface Composition {
  multipleChoice: number;
  trueFalse: number;
  open: number;
}

/** One duration preset: a label, a plain description, and its fixed MC/TF/open composition. */
export interface DurationPreset {
  id: Exclude<Duration, 'custom'>;
  label: string;
  description: string;
  composition: Composition;
}

/**
 * Duration presets (spec 0074). Each fixes the mix of question types; `Custom` (handled in the UI)
 * reveals three numeric count inputs instead. The compositions mirror the engine authority EXACTLY.
 */
export const DURATION_PRESETS: readonly DurationPreset[] = [
  {
    id: 'fast',
    label: 'Fast',
    description: 'A quick game - 6 questions.',
    composition: { multipleChoice: 3, trueFalse: 2, open: 1 },
  },
  {
    id: 'standard',
    label: 'Standard',
    description: 'A balanced game - 12 questions.',
    composition: { multipleChoice: 6, trueFalse: 4, open: 2 },
  },
  {
    id: 'long',
    label: 'Long',
    description: 'A longer game - 24 questions.',
    composition: { multipleChoice: 12, trueFalse: 8, open: 4 },
  },
  {
    id: 'marathon',
    label: 'Marathon',
    description: 'A marathon - 48 questions.',
    composition: { multipleChoice: 24, trueFalse: 16, open: 8 },
  },
];

export const DEFAULT_DURATION: Duration = 'standard';

/** Custom composition bounds (spec 0074): each type 0-30, total 1-60. Mirrors the engine. */
export const MIN_CUSTOM_PER_TYPE = 0;
export const MAX_CUSTOM_PER_TYPE = 30;
export const MIN_CUSTOM_TOTAL = 1;
export const MAX_CUSTOM_TOTAL = 60;

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const DEFAULT_DIFFICULTY_MIN = 3;
export const DEFAULT_DIFFICULTY_MAX = 6;

/** Auto-advance pacing (spec 0068), in seconds where noted. */
export const DEFAULT_AUTO_ADVANCE = true;
export const MIN_ADVANCE_AFTER_SECONDS = 1;
export const MAX_ADVANCE_AFTER_SECONDS = 60;
export const DEFAULT_ADVANCE_AFTER_SECONDS = 5;

/**
 * Per-type answer timers (spec 0074). A tap needs less time than typing, so each type has its own
 * window and bounds. Mirrors the engine authority: MC 20s (5-180), TF 15s (5-180), open 60s (10-180).
 */
export const MIN_MC_TIME_LIMIT_SECONDS = 5;
export const MAX_MC_TIME_LIMIT_SECONDS = 180;
export const DEFAULT_MC_TIME_LIMIT_SECONDS = 20;
export const MIN_TF_TIME_LIMIT_SECONDS = 5;
export const MAX_TF_TIME_LIMIT_SECONDS = 180;
export const DEFAULT_TF_TIME_LIMIT_SECONDS = 15;
export const MIN_OPEN_TIME_LIMIT_SECONDS = 10;
export const MAX_OPEN_TIME_LIMIT_SECONDS = 180;
export const DEFAULT_OPEN_TIME_LIMIT_SECONDS = 60;

/** One difficulty preset: a label + a plain description, mapping to a hidden 1-10 band. */
export interface DifficultyPreset {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
}

/**
 * Difficulty presets (spec 0068). The label + description are shown; the numeric 1-10 band is NEVER
 * exposed in the UI. `Medium` (3-6) is the default. A band matching no preset shows as `Custom`.
 */
export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  {
    id: 'easy',
    label: 'Easy',
    description: 'Everyday knowledge - a gentle warm-up.',
    min: 1,
    max: 4,
  },
  { id: 'medium', label: 'Medium', description: 'A balanced mix - the default.', min: 3, max: 6 },
  {
    id: 'moderate',
    label: 'Moderate',
    description: 'Tougher questions for a real test.',
    min: 4,
    max: 8,
  },
  {
    id: 'hard',
    label: 'Hard',
    description: 'Expert territory - for trivia buffs.',
    min: 6,
    max: 10,
  },
];

/** The preset id a difficulty band maps to, or `custom` when it matches none. */
export function difficultyPresetId(min: number, max: number): string {
  return (
    DIFFICULTY_PRESETS.find((preset) => preset.min === min && preset.max === max)?.id ?? 'custom'
  );
}

/**
 * A human word for a single question's 1-10 rating, shown as a badge on the in-game prompt (the
 * Viewer/Remote) so a player can picture what a number means. Display only; distinct from the host's
 * difficulty PRESETS above, and never used to expose the raw range in the setup form.
 */
export function difficultyBand(rating: number): 'Easy' | 'Medium' | 'Hard' {
  if (rating <= 3) return 'Easy';
  if (rating <= 7) return 'Medium';
  return 'Hard';
}

/** A short display label for a round type (spec 0074), for the in-game type badge. */
export function roundTypeLabel(type: TriviaRoundType): string {
  switch (type) {
    case 'multiple-choice':
      return 'Multiple choice';
    case 'true-false':
      return 'True or false';
    default:
      return 'Open answer';
  }
}

/** A host's Trivial Matters choices, before validation. */
export interface TriviaHostConfig {
  /** The category subset. An EMPTY list means Random (all categories). */
  categories: string[];
  /** The game duration (spec 0074). Sets the fixed MC/TF/open mix unless `custom`. */
  duration: Duration;
  /** Custom per-type counts, required (and used) only when `duration === 'custom'`. */
  custom?: Composition;
  /** Difficulty range floor, 1-10. Questions rated in [difficultyMin, difficultyMax] are drawn. */
  difficultyMin: number;
  /** Difficulty range ceiling, 1-10. Must be >= difficultyMin. */
  difficultyMax: number;
  /** Auto-advance the answer screen -> leaderboard -> next round. */
  autoAdvance: boolean;
  /** Dwell before each auto-advance hop, in seconds (1-60). */
  advanceAfterSeconds: number;
  /** Multiple-choice answer window, in seconds (5-180). */
  mcTimeLimitSeconds: number;
  /** True/false answer window, in seconds (5-180). */
  tfTimeLimitSeconds: number;
  /** Open-answer window, in seconds (10-180). */
  openTimeLimitSeconds: number;
}

/**
 * The MC/TF/open composition a config runs. For a preset it is the preset's fixed mix; for `custom`
 * it is the host's counts (zeros if not yet set). Derived, so the display total never drifts.
 */
export function compositionOf(config: TriviaHostConfig): Composition {
  if (config.duration === 'custom') {
    return config.custom ?? { multipleChoice: 0, trueFalse: 0, open: 0 };
  }
  const preset = DURATION_PRESETS.find((entry) => entry.id === config.duration);
  return preset?.composition ?? { multipleChoice: 0, trueFalse: 0, open: 0 };
}

/** The derived total number of rounds a config runs (for display + the control-plane per-round debit). */
export function totalRoundsOf(config: TriviaHostConfig): number {
  const composition = compositionOf(config);
  return composition.multipleChoice + composition.trueFalse + composition.open;
}

/**
 * The defaulted config a fresh lobby starts from: Random categories, Standard duration, Medium
 * difficulty, auto-advance on at 5s, and the per-type timers (20/15/60s).
 */
export function defaultTriviaConfig(): TriviaHostConfig {
  return {
    categories: [],
    duration: DEFAULT_DURATION,
    difficultyMin: DEFAULT_DIFFICULTY_MIN,
    difficultyMax: DEFAULT_DIFFICULTY_MAX,
    autoAdvance: DEFAULT_AUTO_ADVANCE,
    advanceAfterSeconds: DEFAULT_ADVANCE_AFTER_SECONDS,
    mcTimeLimitSeconds: DEFAULT_MC_TIME_LIMIT_SECONDS,
    tfTimeLimitSeconds: DEFAULT_TF_TIME_LIMIT_SECONDS,
    openTimeLimitSeconds: DEFAULT_OPEN_TIME_LIMIT_SECONDS,
  };
}

/** One validation failure, keyed by the field so the form can anchor the message. */
export interface ConfigError {
  field:
    | 'categories'
    | 'duration'
    | 'custom'
    | 'difficulty'
    | 'advanceAfter'
    | 'mcTimeLimit'
    | 'tfTimeLimit'
    | 'openTimeLimit';
  message: string;
}

function isIntInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

const DURATIONS: readonly Duration[] = ['fast', 'standard', 'long', 'marathon', 'custom'];

/**
 * Validate a host config against the engine's ranges. Returns every failure so the form can show
 * them all at once rather than one at a time. An empty array means the config is startable (the
 * engine still re-checks question-pool depth on the handoff, which the UI cannot know).
 */
export function validateTriviaConfig(config: TriviaHostConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  // An empty selection is Random (all categories) and always valid; a non-empty one must name only
  // real categories.
  if (
    !Array.isArray(config.categories) ||
    config.categories.some((category) => !CATEGORIES.includes(category))
  ) {
    errors.push({ field: 'categories', message: 'Pick Random or one or more categories.' });
  }

  // Duration must be one of the five known values; a `custom` duration then needs a valid composition.
  if (!DURATIONS.includes(config.duration)) {
    errors.push({ field: 'duration', message: 'Pick a game duration.' });
  } else if (config.duration === 'custom') {
    const custom = config.custom;
    if (
      !custom ||
      !isIntInRange(custom.multipleChoice, MIN_CUSTOM_PER_TYPE, MAX_CUSTOM_PER_TYPE) ||
      !isIntInRange(custom.trueFalse, MIN_CUSTOM_PER_TYPE, MAX_CUSTOM_PER_TYPE) ||
      !isIntInRange(custom.open, MIN_CUSTOM_PER_TYPE, MAX_CUSTOM_PER_TYPE)
    ) {
      errors.push({
        field: 'custom',
        message: `Each question count must be a whole number from ${MIN_CUSTOM_PER_TYPE} to ${MAX_CUSTOM_PER_TYPE}.`,
      });
    } else {
      const total = custom.multipleChoice + custom.trueFalse + custom.open;
      if (total < MIN_CUSTOM_TOTAL || total > MAX_CUSTOM_TOTAL) {
        errors.push({
          field: 'custom',
          message: `Total questions must be from ${MIN_CUSTOM_TOTAL} to ${MAX_CUSTOM_TOTAL}.`,
        });
      }
    }
  }

  // Mirror the engine authority exactly: both bounds must sit fully inside [MIN, MAX]. Checking only
  // min-from-below and max-from-above would let the mirror accept a payload the engine rejects.
  const boundsOk =
    isIntInRange(config.difficultyMin, MIN_DIFFICULTY, MAX_DIFFICULTY) &&
    isIntInRange(config.difficultyMax, MIN_DIFFICULTY, MAX_DIFFICULTY);
  if (!boundsOk) {
    errors.push({
      field: 'difficulty',
      message: `Difficulty must be whole numbers from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}.`,
    });
  } else if (config.difficultyMin > config.difficultyMax) {
    errors.push({
      field: 'difficulty',
      message: 'Difficulty minimum cannot be above the maximum.',
    });
  }

  if (
    !isIntInRange(config.advanceAfterSeconds, MIN_ADVANCE_AFTER_SECONDS, MAX_ADVANCE_AFTER_SECONDS)
  ) {
    errors.push({
      field: 'advanceAfter',
      message: `Advance after must be from ${MIN_ADVANCE_AFTER_SECONDS} to ${MAX_ADVANCE_AFTER_SECONDS} seconds.`,
    });
  }

  if (
    !isIntInRange(config.mcTimeLimitSeconds, MIN_MC_TIME_LIMIT_SECONDS, MAX_MC_TIME_LIMIT_SECONDS)
  ) {
    errors.push({
      field: 'mcTimeLimit',
      message: `Multiple-choice time limit must be from ${MIN_MC_TIME_LIMIT_SECONDS} to ${MAX_MC_TIME_LIMIT_SECONDS} seconds.`,
    });
  }

  if (
    !isIntInRange(config.tfTimeLimitSeconds, MIN_TF_TIME_LIMIT_SECONDS, MAX_TF_TIME_LIMIT_SECONDS)
  ) {
    errors.push({
      field: 'tfTimeLimit',
      message: `True/false time limit must be from ${MIN_TF_TIME_LIMIT_SECONDS} to ${MAX_TF_TIME_LIMIT_SECONDS} seconds.`,
    });
  }

  if (
    !isIntInRange(
      config.openTimeLimitSeconds,
      MIN_OPEN_TIME_LIMIT_SECONDS,
      MAX_OPEN_TIME_LIMIT_SECONDS,
    )
  ) {
    errors.push({
      field: 'openTimeLimit',
      message: `Open-answer time limit must be from ${MIN_OPEN_TIME_LIMIT_SECONDS} to ${MAX_OPEN_TIME_LIMIT_SECONDS} seconds.`,
    });
  }

  return errors;
}
