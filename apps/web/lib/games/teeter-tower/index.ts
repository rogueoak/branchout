// The Teeter Tower browser UI module (spec 0044, spec 0023): the registration that plugs Teeter into
// the generic game shell. Teeter is a SINGLE interactive surface (`singleSurface: true`) - one live
// canvas the player aims + drops on, streamed from the server; the shell renders only its Viewer and
// passes `onMove` straight through, so the Remote is an unused null no-op. Marked `visibility:
// 'insider'` so the gating helper keeps it out of the public picker/pages/sitemap until it graduates.
// The browser is a pure renderer - all physics is server-authoritative (@branchout/game-teeter-tower).

import { teeterTowerSvg } from '@branchout/brand/teeter-tower';
import { TeeterViewer } from './Viewer';
import { TeeterRemote } from './Remote';
import { TeeterConfigPanel } from './ConfigPanel';
import type { GameUiModule } from '../registry';

/**
 * Total pieces across Teeter's three levels (11 + 20 + 22), the engine's round count
 * (TOTAL_ROUNDS in @branchout/game-teeter-tower). Held as a local constant so the browser bundle
 * stays a pure renderer with no dependency on the headless physics engine package.
 */
export const TEETER_TOTAL_ROUNDS = 53;

export const teeterTowerGameUi: GameUiModule = {
  id: 'teeter-tower',
  name: 'Teeter Tower',
  tagline: 'Stack googly-eyed pieces to reach the line.',
  icon: teeterTowerSvg,
  summary:
    'Spin a wobbly, googly-eyed piece, lock its angle, and drop it. Build a tower that reaches the ' +
    'target line across three levels - without toppling the whole stack.',
  visibility: 'insider',
  singleSurface: true,
  defaultConfig: () => ({}),
  validateConfig: () => ({ ok: true }),
  roundsOf: () => TEETER_TOTAL_ROUNDS,
  ConfigPanel: TeeterConfigPanel,
  Viewer: TeeterViewer,
  Remote: TeeterRemote,
};
