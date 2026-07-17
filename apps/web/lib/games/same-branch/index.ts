// The Same Branch browser UI module (spec 0023): plugs the spectrum-guessing game's config panel,
// viewer, and remote into the generic game shell, keyed by the engine game id 'same-branch'. Marked
// `visibility: 'insider'` so the gating helper keeps it out of the public picker/pages/sitemap.

import { sameBranchSvg } from '@branchout/brand/samebranch';
import type { GameUiModule } from '../registry';
import { SameBranchConfigPanel } from './ConfigPanel';
import { SameBranchViewer } from './Viewer';
import { SameBranchRemote } from './Remote';
import {
  defaultSameBranchConfig,
  validateSameBranchConfig,
  type SameBranchHostConfig,
} from './config';

export const sameBranchGameUi: GameUiModule = {
  id: 'same-branch',
  name: 'Same Branch',
  tagline: 'Read the hidden bud and land on the same spot.',
  icon: sameBranchSvg,
  summary:
    'One Reader sees a hidden spot on a branch between two opposites and gives a one-line hunch. ' +
    'The grove moves the sap line to guess where it is - score by how close you land.',
  visibility: 'insider',
  defaultConfig: () => defaultSameBranchConfig(),
  validateConfig: (config) => {
    const errors = validateSameBranchConfig(config as SameBranchHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const rounds = (config as SameBranchHostConfig | undefined)?.rounds;
    return typeof rounds === 'number' ? rounds : defaultSameBranchConfig().rounds;
  },
  ConfigPanel: SameBranchConfigPanel,
  Viewer: SameBranchViewer,
  Remote: SameBranchRemote,
};
