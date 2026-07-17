// The Zinger browser UI module (spec 0053): plugs the funny-answer party game's config panel, viewer,
// and remote into the generic game shell, keyed by the engine game id 'zinger'. Insider-only
// (spec 0043): it appears only on the insider surface, never in the apex picker.

import { zingerSvg } from '@branchout/brand/zinger';
import type { GameUiModule } from '../registry';
import { ZingerConfigPanel } from './ConfigPanel';
import { ZingerViewer } from './Viewer';
import { ZingerRemote } from './Remote';
import { defaultZingerConfig, validateZingerConfig, type ZingerHostConfig } from './config';

export const zingerGameUi: GameUiModule = {
  id: 'zinger',
  visibility: 'insider',
  name: 'Zinger',
  tagline: 'Answer the setup, then vote on whose zinger landed hardest.',
  icon: zingerSvg,
  summary:
    'Everyone answers a silly setup with a short funny zinger, then two are pitted head to head and ' +
    'the room votes on the funnier one.',
  defaultConfig: () => defaultZingerConfig(),
  validateConfig: (config) => {
    const errors = validateZingerConfig(config as ZingerHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const rounds = (config as ZingerHostConfig | undefined)?.rounds;
    return typeof rounds === 'number' ? rounds : defaultZingerConfig().rounds;
  },
  ConfigPanel: ZingerConfigPanel,
  Viewer: ZingerViewer,
  Remote: ZingerRemote,
};
