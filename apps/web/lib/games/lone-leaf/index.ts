// The Lone Leaf browser UI module (spec 0057): plugs the cooperative single-clue word game's config
// panel, viewer, and remote into the generic game shell, keyed by the engine game id 'lone-leaf'.
// Insider-only (spec 0043), mirroring the engine manifest's visibility.

import { loneLeafSvg } from '@branchout/brand/loneleaf';
import type { GameUiModule } from '../registry';
import { LoneLeafConfigPanel } from './ConfigPanel';
import { LoneLeafViewer } from './Viewer';
import { LoneLeafRemote } from './Remote';
import { defaultLoneLeafConfig, validateLoneLeafConfig, type LoneLeafHostConfig } from './config';

export const loneLeafGameUi: GameUiModule = {
  id: 'lone-leaf',
  visibility: 'insider',
  name: 'Lone Leaf',
  tagline: 'One word each helps the Seeker - but matching words wilt away.',
  icon: loneLeafSvg,
  summary:
    'A cooperative word game: everyone gives the Seeker a single one-word clue, but matching clues ' +
    'wilt and vanish - so think alike, but not too alike, and guess the hidden seed together.',
  defaultConfig: () => defaultLoneLeafConfig(),
  validateConfig: (config) => {
    const errors = validateLoneLeafConfig(config as LoneLeafHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const rounds = (config as LoneLeafHostConfig | undefined)?.rounds;
    return typeof rounds === 'number' ? rounds : defaultLoneLeafConfig().rounds;
  },
  ConfigPanel: LoneLeafConfigPanel,
  Viewer: LoneLeafViewer,
  Remote: LoneLeafRemote,
};
