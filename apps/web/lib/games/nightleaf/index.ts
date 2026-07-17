// The Nightleaf browser UI module (spec 0060): plugs the cooperative, silent, ascending-number game
// into the generic game shell, keyed by the engine game id 'nightleaf'. Nightleaf is a LIVE, MULTI-
// surface game: the Viewer is the shared grove (trunk, buds, tier, per-player leaf counts) everyone
// watches, and each player's Remote shows their OWN secret hand (delivered on the private frame, spec
// 0052) plus the two silent moves. Marked `visibility: 'insider'` so the gating helper keeps it off
// the public picker/pages/sitemap until it graduates.

import { nightleafSvg } from '@branchout/brand/nightleaf';
import type { GameUiModule } from '../registry';
import { NightleafConfigPanel } from './ConfigPanel';
import { NightleafViewer } from './Viewer';
import { NightleafRemote } from './Remote';
import {
  defaultNightleafConfig,
  validateNightleafConfig,
  type NightleafHostConfig,
} from './config';

export const nightleafGameUi: GameUiModule = {
  id: 'nightleaf',
  name: 'Nightleaf',
  tagline: 'Play your leaves in order - no words, no signals.',
  icon: nightleafSvg,
  summary:
    'A cooperative, silent card climb. Everyone holds a hidden hand of numbered leaves and must play ' +
    'them onto one shared pile in ascending order - with no talking about the numbers. Play out of ' +
    'turn and the grove loses a bud.',
  visibility: 'insider',
  defaultConfig: () => defaultNightleafConfig(),
  validateConfig: (config) => {
    const errors = validateNightleafConfig(config as NightleafHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const tiers = (config as NightleafHostConfig | undefined)?.tiers;
    return typeof tiers === 'number' ? tiers : defaultNightleafConfig().tiers;
  },
  ConfigPanel: NightleafConfigPanel,
  Viewer: NightleafViewer,
  Remote: NightleafRemote,
};
