import { beforeEach, describe, expect, it } from 'vitest';
import type { PasswordHasher } from './hasher';
import { type Account, type AccountRepository, DuplicateAccountError } from './repository';
import { InMemoryAccountRepository } from './repository.memory';
import { AccountService, ConflictError, PASSWORD_MAX, ValidationError } from './service';

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

  it('defaults a new account to non-insider, and getById reflects a later grant (spec 0035)', async () => {
    const account = await service.signup({
      email: 'beta@example.com',
      password: 'supersecret',
      gamerTag: 'Tester',
    });
    // Fresh accounts are not insider; the flag is part of the public identity.
    expect(account.insider).toBe(false);

    // Granting out-of-band (the spec 0035 stand-in) shows through the public account.
    repo.setInsider(account.id, true);
    const granted = await service.getById(account.id);
    expect(granted?.insider).toBe(true);
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

  it('rejects a password over the max length', async () => {
    const err = await service
      .signup({ email: 'a@example.com', password: 'x'.repeat(PASSWORD_MAX + 1), gamerTag: 'One' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).message).toMatch(/at most/);
  });

  it('maps a create-time DuplicateAccountError to ConflictError (the unique-index race guard)', async () => {
    // A repo whose pre-checks pass but whose create() throws, as a concurrent insert would.
    const racingRepo: AccountRepository = {
      findByEmail: async () => null,
      findByGamerTagNormalized: async () => null,
      findById: async () => null,
      updateNickname: async () => null,
      updateAvatar: async () => null,
      updateVisibility: async () => null,
      updateInsider: async () => null,
      softDelete: async () => null,
      hardDelete: async () => false,
      listAccounts: async () => ({ items: [], total: 0 }),
      create: async (): Promise<Account> => {
        throw new DuplicateAccountError('gamerTag');
      },
    };
    const racing = new AccountService(racingRepo, fakeHasher);
    const err = await racing
      .signup({ email: 'a@example.com', password: 'supersecret', gamerTag: 'CoolCat' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).field).toBe('gamerTag');
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

describe('AccountService profile fields (spec 0027)', () => {
  let service: AccountService;
  let accountId: string;

  beforeEach(async () => {
    service = new AccountService(new InMemoryAccountRepository(), fakeHasher);
    const account = await service.signup({
      email: 'player@example.com',
      password: 'supersecret',
      gamerTag: 'CoolCat',
    });
    accountId = account.id;
  });

  it('seeds a deterministic default avatar on signup and reports it publicly', async () => {
    const again = new AccountService(new InMemoryAccountRepository(), fakeHasher);
    const a = await again.signup({
      email: 'a@x.com',
      password: 'supersecret',
      gamerTag: 'CoolCat',
    });
    const b = await new AccountService(new InMemoryAccountRepository(), fakeHasher).signup({
      email: 'b@x.com',
      password: 'supersecret',
      gamerTag: 'CoolCat',
    });
    expect(a.avatar).toBeTruthy();
    // Same tag -> same deterministic default avatar.
    expect(a.avatar).toBe(b.avatar);
    expect(a.visibility).toBe('public');
  });

  it('changes the avatar to a known id and rejects an unknown one', async () => {
    const updated = await service.changeAvatar(accountId, 'frog');
    expect(updated.avatar).toBe('frog');
    await expect(service.changeAvatar(accountId, 'not-a-real-avatar')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('changes visibility to a valid value and rejects an invalid one', async () => {
    const updated = await service.changeVisibility(accountId, 'private');
    expect(updated.visibility).toBe('private');
    await expect(service.changeVisibility(accountId, 'everyone')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('AccountService deletion (spec 0040)', () => {
  let repo: InMemoryAccountRepository;
  let service: AccountService;
  let accountId: string;

  beforeEach(async () => {
    repo = new InMemoryAccountRepository();
    service = new AccountService(repo, fakeHasher);
    const account = await service.signup({
      email: 'player@example.com',
      password: 'supersecret',
      gamerTag: 'Cat',
    });
    accountId = account.id;
  });

  it('soft-delete stamps deletedAt and frees the email + gamer tag for reuse', async () => {
    const deleted = await service.softDeleteSelf(accountId);
    expect(deleted?.deletedAt).toBeInstanceOf(Date);

    // The unique identity columns are tombstoned, so the same email + tag register a fresh account.
    const fresh = await service.signup({
      email: 'player@example.com',
      password: 'supersecret',
      gamerTag: 'Cat',
    });
    expect(fresh.id).not.toBe(accountId);
  });

  it('a soft-deleted account cannot log in', async () => {
    await service.softDeleteSelf(accountId);
    expect(
      await service.login({ email: 'player@example.com', password: 'supersecret' }),
    ).toBeNull();
  });

  it('getById hides a soft-deleted account, getByIdForAdmin still returns it (flagged)', async () => {
    await service.softDeleteSelf(accountId);
    expect(await service.getById(accountId)).toBeNull();
    const forAdmin = await service.getByIdForAdmin(accountId);
    expect(forAdmin?.id).toBe(accountId);
    expect(forAdmin?.deletedAt).toBeInstanceOf(Date);
    // The display gamer tag survives the tombstone so the console can still name the row.
    expect(forAdmin?.gamerTag).toBe('Cat');
  });

  it('listPlayers includes a soft-deleted account with its deletedAt so the console can flag it', async () => {
    await service.softDeleteSelf(accountId);
    const { items } = await service.listPlayers({ limit: 20, offset: 0 });
    const row = items.find((i) => i.id === accountId);
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it('hard-delete removes the row entirely', async () => {
    expect(await service.hardDelete(accountId)).toBe(true);
    expect(await service.getByIdForAdmin(accountId)).toBeNull();
    // A second hard delete is a no-op (nothing to remove).
    expect(await service.hardDelete(accountId)).toBe(false);
  });
});
