// Asset-loader factories. The production factory reads a game's `data/` from disk. By default it
// resolves the game package's own root (the nearest ancestor directory with a package.json, walking
// up from the calling module) so a game reads its bundled `data/` whether it runs from `src` under
// tsx or from a bundled `dist`. When GAME_DATA_DIR is set it reads from that mounted directory
// instead (the private data repo, mounted at deploy time). The in-memory factory backs unit tests: a
// game's `create(services)` can load fixtures without touching disk.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AssetLoader, AssetLoaderFactory } from './plugin';

/** Walk up from a module's directory to the nearest ancestor that owns a package.json. */
function resolvePackageRoot(moduleUrl: string): string {
  let dir = path.dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `assets: could not find a package.json above ${fileURLToPath(moduleUrl)} to root the loader`,
      );
    }
    dir = parent;
  }
}

/** A real filesystem asset loader: reads game data from disk, rooted at each game's package. */
export function createFsAssetLoaderFactory(): AssetLoaderFactory {
  return {
    forModule(moduleUrl: string): AssetLoader {
      // Mount override: when GAME_DATA_DIR is set and non-empty, read every game's data from THAT
      // directory instead of the calling package's bundled data. Relative read paths are unchanged
      // (`data/trivia/...`, `data/liar-liar/...`), so one mount root at GAME_DATA_DIR serves both
      // games. Deploy bind-mounts the private data repo there (see deploy/README.md); unset falls
      // back to the package's own bundled sample via the moduleUrl walk.
      const mount = process.env.GAME_DATA_DIR;
      const root = mount && mount.length > 0 ? mount : resolvePackageRoot(moduleUrl);
      return {
        async readJson<T = unknown>(relativePath: string): Promise<T> {
          const raw = await readFile(path.join(root, relativePath), 'utf8');
          return JSON.parse(raw) as T;
        },
        async readText(relativePath: string): Promise<string> {
          return readFile(path.join(root, relativePath), 'utf8');
        },
      };
    },
  };
}

/**
 * An in-memory asset loader for tests. `files` maps a relative path to its value: a parsed object
 * (returned as-is by `readJson`) or a string. `forModule` ignores the module url - the same map
 * backs every game.
 */
export function createMemoryAssetLoaderFactory(files: Record<string, unknown>): AssetLoaderFactory {
  const loader: AssetLoader = {
    readJson<T = unknown>(relativePath: string): Promise<T> {
      if (!(relativePath in files)) {
        return Promise.reject(new Error(`assets: no in-memory file at "${relativePath}"`));
      }
      return Promise.resolve(files[relativePath] as T);
    },
    readText(relativePath: string): Promise<string> {
      if (!(relativePath in files)) {
        return Promise.reject(new Error(`assets: no in-memory file at "${relativePath}"`));
      }
      const value = files[relativePath];
      return Promise.resolve(typeof value === 'string' ? value : JSON.stringify(value));
    },
  };
  return { forModule: () => loader };
}
