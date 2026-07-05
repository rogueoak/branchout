import { createHash } from 'node:crypto';
import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs';

/**
 * Password hashing behind one swappable interface. The rest of the service never calls a
 * hashing library directly, so the algorithm can change without touching business logic.
 */
export interface PasswordHasher {
  /** Hash a plaintext password. The returned string carries its own algorithm + parameters. */
  hash(plain: string): Promise<string>;
  /** Verify a plaintext password against a stored hash. Never throws on a bad hash. */
  verify(storedHash: string, plain: string): Promise<boolean>;
}

/** bcrypt cost. 12 is a sane default: slow enough to matter, fast enough for a login. */
const BCRYPT_ROUNDS = 12;

interface Argon2Module {
  hash(plain: string): Promise<string>;
  verify(storedHash: string, plain: string): Promise<boolean>;
}

/**
 * Try to load argon2id (native, prebuilt). If it cannot load, return null so the caller
 * falls back to bcrypt. Kept async so a load failure never blocks the event loop on boot.
 */
async function tryLoadArgon2(): Promise<Argon2Module | null> {
  try {
    const argon2 = await import('@node-rs/argon2');
    return {
      hash: (plain) => argon2.hash(plain),
      verify: (storedHash, plain) => argon2.verify(storedHash, plain),
    };
  } catch (error) {
    // Make a missing native module visible in boot logs - otherwise the service silently runs
    // the weaker bcrypt fallback and no one notices.
    console.warn('[control-plane] argon2 unavailable, falling back to bcrypt', error);
    return null;
  }
}

/**
 * bcrypt ignores input past 72 bytes, but a passphrase may be longer (PASSWORD_MAX is 200).
 * Pre-hashing to a fixed-length SHA-256 digest lets the whole password contribute before bcrypt
 * sees it. All bcrypt hashes this module writes are over the pre-hash, and verify applies the
 * same transform, so the two stay consistent.
 */
function bcryptPrehash(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('base64');
}

const bcrypt = {
  hash: (plain: string) => bcryptHash(bcryptPrehash(plain), BCRYPT_ROUNDS),
  verify: async (storedHash: string, plain: string) => {
    try {
      return await bcryptCompare(bcryptPrehash(plain), storedHash);
    } catch {
      return false;
    }
  },
};

/**
 * Build the app's password hasher. Prefers argon2id; degrades to bcrypt if the native
 * module is unavailable. `verify` dispatches on the stored hash's prefix, so a hash written
 * by either algorithm still verifies after a swap - existing logins keep working.
 */
export async function createHasher(): Promise<PasswordHasher> {
  const argon2 = await tryLoadArgon2();
  const preferred = argon2 ?? bcrypt;

  return {
    hash: (plain) => preferred.hash(plain),
    verify: (storedHash, plain) => {
      // bcrypt hashes start with `$2`; argon2 hashes start with `$argon2`.
      if (storedHash.startsWith('$2')) {
        return bcrypt.verify(storedHash, plain);
      }
      if (argon2) {
        return argon2.verify(storedHash, plain).catch(() => false);
      }
      // No argon2 available but the hash is argon2: cannot verify.
      return Promise.resolve(false);
    },
  };
}
