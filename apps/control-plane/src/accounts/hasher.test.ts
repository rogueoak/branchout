import { createHash } from 'node:crypto';
import { hash as bcryptHash } from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { createHasher } from './hasher';

// Mirror the module's bcrypt pre-hash so a hand-built bcrypt hash matches what verify expects.
const bcryptPrehash = (plain: string) =>
  createHash('sha256').update(plain, 'utf8').digest('base64');

describe('password hasher', () => {
  it('hashes a password to something other than the plaintext', async () => {
    const hasher = await createHasher();
    const stored = await hasher.hash('correct horse battery');
    expect(stored).not.toBe('correct horse battery');
    expect(stored).not.toContain('correct horse battery');
  });

  it('verifies a correct password against its own hash', async () => {
    const hasher = await createHasher();
    const stored = await hasher.hash('correct horse battery');
    expect(await hasher.verify(stored, 'correct horse battery')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hasher = await createHasher();
    const stored = await hasher.hash('correct horse battery');
    expect(await hasher.verify(stored, 'wrong password')).toBe(false);
  });

  it('verifies a bcrypt hash too, so a stored bcrypt login still works after a swap', async () => {
    const hasher = await createHasher();
    // A bcrypt hash (prefix $2) built the way the module writes them - over the SHA-256 pre-hash.
    const bcryptStored = await bcryptHash(bcryptPrehash('legacy secret'), 10);
    expect(await hasher.verify(bcryptStored, 'legacy secret')).toBe(true);
    expect(await hasher.verify(bcryptStored, 'nope')).toBe(false);
  });

  it('does not truncate a long passphrase past 72 bytes', async () => {
    const hasher = await createHasher();
    // Two passphrases identical for the first 72 bytes, differing only after.
    const base = 'a'.repeat(72);
    const stored = await hasher.hash(`${base}-one`);
    expect(await hasher.verify(stored, `${base}-one`)).toBe(true);
    expect(await hasher.verify(stored, `${base}-two`)).toBe(false);
  });

  it('returns false on a malformed hash instead of throwing', async () => {
    const hasher = await createHasher();
    expect(await hasher.verify('not-a-real-hash', 'whatever')).toBe(false);
  });
});
