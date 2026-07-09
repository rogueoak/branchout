// The Trivia browser UI module (spec 0023): the registration that plugs Trivia's config panel,
// viewer, and remote into the generic game shell. The behavior is unchanged from the pre-registry
// client - the viewer/remote are the same components, now resolved by game id instead of hardwired.

import { ViewerPane } from '../../../components/game/ViewerPane';
import { RemotePane } from '../../../components/game/RemotePane';
import {
  defaultTriviaConfig,
  validateTriviaConfig,
  type TriviaHostConfig,
} from '../../trivia-config';
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
  ConfigPanel: TriviaConfigPanel,
  Viewer: ViewerPane,
  Remote: RemotePane,
};
