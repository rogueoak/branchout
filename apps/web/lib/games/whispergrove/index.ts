// The Whispergrove browser UI module (spec 0062, spec 0023): the registration that plugs Whispergrove
// into the generic game shell. Whispergrove is a two-team, two-surface game: the Viewer is the shared
// grove everyone watches, and the Remote is each player's controller (the Whisperer composes a whisper
// and sees the secret key; a seeker taps leaves). Marked `visibility: 'insider'` so the gating helper
// keeps it out of the public picker/pages/sitemap until it graduates. The browser is a pure renderer;
// all rules + the secret key are server-authoritative (@branchout/game-whispergrove, spec 0052).

import { whispergroveSvg } from '@branchout/brand/whispergrove';
import { WhispergroveViewer } from './Viewer';
import { WhispergroveRemote } from './Remote';
import { WhispergroveConfigPanel } from './ConfigPanel';
import { defaultConfig } from './config';
import { validateWhispergroveConfig } from './config';
import type { GameUiModule } from '../registry';

export const whispergroveGameUi: GameUiModule = {
  id: 'whispergrove',
  name: 'Whispergrove',
  tagline: 'Two groves, one whisper at a time.',
  icon: whispergroveSvg,
  summary:
    'A two-team word-grid game for phones. Each grove has one Whisperer who alone sees the secret ' +
    'key; they give a one-word whisper and a number, and their grove taps leaves to link them - ' +
    'first grove to reveal all its leaves wins, but tap the Deadwood and your grove falls.',
  visibility: 'insider',
  defaultConfig: () => defaultConfig(),
  validateConfig: (config: unknown) => validateWhispergroveConfig(config),
  // One live match; the round count is nominal (the game ends when a grove clears or wakes the
  // Deadwood, via the engine's live tick), so report a single round.
  roundsOf: () => 1,
  ConfigPanel: WhispergroveConfigPanel,
  Viewer: WhispergroveViewer,
  Remote: WhispergroveRemote,
};
