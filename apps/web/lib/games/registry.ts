// The web game-UI registry (spec 0023) - the browser mirror of the engine's plugin registry
// (spec 0018). A game ships a `GameUiModule`: how to configure it (the host's config panel), and how
// to render it (the viewer screen everyone watches and the remote controller a player acts on). The
// generic shell (GameStage) resolves the module by the room's selected game id and renders it, so
// adding a game is adding a module + registering it here - no shell edits, no `if (game === ...)`.

import type { ComponentType } from 'react';
import type { GameState } from '../game-state';

/** Read-side props every game viewer receives: the folded state and the local player id. */
export interface GameViewProps {
  state: GameState;
  me?: string;
}

/** Props a game remote (the private controller) receives: state, identity, and the wire actions. */
export interface GameRemoteProps {
  state: GameState;
  me: string;
  /** True when the controller is the only pane on screen (a remote-only player), so it also shows
   * the between-round leaderboard and the final results an interactive player reads from the viewer. */
  showResults?: boolean;
  /** True when the controller belongs to the host (self-aware between-round copy). */
  isHost?: boolean;
  /** Submit this player's free-text answer for the round (Trivia answer / Liar Liar fake). */
  onAnswer: (round: number, answer: string) => void;
  /** Cast a vote: Trivia dispute (target = self) / ballot (target = disputer); Liar Liar guess
   * (target = chosen option id). The engine reads it by phase. */
  onVote: (round: number, target: string, agree: boolean) => void;
}

/** Props a host config panel receives. `value`/`onChange` carry the game's opaque config blob. */
export interface GameConfigPanelProps {
  value: unknown;
  onChange: (config: unknown) => void;
  disabled?: boolean;
}

/** The result of validating a host config: `ok` gates Start; `error` is one plain reason. */
export interface ConfigValidation {
  ok: boolean;
  error?: string;
}

/** One game's browser UI: config + the two in-game surfaces. Keyed by the engine game id. */
export interface GameUiModule {
  /** The engine game id (matches the plugin id: `trivia`, `liar-liar`). */
  id: string;
  /** The display name shown in the host's game picker. */
  name: string;
  /** A short tagline for the picker. */
  tagline: string;
  /** The game's on-theme mark as an inline SVG string (from `@branchout/brand`), shown on the detail
   * card in the game picker (spec 0029). Not user input; inlined like the Wordmark icon. */
  icon: string;
  /** One plain sentence of what the game is - the detail card's body and the single source a later
   * feature page (spec 0030) can share, so the picker and the marketing page never drift. */
  summary: string;
  /** The default config a fresh lobby starts from. */
  defaultConfig: () => unknown;
  /** Validate a host config against the game's rules (mirrors the engine; the engine re-checks). */
  validateConfig: (config: unknown) => ConfigValidation;
  /**
   * The number of rounds this config runs, read from the game's own config shape (the control-plane
   * debits per round). Keeps the game-agnostic shell from reaching into a game-specific config field.
   */
  roundsOf: (config: unknown) => number;
  ConfigPanel: ComponentType<GameConfigPanelProps>;
  Viewer: ComponentType<GameViewProps>;
  Remote: ComponentType<GameRemoteProps>;
}

// The registry is imported below its type declarations so the module files can import the prop types
// from here without a cycle (types are erased; the value import lands last).
import { triviaGameUi } from './trivia';
import { liarLiarGameUi } from './liar-liar';

/** Every registered game UI module, keyed by game id. Adding a game is adding it here. */
export const GAME_UI_MODULES: Record<string, GameUiModule> = {
  [triviaGameUi.id]: triviaGameUi,
  [liarLiarGameUi.id]: liarLiarGameUi,
};

/** The host's game options, in display order. */
export const GAME_UI_LIST: readonly GameUiModule[] = [triviaGameUi, liarLiarGameUi];

/** The default game a fresh room starts on, and the safe fallback for an unknown id. */
export const DEFAULT_GAME_UI: GameUiModule = triviaGameUi;

/** Resolve a game UI module by id, or undefined for an unknown game. */
export function getGameUi(id: string | undefined | null): GameUiModule | undefined {
  return id ? GAME_UI_MODULES[id] : undefined;
}
