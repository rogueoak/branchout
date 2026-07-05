import { beforeEach, describe, expect, it } from 'vitest';
import type { PasswordHasher } from './hasher';
import { InMemoryAccountRepository } from './repository.memory';
import { AccountService, ConflictError, ValidationError } from './service';

/** A fast, deterministic hasher for service tests - the real argon2/bcrypt hasher is proven in
 * hasher.test.ts. Prefixes the plaintext so a test can assert the stored value is not raw. */
const fakeHasher: PasswordHasher = {
  hash: async (plain) => `hashed:${plain}`,
  verify: async (stored, plain) => stored === `hashed:${plain}`,
};

describe('AccountService.signup', () => {
  let repo: InMemoryAccountRepository;
  let service: AccountService;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    service = new AccountService(repo, fakeHasher);
  });

  it('creates an account with a hashed password and a nickname defaulting to the gamer tag', async () => {
    const account = await service.signup({
      email: 'player@example.com',
      password: 'supersecret',
      gamerTag: 'CoolCat',
    });
    expect(account.gamerTag).toBe('CoolCat');
    expect(account.nickname).toBe('CoolCat');

    const stored = await repo.findById(account.id);
    // The service stored a hash, not the plaintext (real hashing is proven in hasher.test.ts).
    expect(stored?.passwordHash).toBe('hashed:supersecret');
    expect(stored?.gamerTagNormalized).toBe('coolcat');
    expect(stored?.emailVerified).toBe(false);
  });

  it('rejects a duplicate email', async () => {
    await service.signup({ email: 'a@example.com', password: 'supersecret', gamerTag: 'One' });
    await expect(
      service.signup({ email: 'a@example.com', password: 'supersecret', gamerTag: 'Two' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a gamer tag taken case-insensitively', async () => {
    await service.signup({ email: 'a@example.com', password: 'supersecret', gamerTag: 'CoolCat' });
    const err = await service
      .signup({ email: 'b@example.com', password: 'supersecret', gamerTag: 'coolcat' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).field).toBe('gamerTag');
  });

  it('rejects a short password', async () => {
    await expect(
      service.signup({ email: 'a@example.com', password: 'short', gamerTag: 'One' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a malformed email and an invalid gamer tag', async () => {
    await expect(
      service.signup({ email: 'nope', password: 'supersecret', gamerTag: 'One' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.signup({ email: 'a@example.com', password: 'supersecret', gamerTag: 'no spaces' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('AccountService.login', () => {
  let service: AccountService;

  beforeEach(async () => {
    service = new AccountService(new InMemoryAccountRepository(), fakeHasher);
    await service.signup({ email: 'player@example.com', password: 'supersecret', gamerTag: 'Cat' });
  });

  it('returns the account for correct credentials', async () => {
    const account = await service.login({ email: 'Player@Example.com', password: 'supersecret' });
    expect(account?.gamerTag).toBe('Cat');
  });

  it('returns null for a wrong password', async () => {
    expect(await service.login({ email: 'player@example.com', password: 'wrong' })).toBeNull();
  });

  it('returns null for an unknown email (no leak of which field was wrong)', async () => {
    expect(await service.login({ email: 'ghost@example.com', password: 'supersecret' })).toBeNull();
  });
});

describe('AccountService.changeNickname', () => {
  let service: AccountService;
  let accountId: string;

  beforeEach(async () => {
    service = new AccountService(new InMemoryAccountRepository(), fakeHasher);
    const account = await service.signup({
      email: 'player@example.com',
      password: 'supersecret',
      gamerTag: 'Cat',
    });
    accountId = account.id;
  });

  it('updates the nickname to any valid display text (not required unique)', async () => {
    const updated = await service.changeNickname(accountId, 'The Great Gonzo');
    expect(updated.nickname).toBe('The Great Gonzo');
    expect(updated.gamerTag).toBe('Cat');
  });

  it('rejects an invalid nickname', async () => {
    await expect(service.changeNickname(accountId, '   ')).rejects.toBeInstanceOf(ValidationError);
  });
});
