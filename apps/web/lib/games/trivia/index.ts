// The Trivia browser UI module (spec 0023): the registration that plugs Trivia's config panel,
// viewer, and remote into the generic game shell. The behavior is unchanged from the pre-registry
// client - the viewer/remote are the same components, now resolved by game id instead of hardwired.

import { ViewerPane } from './Viewer';
import { RemotePane } from './Remote';
import { defaultTriviaConfig, validateTriviaConfig, type TriviaHostConfig } from './config';
import type { GameUiModule } from '../registry';
import { TriviaConfigPanel } from './ConfigPanel';

export const triviaGameUi: GameUiModule = {
  id: 'trivia',
  name: 'Trivia',
  tagline: 'Answer trivia questions; dispute a close call.',
  defaultConfig: () => defaultTriviaConfig(),
  validateConfig: (config) => {
    const errors = validateTriviaConfig(config as TriviaHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const rounds = (config as TriviaHostConfig | undefined)?.rounds;
    return typeof rounds === 'number' ? rounds : defaultTriviaConfig().rounds;
  },
  ConfigPanel: TriviaConfigPanel,
  Viewer: ViewerPane,
  Remote: RemotePane,
};
