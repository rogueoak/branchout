// The plugin runtime: turn a list of game plugins into a resolved registry the engine drives. For
// each plugin the harness calls `create(services)` (injecting dependencies), registers the resulting
// module, and collects its config schema so the `/sessions` handoff can validate config at the
// boundary. Registering a plugin here is the one and only place a game attaches to the engine.

import type { ConfigSchema, GamePlugin, GameServices } from '@branchout/game-sdk';
import { GameRegistry } from './registry';

export interface RegisteredPlugins {
  registry: GameRegistry;
  /** Per-game config validators, keyed by game id, run at the start-handoff boundary. */
  configSchemas: Map<string, ConfigSchema<unknown>>;
}

/**
 * The main-thread view of the registered games WITHOUT instantiating any module (spec 0045): the
 * game ids and their config validators. Under worker isolation the modules are built inside each
 * session's worker, so the engine's main thread only needs the manifests here - to know a game
 * exists and to validate its handoff config at the `/sessions` boundary. Throws on a duplicate id.
 */
export function collectManifests(plugins: readonly GamePlugin[]): {
  gameIds: string[];
  configSchemas: Map<string, ConfigSchema<unknown>>;
} {
  const configSchemas = new Map<string, ConfigSchema<unknown>>();
  for (const plugin of plugins) {
    if (configSchemas.has(plugin.manifest.id)) {
      throw new Error(`a game is already registered with id "${plugin.manifest.id}"`);
    }
    configSchemas.set(plugin.manifest.id, plugin.manifest.configSchema as ConfigSchema<unknown>);
  }
  return { gameIds: [...configSchemas.keys()], configSchemas };
}

/**
 * Instantiate each plugin with the injected services and build the registry. Throws if a plugin's
 * built module id does not match its manifest id, or (via {@link GameRegistry.register}) if two
 * plugins claim the same id.
 */
export async function registerPlugins(
  plugins: readonly GamePlugin[],
  services: GameServices,
): Promise<RegisteredPlugins> {
  const registry = new GameRegistry();
  const configSchemas = new Map<string, ConfigSchema<unknown>>();
  for (const plugin of plugins) {
    const module = await plugin.create(services);
    if (module.id !== plugin.manifest.id) {
      throw new Error(
        `plugin "${plugin.manifest.id}" built a module with mismatched id "${module.id}"`,
      );
    }
    registry.register(module);
    configSchemas.set(plugin.manifest.id, plugin.manifest.configSchema as ConfigSchema<unknown>);
  }
  return { registry, configSchemas };
}
