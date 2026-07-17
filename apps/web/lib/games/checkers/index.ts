// The Checkers browser UI module (spec 0055, spec 0023): the registration that plugs Checkers into the
// generic game shell. Checkers is a SINGLE interactive surface (`singleSurface: true`) - one board the
// player taps to move pieces, streamed from the server; the shell renders only its Viewer and passes
// `onMove` straight through, so the Remote is an unused null no-op. Marked `visibility: 'insider'` so
// the gating helper keeps it off the public picker/pages/sitemap until it graduates. The browser is a
// pure renderer - all rules are server-authoritative (@branchout/game-checkers).

import { checkersSvg } from '@branchout/brand/checkers';
import { CheckersViewer } from './Viewer';
import { CheckersRemote } from './Remote';
import { CheckersConfigPanel } from './ConfigPanel';
import type { GameUiModule } from '../registry';

/** Checkers is a single, open-ended game (no round count); a live game ends via the engine's over. */
export const CHECKERS_ROUNDS = 1;

export const checkersGameUi: GameUiModule = {
  id: 'checkers',
  name: 'Checkers',
  tagline: 'Jump, chain, and crown - capture every piece to win.',
  icon: checkersSvg,
  summary:
    'The classic game of checkers (English draughts) for two. Move your pieces diagonally forward, ' +
    'jump an opponent to capture (and chain multi-jumps), and crown a King when you reach the far ' +
    'row. Capture every piece, or leave your opponent no move, to win.',
  visibility: 'insider',
  singleSurface: true,
  defaultConfig: () => ({}),
  validateConfig: () => ({ ok: true }),
  roundsOf: () => CHECKERS_ROUNDS,
  ConfigPanel: CheckersConfigPanel,
  Viewer: CheckersViewer,
  Remote: CheckersRemote,
};
