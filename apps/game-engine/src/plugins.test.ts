import { describe, expect, it } from 'vitest';
import type { GamePlugin } from '@branchout/game-sdk';
import {
  createTestServices,
  stubGame,
  stubPlugin,
  STUB_GAME_ID,
} from '@branchout/game-sdk/testing';
import { registerPlugins } from './plugins';

describe('registerPlugins', () => {
  it('instantiates each plugin into the registry and collects its config schema', async () => {
    const { registry, configSchemas } = await registerPlugins([stubPlugin], createTestServices());

    expect(registry.resolve(STUB_GAME_ID)).toBe(stubGame);
    expect(registry.ids()).toEqual([STUB_GAME_ID]);
    // The schema the engine runs at the /sessions boundary is the plugin manifest's own validator.
    expect(configSchemas.get(STUB_GAME_ID)).toBe(stubPlugin.manifest.configSchema);
  });

  it('rejects two plugins that claim the same id', async () => {
    await expect(registerPlugins([stubPlugin, stubPlugin], createTestServices())).rejects.toThrow(
      /already registered/,
    );
  });

  it('rejects a plugin whose built module id does not match its manifest id', async () => {
    // The manifest promises `not-stub` but `create` returns the stub module (id `stub`); the
    // runtime must refuse the mismatch rather than register a game under a lying id.
    const mislabelled: GamePlugin = {
      manifest: {
        id: 'not-stub',
        name: 'Mislabelled',
        version: '1.0.0',
        configSchema: (raw) => raw,
      },
      create: () => stubGame,
    };

    await expect(registerPlugins([mislabelled], createTestServices())).rejects.toThrow(
      /mismatched id/,
    );
  });
});
