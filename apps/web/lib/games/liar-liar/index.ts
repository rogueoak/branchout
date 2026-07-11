// The Liar Liar browser UI module (spec 0023): plugs the bluffing game's config panel, viewer, and
// remote into the generic game shell, keyed by the engine game id 'liar-liar' (spec 0021).

import { liarLiarSvg } from '@branchout/brand/liarliar';
import type { GameUiModule } from '../registry';
import { LiarLiarConfigPanel } from './ConfigPanel';
import { LiarLiarViewer } from './Viewer';
import { LiarLiarRemote } from './Remote';
import { defaultLiarLiarConfig, validateLiarLiarConfig, type LiarLiarHostConfig } from './config';

export const liarLiarGameUi: GameUiModule = {
  id: 'liar-liar',
  name: 'Liar Liar',
  tagline: 'Bluff your friends with convincing lies.',
  icon: liarLiarSvg,
  summary:
    'Write a convincing fake answer to a wild-but-true clue, then pick the real one hidden among all the lies.',
  defaultConfig: () => defaultLiarLiarConfig(),
  validateConfig: (config) => {
    const errors = validateLiarLiarConfig(config as LiarLiarHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const rounds = (config as LiarLiarHostConfig | undefined)?.rounds;
    return typeof rounds === 'number' ? rounds : defaultLiarLiarConfig().rounds;
  },
  ConfigPanel: LiarLiarConfigPanel,
  Viewer: LiarLiarViewer,
  Remote: LiarLiarRemote,
};
