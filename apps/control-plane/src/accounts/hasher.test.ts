import { hash as bcryptHash } from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { createHasher } from './hasher';

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
    const bcryptStored = await bcryptHash('legacy secret', 10);
    expect(await hasher.verify(bcryptStored, 'legacy secret')).toBe(true);
    expect(await hasher.verify(bcryptStored, 'nope')).toBe(false);
  });

  it('returns false on a malformed hash instead of throwing', async () => {
    const hasher = await createHasher();
    expect(await hasher.verify('not-a-real-hash', 'whatever')).toBe(false);
  });
});
