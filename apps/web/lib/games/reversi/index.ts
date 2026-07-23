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
  // Emerald Parlour (spec 0075): the timeless felt-green board look - deep green grounds, cream and
  // charcoal discs, a brass accent. The board field itself is themed via these tokens in the Viewer.
  skin: {
    bg: '#0f2019',
    surface: '#163025',
    surfaceRaised: '#1c3c2e',
    text: '#edf3ec',
    textMuted: '#9db7a6',
    border: '#234a37',
    primary: '#c9a24b',
    primaryForeground: '#14100c',
    secondary: '#8fd0a6',
    accent: '#c9a24b',
    // The board canvas (board-render.ts) reads primitive tokens: the honey ramp for the square tints
    // and the grape / sunbeam ramps for the two disc colours. Re-point them to a felt-green board with
    // cream-and-charcoal discs so the board matches Emerald Parlour instead of the default wood + violet.
    vars: {
      '--color-honey-800': '#26795a', // lighter felt square
      '--color-honey-950': '#1c5a43', // darker felt square
      '--color-honey-900': '#123f2e', // grid line
      '--color-grape-500': '#17130e', // "violet" side -> charcoal disc
      '--color-grape-700': '#050403', // charcoal disc rim
      '--color-sunbeam-400': '#f2ebda', // "amber" side -> cream disc
      '--color-sunbeam-600': '#cdbf9f', // cream disc rim
    },
  },
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
