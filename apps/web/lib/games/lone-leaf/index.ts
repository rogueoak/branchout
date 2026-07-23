// The Lone Leaf browser UI module (spec 0057): plugs the cooperative single-clue word game's config
// panel, viewer, and remote into the generic game shell, keyed by the engine game id 'lone-leaf'.
// Public (promoted from insider in spec 0073), so it defaults to public visibility - the same as
// Trivia and Liar Liar - and appears on the public /games index, its feature page, and the featured
// home hero carousel.

import { loneLeafSvg } from '@branchout/brand/loneleaf';
import type { GameUiModule } from '../registry';
import { LoneLeafConfigPanel } from './ConfigPanel';
import { LoneLeafAdvancedConfigPanel } from './AdvancedConfigPanel';
import { LoneLeafViewer } from './Viewer';
import { LoneLeafRemote } from './Remote';
import { defaultLoneLeafConfig, validateLoneLeafConfig, type LoneLeafHostConfig } from './config';

export const loneLeafGameUi: GameUiModule = {
  id: 'lone-leaf',
  name: 'Lone Leaf',
  tagline: 'One word each helps the Seeker - but matching clues cancel out.',
  icon: loneLeafSvg,
  summary:
    'A cooperative word game: everyone gives the Seeker a single one-word clue, but matching clues ' +
    'cancel out - so think alike, but not too alike, and guess the hidden word together.',
  // Forest Floor (spec 0075): deep grove greens and a warm gold stem - calm, rooted, cooperative.
  skin: {
    bg: '#132015',
    surface: '#1e2f21',
    surfaceRaised: '#26402e',
    text: '#f2f8ef',
    textMuted: '#a9c2a6',
    border: '#2c4230',
    primary: '#7cc77c',
    primaryForeground: '#12250f',
    secondary: '#d2a463',
    accent: '#9be08a',
  },
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
  AdvancedConfigPanel: LoneLeafAdvancedConfigPanel,
  Viewer: LoneLeafViewer,
  Remote: LoneLeafRemote,
};
