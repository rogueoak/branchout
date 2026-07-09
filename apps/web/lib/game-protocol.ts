// Decoders for Trivia's opaque prompt/reveal payloads. The protocol (spec 0007) types the
// envelope but leaves `prompt`/`reveal` as `unknown` - each game defines their shape (spec 0008,
// apps/game-engine/src/games/trivia/trivia.ts). These guards turn the opaque field into a typed
// value at the client boundary, so a shape the UI does not understand is a null (a skipped render),
// never a thrown render.

/** The prompt payload Trivia streams on `startRound`. */
export interface TriviaPrompt {
  round: number;
  category: string;
  /**
   * The drawn question's difficulty rating - an integer 1-10 (spec 0016). The engine puts
   * `question.difficulty` (now a number) on the prompt, so the client accepts a number here. (This
   * reverses the earlier tier-string decoder: the bank moved from easy/medium/hard tiers to a 1-10
   * rating, and the wire follows.)
   */
  difficulty: number;
  question: string;
}

/** One player's submitted answer for the round, with its verdict (spec 0017). */
export interface TriviaSubmission {
  player: string;
  answer: string;
  correct: boolean;
}

/** The reveal payload Trivia streams when the answer round closes (`reveal`). */
export interface TriviaRoundReveal {
  round: number;
  /** The question prompt text (echoed from the prompt), or null if the round had no question. */
  question: string | null;
  /** The accepted answers; the first is the canonical answer, the rest are also accepted. */
  answers: string[];
  /** Player ids who answered correctly. */
  correct: string[];
  /** Player ids marked wrong - the dispute-eligible set. */
  wrong: string[];
  /**
   * Every player's submitted answer this round, so the viewer can show the whole table what each
   * person said (spec 0017). Optional/additive: a pre-0017 engine omits it; the decoder defaults it
   * to `[]` and readers treat absence as "no per-player answers".
   */
  submissions?: TriviaSubmission[];
}

/** The follow-up reveal Trivia streams after disputes resolve (`disputeVote`). */
export interface TriviaDisputeReveal {
  round: number;
  /** Player ids whose dispute the other players upheld. */
  upheld: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Decode the optional per-player submissions list, tolerating a pre-0017 payload that omits it. */
function asSubmissions(value: unknown): TriviaSubmission[] {
  if (!Array.isArray(value)) return [];
  const out: TriviaSubmission[] = [];
  for (const item of value) {
    if (
      isRecord(item) &&
      typeof item.player === 'string' &&
      typeof item.answer === 'string' &&
      typeof item.correct === 'boolean'
    ) {
      out.push({ player: item.player, answer: item.answer, correct: item.correct });
    }
  }
  return out;
}

/** Decode a `prompt` payload as a Trivia prompt, or null if it is not one. */
export function asTriviaPrompt(value: unknown): TriviaPrompt | null {
  if (!isRecord(value)) return null;
  const { round, category, difficulty, question } = value;
  if (
    typeof round === 'number' &&
    typeof category === 'string' &&
    typeof difficulty === 'number' &&
    typeof question === 'string'
  ) {
    return { round, category, difficulty, question };
  }
  return null;
}

/** Decode a `reveal` payload as the answer-round reveal, or null if it is the dispute reveal. */
export function asTriviaRoundReveal(value: unknown): TriviaRoundReveal | null {
  if (!isRecord(value)) return null;
  const { round, question, answers, correct, wrong, submissions } = value;
  if (
    typeof round === 'number' &&
    (question === null || typeof question === 'string') &&
    isStringArray(answers) &&
    isStringArray(correct) &&
    isStringArray(wrong)
  ) {
    return {
      round,
      question,
      answers,
      correct,
      wrong,
      submissions: asSubmissions(submissions),
    };
  }
  return null;
}

/** Decode a `reveal` payload as the post-dispute reveal, or null if it is the answer reveal. */
export function asTriviaDisputeReveal(value: unknown): TriviaDisputeReveal | null {
  if (!isRecord(value)) return null;
  const { round, upheld } = value;
  // The dispute reveal is distinguished by `upheld` with no `answers` field.
  if (typeof round === 'number' && isStringArray(upheld) && !('answers' in value)) {
    return { round, upheld };
  }
  return null;
}
