// The Trivia browser UI module (spec 0023): the registration that plugs Trivia's config panel,
// viewer, and remote into the generic game shell. The behavior is unchanged from the pre-registry
// client - the viewer/remote are the same components, now resolved by game id instead of hardwired.

import { triviaSvg } from '@branchout/brand/trivia';
import { ViewerPane } from './Viewer';
import { RemotePane } from './Remote';
import {
  defaultTriviaConfig,
  totalRoundsOf,
  validateTriviaConfig,
  type TriviaHostConfig,
} from './config';
import type { GameUiModule } from '../registry';
import { TriviaConfigPanel } from './ConfigPanel';
import { TriviaAdvancedConfigPanel } from './AdvancedConfigPanel';

export const triviaGameUi: GameUiModule = {
  id: 'trivia',
  name: 'Trivial Matters',
  tagline: 'Mix multiple choice, true or false, and open answers.',
  icon: triviaSvg,
  summary:
    'A trivia party game that mixes three question types - multiple choice, true or false, and open answer - across 10 categories. Pick a duration from Fast to Marathon; open rounds still go to a group vote on a close call.',
  // Marquee Gold (spec 0075): a game-show palette - brass and spotlight cream on warm espresso, with
  // a magenta pop and a teal accent.
  skin: {
    bg: '#1a140f',
    surface: '#241a10',
    surfaceRaised: '#2a2018',
    text: '#fff3d6',
    textMuted: '#d8c199',
    border: '#40331f',
    primary: '#e8b04b',
    primaryForeground: '#1a140f',
    secondary: '#e5397e',
    accent: '#2bb7a3',
  },
  defaultConfig: () => defaultTriviaConfig(),
  validateConfig: (config) => {
    const errors = validateTriviaConfig(config as TriviaHostConfig);
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors[0]?.message };
  },
  roundsOf: (config) => {
    const candidate = config as (Partial<TriviaHostConfig> & { rounds?: number }) | undefined;
    // Prefer the duration/custom composition (spec 0074). A legacy config carrying only `rounds`
    // (the pre-0074 open-only shape) still resolves so a bookmarked lobby never reads zero rounds.
    if (candidate && typeof candidate.duration === 'string') {
      return totalRoundsOf(candidate as TriviaHostConfig);
    }
    if (candidate && typeof candidate.rounds === 'number') {
      return candidate.rounds;
    }
    return totalRoundsOf(defaultTriviaConfig());
  },
  ConfigPanel: TriviaConfigPanel,
  AdvancedConfigPanel: TriviaAdvancedConfigPanel,
  Viewer: ViewerPane,
  Remote: RemotePane,
};
