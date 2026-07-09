// The plugin + dependency-injection contract. A game ships as a `GamePlugin`: a static manifest
// (id, name, version, a config validator, coarse capabilities) plus a `create(services)` factory
// that the harness calls to build the pure `GameModule`. The harness injects everything a game may
// need through `GameServices` (an rng, a logger, an asset loader), so game code never reaches for
// process globals or the filesystem directly - which keeps it portable and unit-testable.

import type { GameModule } from './lifecycle';

/** A parse-or-throw validator: returns the normalized, defaulted config, or throws Error. */
export type ConfigSchema<Config> = (raw: unknown) => Config;

/** Coarse, declarative facts about a game the harness/host can reason about without running it. */
export interface GameCapabilities {
  /** Minimum players the game supports. */
  minPlayers?: number;
  /** Maximum players the game supports. */
  maxPlayers?: number;
}

/** Static description of a game, available without instantiating it. */
export interface GameManifest<Config = unknown> {
  /** Stable id; equals `GameModule.id` and `SessionState.game`. MUST NOT change for a shipped game. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Validate + normalize the opaque handoff config at the `/sessions` boundary. */
  readonly configSchema: ConfigSchema<Config>;
  readonly capabilities?: GameCapabilities;
}

/** Reads a game package's own bundled assets, resolved relative to that package's root. */
export interface AssetLoader {
  /** Read + JSON.parse a file relative to the package root. Throws on missing/invalid. */
  readJson<T = unknown>(relativePath: string): Promise<T>;
  /** Read a raw text asset relative to the package root. */
  readText(relativePath: string): Promise<string>;
}

/**
 * Builds an {@link AssetLoader} rooted at the *calling* game package. A game passes its own
 * `import.meta.url` so the loader resolves that package's `data/` regardless of where the process
 * launched from; tests inject a factory backed by an in-memory map instead.
 */
export interface AssetLoaderFactory {
  forModule(moduleUrl: string): AssetLoader;
}

/** Everything a game may need at construction time. All are injected by the harness. */
export interface GameServices {
  /** Uniform [0, 1) source; seed it in tests to make a whole game deterministic. */
  rng: () => number;
  /** Structured logger seam; the harness passes the real console, tests a silent one. */
  logger: Pick<Console, 'error' | 'warn' | 'info'>;
  /** Loads a game's own bundled data (replaces a pre-loaded question bank). */
  assets: AssetLoaderFactory;
  /** Optional wall-clock seam for games that need time. */
  now?: () => number;
}

/**
 * A game plugin. The typed payload generics `Prompt`/`Reveal` document the shapes a game streams;
 * they are inference/documentation aids only - on the wire and in `SessionState` these payloads stay
 * `unknown`. `create` may be async so a game can load its assets during construction, and returns the
 * pure `GameModule` the engine drives. `dispose` is optional teardown.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Prompt/Reveal are documentation generics
export interface GamePlugin<Config = unknown, Prompt = unknown, Reveal = unknown> {
  readonly manifest: GameManifest<Config>;
  create(services: GameServices): Promise<GameModule> | GameModule;
  dispose?(): Promise<void> | void;
}
