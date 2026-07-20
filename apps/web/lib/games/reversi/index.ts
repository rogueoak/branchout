// The Reversi browser UI module (spec 0054, spec 0023): the registration that plugs Reversi into the
// generic game shell. Reversi is a SINGLE interactive surface (`singleSurface: true`) - one board the
// player taps to place discs, streamed from the server; the shell renders only its Viewer and passes
// `onMove` straight through, so the Remote is an unused null no-op. Reversi is `visibility: 'public'`
// (WS9): it graduated from insider testing, so the gating helper surfaces it on the public picker,
// the /games index, the home hero carousel, and the sitemap. The browser is a pure renderer - all
// rules are server-authoritative (@branchout/game-reversi).

import { reversiSvg } from '@branchout/brand/reversi';
import { ReversiViewer } from './Viewer';
import { ReversiRemote } from './Remote';
import { ReversiConfigPanel } from './ConfigPanel';
import { ReversiAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultReversiConfig } from './config';
import type { GameUiModule } from '../registry';

/** Reversi is a single, open-ended game (no round count); a live game ends via the engine's over. */
export const REVERSI_ROUNDS = 1;

export const reversiGameUi: GameUiModule = {
  id: 'reversi',
  name: 'Reversi',
  tagline: 'Flip the board to your color - most discs wins.',
  icon: reversiSvg,
  summary:
    'The classic disc-flip strategy game for two. Place a disc to bracket a line of your ' +
    "opponent's discs and flip them all to your color. When neither side can move, the most discs " +
    'wins.',
  visibility: 'public',
  singleSurface: true,
  defaultConfig: () => defaultReversiConfig(),
  // Any boolean choice is valid; the engine re-checks the config shape on the start handoff.
  validateConfig: () => ({ ok: true }),
  roundsOf: () => REVERSI_ROUNDS,
  ConfigPanel: ReversiConfigPanel,
  AdvancedConfigPanel: ReversiAdvancedConfigPanel,
  Viewer: ReversiViewer,
  Remote: ReversiRemote,
};
