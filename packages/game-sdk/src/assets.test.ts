import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createFsAssetLoaderFactory, createMemoryAssetLoaderFactory } from './assets';

describe('createFsAssetLoaderFactory', () => {
  const roots: string[] = [];

  afterAll(() => {
    void roots; // temp dirs are left to the OS; nothing to clean deterministically
  });

  it('reads json and text rooted at the calling module package', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'game-sdk-assets-'));
    roots.push(root);
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }));
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(path.join(root, 'data', 'q.json'), JSON.stringify([{ id: 'a-001' }]));
    await writeFile(path.join(root, 'data', 'note.txt'), 'hello');
    // A module deeper than the package root still resolves to the root that owns package.json.
    await mkdir(path.join(root, 'src', 'games'), { recursive: true });
    const moduleUrl = pathToFileURL(path.join(root, 'src', 'games', 'mod.js')).href;

    const loader = createFsAssetLoaderFactory().forModule(moduleUrl);
    await expect(loader.readJson<{ id: string }[]>('data/q.json')).resolves.toEqual([
      { id: 'a-001' },
    ]);
    await expect(loader.readText('data/note.txt')).resolves.toBe('hello');
  });

  it('throws when no package.json roots the module', async () => {
    // The filesystem root has no package.json above it.
    const rootUrl = pathToFileURL(path.join(path.parse(process.cwd()).root, 'nope.js')).href;
    expect(() => createFsAssetLoaderFactory().forModule(rootUrl)).toThrow(/package\.json/);
  });
});

describe('createMemoryAssetLoaderFactory', () => {
  const factory = createMemoryAssetLoaderFactory({
    'data/q.json': [{ id: 'a-001' }],
    'data/note.txt': 'hello',
  });
  const loader = factory.forModule('file:///ignored.js');

  it('returns stored json and text regardless of module url', async () => {
    await expect(loader.readJson('data/q.json')).resolves.toEqual([{ id: 'a-001' }]);
    await expect(loader.readText('data/note.txt')).resolves.toBe('hello');
  });

  it('stringifies a non-string value for readText', async () => {
    await expect(loader.readText('data/q.json')).resolves.toBe(JSON.stringify([{ id: 'a-001' }]));
  });

  it('rejects a missing key', async () => {
    await expect(loader.readJson('data/missing.json')).rejects.toThrow(/no in-memory file/);
    await expect(loader.readText('data/missing.txt')).rejects.toThrow(/no in-memory file/);
  });
});
