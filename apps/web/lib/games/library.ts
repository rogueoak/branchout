// The game library (spec 0051): the taxonomy and rules layer over the registry. A registry module
// says how a game renders; its marketing catalog entry sells it; this library entry organizes it - a
// game's categories (broad genre), tags (facets), and a structured rules overview. One controlled
// vocabulary and one `GAME_LIBRARY` record, keyed by slug (== registry id), so the /games index can
// search + filter, the feature page can render full rules, and the in-game help sheet can read the
// same rules while playing. Pure data + pure helpers, server- AND client-safe (no server-only
// imports) so the client help sheet imports it directly. Adding a game must add a library entry -
// `toLibrary` fails loudly, the same pattern the marketing catalog already uses.

import { GAME_UI_LIST, type GameUiModule } from './registry';

/**
 * The broad genre vocabulary: 1+ per game, the first is primary. Keys are slugs (stored on entries
 * and in URLs); values are the display labels shown as chips and in the filter control.
 */
export const GAME_CATEGORIES = {
  party: 'Party',
  word: 'Word',
  drawing: 'Drawing',
  deduction: 'Deduction',
  cooperative: 'Co-op',
  strategy: 'Strategy',
  classic: 'Classic',
} as const;
export type GameCategory = keyof typeof GAME_CATEGORIES;

/** The facet vocabulary: finer than a category (team play, group size, pace, the twist). */
export const GAME_TAGS = {
  teams: 'Teams',
  'hidden-role': 'Hidden role',
  bluffing: 'Bluffing',
  wordplay: 'Wordplay',
  sketching: 'Sketching',
  trivia: 'Trivia',
  memory: 'Memory',
  spatial: 'Spatial',
  wit: 'Wit',
  deduction: 'Deduction',
  'two-player': '2 players',
  'small-group': 'Small group',
  'big-group': 'Big group',
  quick: 'Quick',
  'turn-based': 'Turn-based',
  'real-time': 'Real-time',
} as const;
export type GameTag = keyof typeof GAME_TAGS;

/** One headed block of the rules: a title plus one or more short paragraphs. */
export interface RulesSection {
  heading: string; // "Setup", "On your turn", "Scoring", "Good to know"
  body: string[]; // paragraphs; a section is one or more short paragraphs
}

/** A game's structured rules: the one-sentence objective plus headed sections. */
export interface GameRules {
  objective: string; // one sentence: how you win
  sections: RulesSection[];
}

/** A game's library entry: its taxonomy (categories, tags) and its rules overview. */
export interface GameLibraryEntry {
  categories: GameCategory[]; // 1+, first is primary
  tags: GameTag[];
  rules: GameRules;
}

