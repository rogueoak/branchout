// The Odd Bird browser UI module (spec 0023): plugs the hidden-role location game's config panel,
// viewer, and remote into the generic game shell, keyed by the engine game id 'odd-bird'. Marked
// `visibility: 'insider'` so the gating helper keeps it out of the public picker/pages/sitemap. The
// whole point is the secret card each player reads on their own phone (the Remote, via
// `state.private`); the viewer never shows a secret.

import { oddBirdSvg } from '@branchout/brand/oddbird';
import type { GameUiModule } from '../registry';
import { OddBirdConfigPanel } from './ConfigPanel';
import { OddBirdViewer } from './Viewer';
import { OddBirdRemote } from './Remote';
import { defaultOddBirdConfig, validateOddBirdConfig, type OddBirdHostConfig } from './config';

/**
 * The prefix marking an odd bird's roost guess on the `vote` frame (vs. an accusation of a player),
 * matching the engine's ROOST_GUESS_PREFIX in @branchout/game-odd-bird. Held here so the web bundle
 * does not depend on the headless engine package.
 */
export const ROOST_GUESS_TARGET_PREFIX = 'roost:';

export const oddBirdGameUi: GameUiModule = {
  id: 'odd-bird',
  name: 'Odd Bird',
  tagline: 'Everyone knows the roost but one - flush out the odd bird.',
  icon: oddBirdSvg,
  summary:
    'Everyone shares a secret location and a role at it - except one odd bird who is left in the ' +
    'dark. Ask pointed questions, expose the odd bird, and never give the roost away.',
  visibility: 'insider',
  defaultConfig: () => defaultOddBirdConfig(),
  validateConfig: (config) => {
    const errors = validateOddBirdConfig(config as OddBirdHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  // One location game per session.
  roundsOf: () => 1,
  ConfigPanel: OddBirdConfigPanel,
  Viewer: OddBirdViewer,
  Remote: OddBirdRemote,
};
