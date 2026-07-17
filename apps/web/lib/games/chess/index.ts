// The Chess browser UI module (spec 0056, spec 0023): the registration that plugs Chess into the
// generic game shell. Chess is a SINGLE interactive surface (`singleSurface: true`) - one board the
// player taps to move pieces, streamed from the server; the shell renders only its Viewer and passes
// `onMove` straight through, so the Remote is an unused null no-op. Marked `visibility: 'insider'` so
// the gating helper keeps it off the public picker/pages/sitemap until it graduates. The browser is a
// pure renderer - all rules (full legal-move generation, check/checkmate) are server-authoritative
// (@branchout/game-chess).

import { chessSvg } from '@branchout/brand/chess';
import { ChessViewer } from './Viewer';
import { ChessRemote } from './Remote';
import { ChessConfigPanel } from './ConfigPanel';
import type { GameUiModule } from '../registry';

/** Chess is a single, open-ended game (no round count); a live game ends via the engine's over. */
export const CHESS_ROUNDS = 1;

export const chessGameUi: GameUiModule = {
  id: 'chess',
  name: 'Chess',
  tagline: 'Classic chess for two - checkmate the other king.',
  icon: chessSvg,
  summary:
    'The classic game of chess for two players, built for phones. Full standard rules - castling, ' +
    'en passant, and promotion - with every legal move enforced by the server. Trap the enemy king ' +
    'with no escape to win by checkmate.',
  visibility: 'insider',
  singleSurface: true,
  defaultConfig: () => ({}),
  validateConfig: () => ({ ok: true }),
  roundsOf: () => CHESS_ROUNDS,
  ConfigPanel: ChessConfigPanel,
  Viewer: ChessViewer,
  Remote: ChessRemote,
};