// Keyed by slug (== registry id). Adding a game means adding its registry module AND one entry here;
// `toLibrary` throws below if a registered game has no entry. Categories/tags use vocabulary keys, so
// a typo fails the completeness test (data can come from spreads TypeScript cannot fully police).
const GAME_LIBRARY: Record<string, GameLibraryEntry> = {
  trivia: {
    categories: ['party'],
    tags: ['trivia', 'real-time', 'big-group', 'wit'],
    rules: {
      objective: 'Score the most points by answering questions correctly across the rounds.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host picks the categories, a difficulty range, and how many rounds to play, then ' +
              'shares the join code. Everyone joins on their own phone.',
          ],
        },
        {
          heading: 'On each round',
          body: [
            'A question appears for everyone at once. Type your answer in your own words before the ' +
              '60-second timer runs out - there is no multiple choice.',
          ],
        },
        {
          heading: 'Reveal and dispute',
          body: [
            'Answers reveal together and a correct one scores 100 points. If you were marked wrong ' +
              'but think you were right, dispute it in the short window and the group votes to settle ' +
              'it. Winning the vote scores 50.',
          ],
        },
        {
          heading: 'Good to know',
          body: [
            'Close calls end on the scoreboard, not in an argument. The highest total after the last ' +
              'round wins.',
          ],
        },
      ],
    },
  },
  'liar-liar': {
    categories: ['party', 'deduction'],
    tags: ['bluffing', 'deduction', 'wit', 'big-group', 'real-time'],
    rules: {
      objective: 'Score the most by fooling other players with your fake and by finding the truth.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host sets the number of rounds and shares the join code. Everyone plays on their ' +
              'own phone.',
          ],
        },
        {
          heading: 'Write a lie',
          body: [
            'A wild-but-true clue appears with the answer blanked out. Invent a fake answer ' +
              'convincing enough to fool the room before the 90-second timer ends. A fake that ' +
              'matches the truth or another player is quietly rejected, so try again.',
          ],
        },
        {
          heading: 'Find the truth',
          body: [
            'Every fake plus the real answer appears, shuffled. Pick the one you think is true ' +
              'before the 30-second guess timer runs out.',
          ],
        },
        {
          heading: 'Scoring',
          body: [
            'Guessing the real answer scores 100. Each player your fake fools scores you 50. The ' +
              'highest total after the last round wins.',
          ],
        },
      ],
    },
  },
  'lone-leaf': {
    categories: ['cooperative', 'word'],
    tags: ['wordplay', 'small-group', 'turn-based'],
    rules: {
      objective:
        'Work together to help the Seeker guess the hidden seed from your surviving one-word clues.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host picks the seed themes and how many rounds to play, then shares the join code. ' +
              'Everyone plays on their own phone. Lone Leaf needs 3 to 7 players.',
          ],
        },
        {
          heading: 'The Seeker and the seed',
          body: [
            'Each round one player is the Seeker (the role rotates so everyone takes a turn). The ' +
              'Seeker never sees the seed - the hidden word - but every other player does, privately ' +
              'on their own phone.',
          ],
        },
        {
          heading: 'Write one leaf',
          body: [
            'Every non-Seeker secretly writes a single one-word clue - a leaf - for the seed. Before ' +
              'the Seeker looks, any two leaves that match wilt and vanish (a plural or a case change ' +
              'still counts as a match), so only the clues nobody else thought of survive.',
          ],
        },
        {
          heading: 'Guess and score',
          body: [
            'The Seeker sees only the surviving leaves and takes one guess. Lone Leaf is cooperative: ' +
              'a correct guess banks a point for the whole grove, and everyone shares the same ' +
              'standing. Aim for the highest shared score across the rounds.',
          ],
        },
      ],
    },
  },
  'teeter-tower': {
    categories: ['strategy'],
    tags: ['spatial', 'real-time', 'quick'],
    rules: {
      objective: 'Stack pieces to reach the target line on each level without toppling the tower.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Teeter Tower is a single-surface game you play on one screen. There are three levels: a ' +
              'warm-up, a taller walled climb, and a swinging pendulum.',
          ],
        },
        {
          heading: 'Spin and lock',
          body: [
            'A googly-eyed piece spins on the board. Tap or drag to position it, then tap the ' +
              'on-canvas Stop spin button to lock the angle you want it to drop at.',
          ],
        },
        {
          heading: 'Aim and drop',
          body: [
            'Drag to fine-tune where the piece sits over the tower, then tap Drop and watch the ' +
              'physics settle it onto the stack.',
          ],
        },
        {
          heading: 'Reach the line',
          body: [
            'Stack piece on piece until the tower reaches the target line to clear the level. Keep ' +
              'the stack balanced - a piece that slides off is lost.',
          ],
        },
      ],
    },
  },
  zinger: {
    categories: ['party', 'word'],
    tags: ['wit', 'wordplay', 'big-group', 'real-time'],
    rules: {
      objective:
        'Score the most by writing zingers that win their face-off votes across the rounds.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host sets the number of rounds and shares the join code. Everyone plays on their ' +
              'own phone; it is best with three or more players.',
          ],
        },
        {
          heading: 'Answer the setup',
          body: [
            'Each round shows a short, silly setup. Type your funniest zinger before the 90-second ' +
              'timer runs out. An empty answer is quietly rejected, so try again.',
          ],
        },
        {
          heading: 'The face-off',
          body: [
            'Two zingers are pitted head to head, with their authors hidden. Everyone who did not ' +
              'write either votes for the funnier one before the 30-second timer ends.',
          ],
        },
        {
          heading: 'Scoring',
          body: [
            'The winning zinger scores its author one point per vote. A unanimous vote is a clean ' +
              'sweep and adds a +3 bonus; a tie splits no points. The highest total after the last ' +
              'round wins.',
          ],
        },
      ],
    },
  },
  brambles: {
    categories: ['word', 'party'],
    tags: ['teams', 'wordplay', 'big-group', 'real-time'],
    rules: {
      objective:
        'Get your grove to say the hidden bloom without your Guide ever touching a thorn. Most ' +
        'blooms across the sprints wins.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Brambles needs at least four players split into two groves (Violet and Amber), assigned ' +
              'by seat. Each grove takes timed turns called sprints; the groves alternate.',
          ],
        },
        {
          heading: 'The Guide',
          body: [
            'On your grove sprint, your Guide alone sees the card: a bloom (the target word) and five ' +
              'thorns (forbidden words). Only the Guide gets this - the other grove never sees it.',
          ],
        },
        {
          heading: 'Clue and guess',
          body: [
            'The Guide types clues without saying the bloom, a thorn, or an obvious variant. The rest ' +
              'of the grove types guesses; a correct guess scores a bloom and draws the next card.',
          ],
        },
        {
          heading: 'Pricks and skips',
          body: [
            'If a clue contains the bloom or a thorn, the card is pricked - it wilts for no point and ' +
              'a new card is drawn. The Guide may also skip a card. When time runs out, the other ' +
              'grove takes its sprint.',
          ],
        },
      ],
    },
  },
  nightleaf: {
    categories: ['cooperative', 'party'],
    tags: ['memory', 'real-time', 'small-group', 'quick'],
    rules: {
      objective:
        'Silently play every leaf in every hand onto one shared pile in ascending order, and clear ' +
        'the final tier before the buds run out.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Nightleaf is a cooperative game for 2 to 6 players, each on their own phone. Every player ' +
              'gets a secret hand of numbered leaves - tier 1 deals one leaf each, tier 2 deals two, ' +
              'and so on. The group shares a pool of buds (lives) and fireflies (hushes).',
          ],
        },
        {
          heading: 'The one rule: silence',
          body: [
            'You may not say, show, or hint at the numbers on your leaves - no counting, no signals, ' +
              'no timing tricks. Reading the room is the whole game.',
          ],
        },
        {
          heading: 'Play in order',
          body: [
            'Everyone plays at once, in real time. When you think your lowest leaf is the next number ' +
              'up, play it onto the shared trunk. Every leaf across every hand must land in strictly ' +
              'ascending order.',
            'If a leaf is played while anyone still holds a lower one, the grove loses a bud - but the ' +
              'leaf still lands. Lose all your buds and the grove falls.',
          ],
        },
        {
          heading: 'Hush',
          body: [
            'Stuck? If everyone still holding leaves proposes a hush, the group spends one firefly and ' +
              'everyone discards their lowest leaf at once - no bud cost. A wordless reset.',
          ],
        },
        {
          heading: 'Winning',
          body: [
            'Clear a tier (empty every hand) to climb to the next, bigger tier. Clear the final tier ' +
              'with buds to spare and the whole grove wins together - Nightleaf is purely cooperative, ' +
              'so you win or lose as one.',
          ],
        },
      ],
    },
  },
  sketchy: {
    categories: ['drawing', 'party'],
    tags: ['sketching', 'bluffing', 'wit', 'small-group', 'real-time'],
    rules: {
      objective:
        'Score the most by finding the true seed behind each sketch and by fooling players with ' +
        'your decoys.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host sets the number of rounds and shares the join code. Sketchy is for 3-8 players, ' +
              'each on their own phone.',
          ],
        },
        {
          heading: 'Draw your seed',
          body: [
            'Every player is privately given a different seed (a short prompt) that only they can ' +
              'see. Draw it freehand on your phone before the timer ends.',
          ],
        },
        {
          heading: 'Write a decoy',
          body: [
            'One by one, each sketch is shown. For every sketch that is not yours, write a fake seed ' +
              '(a decoy) you think could pass for the real one. A decoy that matches the true seed or ' +
              'another player is quietly rejected, so try again.',
          ],
        },
        {
          heading: 'Find the true seed',
          body: [
            'The decoys plus the true seed appear shuffled. Pick the one you think is real before the ' +
              'guess timer runs out. You cannot pick your own decoy.',
          ],
        },
        {
          heading: 'Scoring',
          body: [
            'Finding the true seed scores 100. Each player your decoy fools scores you 50. The ' +
              'highest total after the last round wins.',
          ],
        },
      ],
    },
  },
  whispergrove: {
    categories: ['word', 'party', 'deduction'],
    tags: ['teams', 'wordplay', 'deduction', 'big-group', 'turn-based'],
    rules: {
      objective:
        'Be the first grove to reveal all of your own leaves - without ever waking the Deadwood.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Whispergrove needs four or more players in two groves: Violet and Amber. Twenty-five ' +
              'word leaves fill a 5x5 grove. A secret key marks nine leaves for the starting grove, ' +
              'eight for the other, seven neutral saplings, and one instant-loss Deadwood.',
            'Each grove has one Whisperer who alone sees the key on their own device; everyone else ' +
              'sees only the words.',
          ],
        },
        {
          heading: 'Give a whisper',
          body: [
            'On your grove turn, the Whisperer gives ONE word plus a number - the whisper - hinting ' +
              'how many of your leaves the word links. The word cannot be one printed on the grove.',
          ],
        },
        {
          heading: 'Tap your leaves',
          body: [
            'Your grove taps leaves. A leaf of your own color keeps your turn going (up to one tap ' +
              'past the number). A sapling or an enemy leaf ends your turn; the Deadwood loses the ' +
              'game for your grove instantly.',
          ],
        },
        {
          heading: 'Win the grove',
          body: [
            'Groves alternate whispering and tapping. The first grove to reveal all of its own ' +
              'leaves wins. Tapping the Deadwood hands the win to the other grove.',
          ],
        },
      ],
    },
  },
  reversi: {
    categories: ['classic', 'strategy'],
    tags: ['two-player', 'spatial', 'turn-based'],
    rules: {
      objective: 'Have the most discs of your color on the board when neither side can move.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Reversi is a two-player game on one shared 8x8 board. Four discs start in the middle - ' +
              'two Violet and two Amber on the diagonals. Violet moves first.',
          ],
        },
        {
          heading: 'On your turn',
          body: [
            'Place one disc of your color on an empty square so that, in a straight line (across, ' +
              "down, or diagonally), it traps one or more of your opponent's discs between the " +
              'new disc and another of yours. Every trapped disc in every such line flips to your ' +
              'color. A placement that traps nothing is not allowed - the board highlights your ' +
              'legal squares.',
          ],
        },
        {
          heading: 'Passing',
          body: [
            'You must move whenever you have a legal move. If you have none but your opponent does, ' +
              'your turn is skipped (a pass) and they play again.',
          ],
        },
        {
          heading: 'Winning',
          body: [
            'The game ends when neither side can move - often when the board is full. Whoever has ' +
              'more discs of their color wins; an equal count is a draw. Grabbing corners, which can ' +
              'never be flipped, is the key to a strong game.',
          ],
        },
      ],
    },
  },
  chess: {
    categories: ['classic', 'strategy'],
    tags: ['two-player', 'spatial', 'turn-based'],
    rules: {
      objective: 'Checkmate the opponent king - attack it so it has no legal escape.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Chess is a two-player game on one shared 8x8 board. Each side starts with eight pawns, ' +
              'two rooks, two knights, two bishops, a queen, and a king. Violet (White) moves first, ' +
              'then the two sides alternate.',
          ],
        },
        {
          heading: 'On your turn',
          body: [
            'Tap one of your pieces to select it and its legal squares light up, then tap a ' +
              'highlighted square to move. Each piece moves its own way - the rook in straight lines, ' +
              'the bishop on diagonals, the queen both, the knight in an L, the king one square, and ' +
              'the pawn forward (capturing diagonally). You may never make a move that leaves your own ' +
              'king in check.',
          ],
        },
        {
          heading: 'Special moves',
          body: [
            'Castling tucks your king toward a corner behind an unmoved rook when the path is clear ' +
              'and the king does not pass through check. En passant lets a pawn capture an enemy pawn ' +
              'that just slipped past it on a two-square advance - but only on the very next move. A ' +
              'pawn reaching the far rank promotes to a queen, rook, bishop, or knight.',
          ],
        },
        {
          heading: 'Winning',
          body: [
            'You win by checkmate: the enemy king is attacked and cannot escape, block, or capture ' +
              'the attacker. If the side to move has no legal move but is not in check, the game is a ' +
              'stalemate draw; bare kings (or too little material to mate) also draw. You may resign ' +
              'at any time.',
          ],
        },
      ],
    },
  },
  'odd-bird': {
    categories: ['deduction', 'party'],
    tags: ['hidden-role', 'deduction', 'bluffing', 'small-group', 'real-time'],
    rules: {
      objective:
        'The flock wins by voting out the odd bird; the odd bird wins by surviving the vote or naming the roost.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Odd Bird seats 3 to 8 players. A roost (a shared location) is drawn: everyone gets the ' +
              'same roost plus a distinct perch (a role at it) on their own phone - except one random ' +
              'odd bird, who is told only that they are the odd bird and do not know the roost.',
          ],
        },
        {
          heading: 'Question the flock',
          body: [
            'Take turns asking each other pointed questions out loud. Answers must fit the roost ' +
              'without naming it. The odd bird bluffs and listens for clues to work out where everyone ' +
              'else is.',
          ],
        },
        {
          heading: 'Call the flush',
          body: [
            'When the flock is ready (or the timer runs out), anyone can call the flush. Everyone ' +
              'votes for who they think the odd bird is; the odd bird instead gets one guess at the ' +
              'roost.',
          ],
        },
        {
          heading: 'Scoring',
          body: [
            'If the flock flushes the odd bird, every member of the flock scores. If the odd bird ' +
              'slips the vote, they score for surviving. Naming the roost scores the odd bird a bonus ' +
              'either way.',
          ],
        },
      ],
    },
  },
  checkers: {
    categories: ['classic', 'strategy'],
    tags: ['two-player', 'spatial', 'turn-based'],
    rules: {
      objective:
        'Capture all of your opponent pieces, or leave them with no legal move, to win the game.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'Checkers (English draughts) is a two-player game on one shared 8x8 board, played on the ' +
              'dark squares only. Each side starts with 12 men on the dark squares of its three home ' +
              'rows - Amber along the top, Violet along the bottom. Violet moves first.',
          ],
        },
        {
          heading: 'Moving',
          body: [
            'A man moves one square diagonally forward to an empty dark square (Violet moves up the ' +
              'board, Amber down). The board highlights your legal squares - tap a piece, then tap ' +
              'where it goes.',
          ],
        },
        {
          heading: 'Capturing',
          body: [
            'Jump over a touching opponent piece into the empty square just beyond to capture it. If ' +
              'the piece can jump again after landing, it must keep jumping in the same turn (a ' +
              'multi-jump). If any jump is available to you, you must take a jump that turn.',
          ],
        },
        {
          heading: 'Kings and winning',
          body: [
            'A man that stops on the far row is crowned a King, which moves and jumps diagonally in ' +
              'all four directions. You win by capturing every opponent piece, or by leaving your ' +
              'opponent with no legal move on their turn.',
          ],
        },
      ],
    },
  },
  'same-branch': {
    categories: ['party', 'deduction'],
    tags: ['wit', 'deduction', 'small-group', 'turn-based'],
    rules: {
      objective:
        'Score points by landing your guess close to the hidden bud - most points wins, or chase a ' +
        'high shared score together in co-op.',
      sections: [
        {
          heading: 'Setup',
          body: [
            'The host picks the spectrum categories, the number of rounds, and a scoring mode ' +
              '(free-for-all or co-op), then shares the join code. Everyone plays on their own phone. ' +
              'The Reader role rotates each round.',
          ],
        },
        {
          heading: 'The Reader reads the bud',
          body: [
            'Each round shows a branch running between two opposites (like cold and hot). One player ' +
              'is the Reader and alone sees the hidden bud - the sweet spot on the branch - and gives ' +
              'a one-line hunch that fits where it sits.',
          ],
        },
        {
          heading: 'The grove guesses',
          body: [
            'Everyone else drags the sap line to where they think the bud is, based on the hunch, ' +
              'then locks it in before the timer ends.',
          ],
        },
        {
          heading: 'Scoring',
          body: [
            'The bud is revealed and each guess scores by closeness: a bullseye is worth 4, a close ' +
              'guess 3, a near one 2, and a wild miss nothing. In co-op the whole grove pools its ' +
              'points into one score.',
          ],
        },
      ],
    },
  },
};

