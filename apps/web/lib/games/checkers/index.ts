// The Checkers browser UI module (spec 0055, spec 0023): the registration that plugs Checkers into the
// generic game shell. Checkers is a SINGLE interactive surface (`singleSurface: true`) - one board the
// player taps to move pieces, streamed from the server; the shell renders only its Viewer and passes
// `onMove` straight through, so the Remote is an unused null no-op. Checkers is `visibility: 'public'`
// (WS14): it graduated from insider testing, so the gating helper surfaces it on the public picker,
// the /games index, the home hero carousel, and the sitemap. The browser is a pure renderer - all
// rules are server-authoritative (@branchout/game-checkers).

import { checkersSvg } from '@branchout/brand/checkers';
import { CheckersViewer } from './Viewer';
import { CheckersRemote } from './Remote';
import { CheckersConfigPanel } from './ConfigPanel';
import { CheckersAdvancedConfigPanel } from './AdvancedConfigPanel';
import { defaultCheckersConfig } from './config';
import type { GameUiModule } from '../registry';

/** Checkers is a single, open-ended game (no round count); a live game ends via the engine's over. */
export const CHECKERS_ROUNDS = 1;

export const checkersGameUi: GameUiModule = {
  id: 'checkers',
  name: 'Checkers',
  tagline: 'Jump, chain, and crown - clear the board or block their last move to win.',
  icon: checkersSvg,
  summary:
    'The classic game of checkers (English draughts) for two. Move your pieces diagonally forward, ' +
    'jump an opponent to capture (and chain multi-jumps), and crown a King when you reach the far ' +
    'row. Capture every piece, or leave your opponent no move, to win.',
  // Classic Red (spec 0075): cream and forest checkerboard, red versus charcoal pieces, a gold crown
  // for kings. The board squares and pieces are themed via these tokens in the Viewer.
  skin: {
    bg: '#14110f',
    surface: '#201a16',
    surfaceRaised: '#2a221c',
    text: '#f3ece0',
    textMuted: '#b9a894',
    border: '#352a20',
    primary: '#c6303a',
    primaryForeground: '#f3ece0',
    secondary: '#e8c15a',
    accent: '#e8c15a',
    // The board canvas (board-render.ts) reads primitive tokens: the honey ramp for the checkerboard
    // squares, the grape / sunbeam ramps for the two piece colours, honey-300 for the king crown, and
    // grape-400 for the move highlight. Re-point them to a cream-and-forest board with red-versus-
    // charcoal pieces and a gold crown, matching Classic Red.
    vars: {
      '--color-honey-800': '#e8dcc0', // light (cream) square
      '--color-honey-950': '#3a5a44', // dark (forest) square
      '--color-honey-900': '#2c4636', // grid line
      '--color-honey-300': '#e8c15a', // king crown -> gold
      '--color-grape-500': '#cf3a3a', // "violet" side -> red piece
      '--color-grape-700': '#9e2a2a', // red piece rim
      '--color-grape-400': '#e88a94', // move highlight -> soft red
      '--color-sunbeam-400': '#26221e', // "amber" side -> charcoal piece
      '--color-sunbeam-600': '#0e0d0b', // charcoal piece rim
    },
  },
  visibility: 'public',
  singleSurface: true,
  defaultConfig: () => defaultCheckersConfig(),
  // Any boolean choice is valid; the engine re-checks the config shape on the start handoff.
  validateConfig: () => ({ ok: true }),
  roundsOf: () => CHECKERS_ROUNDS,
  ConfigPanel: CheckersConfigPanel,
  AdvancedConfigPanel: CheckersAdvancedConfigPanel,
  Viewer: CheckersViewer,
  Remote: CheckersRemote,
};
