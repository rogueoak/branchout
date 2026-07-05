// The modular game registry. One engine hosts every game (architecture.md), kept modular so a
// game can later split into its own engine. Adding a game is registering its module here; the
// start handoff names a game by id and the engine resolves it. No game logic lives in the engine.

import type { GameModule } from './lifecycle';

export class UnknownGameError extends Error {
  constructor(id: string) {
    super(`no game registered with id "${id}"`);
    this.name = 'UnknownGameError';
  }
}

export class GameRegistry {
  private readonly modules = new Map<string, GameModule>();

  constructor(modules: readonly GameModule[] = []) {
    for (const module of modules) {
      this.register(module);
    }
  }

  /** Register a game module. Throws if its id collides with an already-registered game. */
  register(module: GameModule): void {
    if (this.modules.has(module.id)) {
      throw new Error(`a game is already registered with id "${module.id}"`);
    }
    this.modules.set(module.id, module);
  }

  /** True if a game with this id is registered. */
  has(id: string): boolean {
    return this.modules.has(id);
  }

  /** Resolve a game module by id, or throw {@link UnknownGameError}. */
  resolve(id: string): GameModule {
    const module = this.modules.get(id);
    if (!module) {
      throw new UnknownGameError(id);
    }
    return module;
  }

  /** All registered game ids. */
  ids(): string[] {
    return [...this.modules.keys()];
  }
}