/**
 * Resolve a registered game's library entry, or throw. Fail loudly: a registered game with no
 * library entry would ship a broken feature page (no rules) and break the completeness test, so
 * adding a game must add its entry here (mirrors `toEntry` in catalog.ts).
 */
export function toLibrary(module: GameUiModule): GameLibraryEntry {
  const entry = GAME_LIBRARY[module.id];
  if (!entry) {
    throw new Error(`No library entry for game "${module.id}" - add one to lib/games/library.ts`);
  }
  return entry;
}

/** The library entry for a slug, or undefined for an unknown game. */
export function getLibraryEntry(slug: string | undefined | null): GameLibraryEntry | undefined {
  return slug ? GAME_LIBRARY[slug] : undefined;
}

/** The rules overview for a slug, or undefined for an unknown game. */
export function getGameRules(slug: string | undefined | null): GameRules | undefined {
  return getLibraryEntry(slug)?.rules;
}

/** A category or tag resolved to its display label. */
export interface LibraryChip {
  slug: string;
  label: string;
}

/** A game's categories + tags with display labels, for chips on cards and pages. */
export interface LibraryMeta {
  categories: LibraryChip[];
  tags: LibraryChip[];
}

/** Categories + tags of a slug resolved to display labels, or undefined for an unknown game. */
export function getLibraryMeta(slug: string | undefined | null): LibraryMeta | undefined {
  const entry = getLibraryEntry(slug);
  if (!entry) return undefined;
  return {
    categories: entry.categories.map((slug) => ({ slug, label: GAME_CATEGORIES[slug] })),
    tags: entry.tags.map((slug) => ({ slug, label: GAME_TAGS[slug] })),
  };
}

