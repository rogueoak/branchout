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
