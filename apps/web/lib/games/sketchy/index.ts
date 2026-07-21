// The Sketchy browser UI module (spec 0063): plugs the draw-and-guess game's config panel, viewer, and
// remote into the generic game shell, keyed by the engine game id 'sketchy'. Insider-only.

import { sketchySvg } from '@branchout/brand/sketchy';
import type { GameUiModule } from '../registry';
import { SketchyConfigPanel } from './ConfigPanel';
import { SketchyAdvancedConfigPanel } from './AdvancedConfigPanel';
import { SketchyViewer } from './Viewer';
import { SketchyRemote } from './Remote';
import { defaultSketchyConfig, validateSketchyConfig, type SketchyHostConfig } from './config';

export const sketchyGameUi: GameUiModule = {
  id: 'sketchy',
  visibility: 'insider',
  // Each player claims a reserved 3-color palette in the lobby and draws with only those (spec 0063).
  usesPalettes: true,
  name: 'Sketchy',
  tagline: 'Draw the daft seed, then bluff your friends with decoys.',
  icon: sketchySvg,
  summary:
    'Everyone draws a secret seed, then writes fake prompts for each sketch. Pick out the real seed and fool the room with your decoys.',
  defaultConfig: () => defaultSketchyConfig(),
  validateConfig: (config) => {
    const errors = validateSketchyConfig(config as SketchyHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const rounds = (config as SketchyHostConfig | undefined)?.rounds;
    return typeof rounds === 'number' ? rounds : defaultSketchyConfig().rounds;
  },
  ConfigPanel: SketchyConfigPanel,
  AdvancedConfigPanel: SketchyAdvancedConfigPanel,
  Viewer: SketchyViewer,
  Remote: SketchyRemote,
};
