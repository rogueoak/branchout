import {
  type Account,
  type AccountPage,
  type AccountRepository,
  DuplicateAccountError,
  type ListAccountsOptions,
  type NewAccount,
  type ProfileVisibility,
} from './repository';

/**
 * In-memory account store for tests. Mirrors the Postgres repository's uniqueness rules
 * (email and normalized gamer tag) so service logic can be exercised without a live database.
 */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly byId = new Map<string, Account>();
  private counter = 0;

  async create(account: NewAccount): Promise<Account> {
    for (const existing of this.byId.values()) {
      if (existing.email === account.email) {
        throw new DuplicateAccountError('email');
      }
      if (existing.gamerTagNormalized === account.gamerTagNormalized) {
        throw new DuplicateAccountError('gamerTag');
      }
    }
    const now = new Date();
    const stored: Account = {
      id: `acct_${++this.counter}`,
      email: account.email,
      passwordHash: account.passwordHash,
      gamerTag: account.gamerTag,
      gamerTagNormalized: account.gamerTagNormalized,
      nickname: account.nickname,
      avatar: account.avatar,
      visibility: 'public',
      insider: false,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(stored.id, stored);
    return { ...stored };
  }

  async findByEmail(normalizedEmail: string): Promise<Account | null> {
    for (const account of this.byId.values()) {
      if (account.email === normalizedEmail) {
        return { ...account };
      }
    }
    return null;
  }

  async findById(id: string): Promise<Account | null> {
    const account = this.byId.get(id);
    return account ? { ...account } : null;
  }

  async findByGamerTagNormalized(normalized: string): Promise<Account | null> {
    for (const account of this.byId.values()) {
      if (account.gamerTagNormalized === normalized) {
        return { ...account };
      }
    }
    return null;
  }

  async updateNickname(id: string, nickname: string): Promise<Account | null> {
    const account = this.byId.get(id);
    if (!account) {
      return null;
    }
    account.nickname = nickname;
    account.updatedAt = new Date();
    return { ...account };
  }

  async updateAvatar(id: string, avatar: string): Promise<Account | null> {
    const account = this.byId.get(id);
    if (!account) {
      return null;
    }
    account.avatar = avatar;
    account.updatedAt = new Date();
    return { ...account };
  }

  async updateVisibility(id: string, visibility: ProfileVisibility): Promise<Account | null> {
    const account = this.byId.get(id);
    if (!account) {
      return null;
    }
    account.visibility = visibility;
    account.updatedAt = new Date();
    return { ...account };
  }

  async updateInsider(id: string, insider: boolean): Promise<Account | null> {
    const account = this.byId.get(id);
    if (!account) {
      return null;
    }
    account.insider = insider;
    account.updatedAt = new Date();
    return { ...account };
  }

  async listAccounts(opts: ListAccountsOptions): Promise<AccountPage> {
    const query = (opts.query ?? '').trim().toLowerCase();
    const all = [...this.byId.values()]
      .filter((a) => (query ? a.gamerTagNormalized.includes(query) : true))
      .sort((a, b) => a.gamerTagNormalized.localeCompare(b.gamerTagNormalized));
    return {
      items: all.slice(opts.offset, opts.offset + opts.limit).map((a) => ({ ...a })),
      total: all.length,
    };
  }

  /** Test-only helper: drop an account, to simulate a session whose row is gone. */
  deleteById(id: string): void {
    this.byId.delete(id);
  }

  /** Test-only helper: set the insider flag, standing in for the out-of-band grant (spec 0035). */
  setInsider(id: string, insider: boolean): void {
    const account = this.byId.get(id);
    if (account) {
      account.insider = insider;
    }
  }
}
