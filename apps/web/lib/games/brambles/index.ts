// The Brambles browser UI module (spec 0061, spec 0023): plugs the two-team forbidden-words game into
// the generic game shell, keyed by the engine game id 'brambles'. Marked `visibility: 'insider'` so
// the gating helper keeps it off the public picker/pages/sitemap until it graduates. NOT single-
// surface: the shared Viewer is the scoreboard everyone watches, and the Remote is the private
// controller (the Guide sees the secret bloom + thorns; teammates type guesses).

import { bramblesSvg } from '@branchout/brand/brambles';
import type { GameUiModule } from '../registry';
import { BramblesConfigPanel } from './ConfigPanel';
import { BramblesViewer } from './Viewer';
import { BramblesRemote } from './Remote';
import { defaultBramblesConfig, validateBramblesConfig, type BramblesHostConfig } from './config';

export const bramblesGameUi: GameUiModule = {
  id: 'brambles',
  name: 'Brambles',
  tagline: 'Get your grove to say the bloom - without touching a thorn.',
  icon: bramblesSvg,
  summary:
    "A two-team word game. Your grove's Guide gets a hidden target word (the bloom) and a list of " +
    'forbidden words (the thorns), and types clues while your grove races to guess it - touch a ' +
    'thorn and the card wilts. Most blooms across the sprints wins.',
  visibility: 'insider',
  defaultConfig: () => defaultBramblesConfig(),
  validateConfig: (config) => {
    const errors = validateBramblesConfig(config as BramblesHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  // A live game runs its own sim loop; the per-round debit uses this as the round count. Report the
  // sprint count so the control-plane debits once per team turn.
  roundsOf: (config) => {
    const sprints = (config as BramblesHostConfig | undefined)?.sprints;
    return typeof sprints === 'number' && Number.isFinite(sprints)
      ? sprints
      : defaultBramblesConfig().sprints;
  },
  ConfigPanel: BramblesConfigPanel,
  Viewer: BramblesViewer,
  Remote: BramblesRemote,
};