/** A game the search surfaces over: the slug + the free-text fields matched against. */
export interface SearchableGame {
  slug: string;
  name: string;
  summary: string;
}

/** Filters for {@link searchLibrary}: an optional category the game must declare. */
export interface SearchOptions {
  category?: GameCategory;
}

/**
 * Search a set of games by a free-text query (case-insensitive substring over name, summary, and tag
 * labels) and an optional category filter. Returns the matching slugs, preserving input order. An
 * empty query matches everything (the filter still applies), so the /games index can pass the query
 * straight through as the visitor types.
 */
export function searchLibrary(
  games: readonly SearchableGame[],
  query: string,
  options: SearchOptions = {},
): string[] {
  const q = query.trim().toLowerCase();
  const { category } = options;
  return games
    .filter((game) => {
      const entry = GAME_LIBRARY[game.slug];
      if (!entry) return false;
      if (category && !entry.categories.includes(category)) return false;
      if (!q) return true;
      const haystack = [
        game.name,
        game.summary,
        ...entry.tags.map((tag) => GAME_TAGS[tag]),
        ...entry.categories.map((cat) => GAME_CATEGORIES[cat]),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .map((game) => game.slug);
}

/**
 * The categories some game in the given set actually declares, in vocabulary order, with labels -
 * the options for the /games filter control (only offer a filter that would match something).
 */
export function categoriesInUse(games: readonly SearchableGame[]): LibraryChip[] {
  const used = new Set<GameCategory>();
  for (const game of games) {
    const entry = GAME_LIBRARY[game.slug];
    if (!entry) continue;
    for (const category of entry.categories) used.add(category);
  }
  return (Object.keys(GAME_CATEGORIES) as GameCategory[])
    .filter((slug) => used.has(slug))
    .map((slug) => ({ slug, label: GAME_CATEGORIES[slug] }));
}

/**
 * Every registered game's library entry, resolved via `toLibrary` so the build fails loudly if any
 * registered game lacks an entry (the completeness guard the spec's test asserts).
 */
export const GAME_LIBRARY_ENTRIES: ReadonlyMap<string, GameLibraryEntry> = new Map(
  GAME_UI_LIST.map((module) => [module.id, toLibrary(module)]),
);
