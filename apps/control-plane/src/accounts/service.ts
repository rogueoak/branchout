import { randomBytes } from 'node:crypto';
import { defaultAvatarFor, isAvatarId } from '@branchout/brand/avatar-ids';
import { validateDisplayName } from '../validation/display-name';
import { validateEmail } from './email';
import { normalizeGamerTag, validateGamerTag } from './gamertag';
import type { PasswordHasher } from './hasher';
import {
  type Account,
  type AccountRepository,
  DuplicateAccountError,
  PROFILE_VISIBILITIES,
  type ProfileVisibility,
} from './repository';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** The identity fields safe to hand back to a caller. Never carries the password hash or email. */
export interface PublicAccount {
  id: string;
  gamerTag: string;
  nickname: string;
  avatar: string;
  visibility: ProfileVisibility;
  /** Beta-tester entitlement (spec 0035): the web gates the insider surface on this. */
  insider: boolean;
  /** When the account was soft-deleted (spec 0040); null while live. Only ever non-null on the
   * admin read path - player/auth reads never load a deleted account (it is null-by-construction on
   * `/auth/me`, since `getById` filters deleted rows, not null-by-type). If a later change adds a
   * second admin-only field (or an undelete flow), split an `AdminAccount` DTO from `PublicAccount`
   * here rather than widening this shared shape. */
  deletedAt: Date | null;
}

/**
 * Contact details for reaching a player out-of-band. Unlike `PublicAccount`, this DELIBERATELY
 * carries the email - it is the one shape that does - so it is used only server-side (the host
 * feedback email, spec 0048) and never returned to a browser. Named (not an inline literal) so the
 * "intentionally exposes email" exception is explicit and greppable.
 */
export interface AccountContact {
  gamerTag: string;
  email: string;
}

/** A validation failure with a stable code and a user-safe message. */
export class ValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Raised on a taken email or gamer tag. Field names the collision for the caller. */
export class ConflictError extends Error {
  constructor(public field: 'email' | 'gamerTag') {
    super(`${field} is already taken`);
    this.name = 'ConflictError';
  }
}

export interface SignupInput {
  email: string;
  password: string;
  gamerTag: string;
}

export interface LoginInput {
  /** Email OR gamer tag (spec 0072). Resolved by shape: contains `@` -> email, else gamer tag. */
  identifier: string;
  password: string;
}

/**
 * A login identifier resolved to its lockout bucket, plus a password check (spec 0072). The route
 * needs the lock key BEFORE it verifies the password (to honour a lock even for a correct password,
 * spec 0036), so resolution and verification are split: `beginLogin` resolves, `verify` checks.
 */
export interface LoginAttempt {
  /**
   * The stable lockout key for this attempt: the resolved account id when the identifier matches an
   * account (so an email attempt and a username attempt on the SAME account share one bucket - an
   * attacker cannot dodge or double the lockout by switching identifier form), else a normalized form
   * of the raw identifier (an unresolved identifier still gets its own bounded bucket). Server-side
   * only - never echoed to the client, so it is no enumeration oracle.
   */
  lockKey: string;
  /**
   * Verify the password against the resolved account. Returns the public account on success, null on
   * any failure - and never reveals whether the identifier matched: a miss still runs a hash verify
   * against a throwaway hash, so latency does not enumerate accounts.
   */
  verify(password: string): Promise<PublicAccount | null>;
}

function toPublic(account: Account): PublicAccount {
  return {
    id: account.id,
    gamerTag: account.gamerTag,
    nickname: account.nickname,
    avatar: account.avatar,
    visibility: account.visibility,
    insider: account.insider,
    deletedAt: account.deletedAt,
  };
}

/**
 * Account business logic: sign up, log in, change nickname. Validation and hashing live here
 * so routes stay thin and the same rules apply on every path. The hasher is injected, so the
 * algorithm is swappable; the repository is injected, so tests run without a live database.
 */
export class AccountService {
  constructor(
    private readonly repo: AccountRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async signup(input: SignupInput): Promise<PublicAccount> {
    const email = validateEmail(input.email);
    if (!email.ok) {
      throw new ValidationError('email', email.error!);
    }

    if (typeof input.password !== 'string' || input.password.length < PASSWORD_MIN) {
      throw new ValidationError(
        'password',
        `Password must be at least ${PASSWORD_MIN} characters.`,
      );
    }
    if (input.password.length > PASSWORD_MAX) {
      throw new ValidationError('password', `Password must be at most ${PASSWORD_MAX} characters.`);
    }

    const tag = validateGamerTag(input.gamerTag);
    if (!tag.ok) {
      throw new ValidationError('gamerTag', tag.error!);
    }

    // Pre-check for a friendlier error, but the unique index is the real guard against a race.
    if (await this.repo.findByEmail(email.normalized!)) {
      throw new ConflictError('email');
    }
    if (await this.repo.findByGamerTagNormalized(tag.normalized!)) {
      throw new ConflictError('gamerTag');
    }

    const passwordHash = await this.hasher.hash(input.password);
    // The gamer tag is stored as entered (shape-validated); the normalized form drives
    // uniqueness. The nickname defaults to the gamer tag and is editable later.
    const displayTag = input.gamerTag.trim();

    try {
      const account = await this.repo.create({
        email: email.normalized!,
        passwordHash,
        gamerTag: displayTag,
        gamerTagNormalized: tag.normalized!,
        nickname: displayTag,
        // A deterministic default avatar from the tag, so a new account always has one (spec 0027).
        avatar: defaultAvatarFor(displayTag),
      });
      return toPublic(account);
    } catch (error) {
      if (error instanceof DuplicateAccountError) {
        throw new ConflictError(error.field);
      }
      throw error;
    }
  }

  /**
   * Resolve a login identifier (email OR gamer tag, spec 0072) to a lockout bucket and a password
   * check. An identifier containing `@` is looked up as an email; otherwise as a gamer tag - the two
   * charsets are disjoint (a gamer tag is `[a-z0-9_-]`, an email must contain `@`), so the branch is
   * unambiguous. The lookup runs the same way whether or not it matches, and the returned `verify`
   * runs a hash comparison even on a miss, so neither resolution nor verification reveals whether the
   * identifier exists.
   */
  async beginLogin(rawIdentifier: string): Promise<LoginAttempt> {
    const identifier = typeof rawIdentifier === 'string' ? rawIdentifier : '';
    const account = await this.resolveByIdentifier(identifier);
    // Anchor the lock on the account when we can (email + username hit one bucket); otherwise on the
    // normalized raw identifier so an unresolved identifier is still bounded. Both email and gamer
    // tag normalize by trim+lowercase, so this collapses the two forms of the same miss too.
    const lockKey = account
      ? `account:${account.id}`
      : `identifier:${identifier.trim().toLowerCase()}`;
    return {
      lockKey,
      verify: async (rawPassword: string): Promise<PublicAccount | null> => {
        const password = typeof rawPassword === 'string' ? rawPassword : '';
        const hash = account?.passwordHash ?? (await this.getDummyHash());
        const ok = await this.hasher.verify(hash, password);
        // A soft-deleted account cannot log in (spec 0040). In practice its email + gamer tag are
        // tombstoned so resolution never returns it, but guard here too - and after the verify runs,
        // so the deleted path costs the same as a live one (no timing signal). deletedAt is checked
        // last so it does not short-circuit the hash verify.
        return account && ok && !account.deletedAt ? toPublic(account) : null;
      },
    };
  }

  /**
   * Verify credentials. Returns the account on success, null on any failure. The caller must not
   * reveal which field was wrong - an unknown identifier and a bad password both return null. An
   * unknown identifier still runs a verify against a throwaway hash so login latency does not betray
   * whether an account exists (timing-based user enumeration). The route uses `beginLogin` directly so
   * it can key the lockout on the resolved account between resolution and verification; this is the
   * one-shot convenience for callers that do not need the lock key.
   */
  async login(input: LoginInput): Promise<PublicAccount | null> {
    const attempt = await this.beginLogin(input.identifier);
    return attempt.verify(input.password);
  }

  /** Resolve an identifier to its account by email (contains `@`) or gamer tag, or null. */
  private async resolveByIdentifier(identifier: string): Promise<Account | null> {
    if (identifier.includes('@')) {
      const email = validateEmail(identifier);
      return email.ok ? this.repo.findByEmail(email.normalized!) : null;
    }
    const tag = validateGamerTag(identifier);
    return tag.ok ? this.repo.findByGamerTagNormalized(tag.normalized!) : null;
  }

  /**
   * A cached hash of a random string, used to keep the no-such-email path as costly as a real
   * verify. Computed once, lazily, so the fixed cost is paid on first miss, not per request.
   */
  private dummyHash: Promise<string> | null = null;
  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = this.hasher.hash(randomBytes(32).toString('hex'));
    }
    return this.dummyHash;
  }

  async getById(id: string): Promise<PublicAccount | null> {
    // findById excludes soft-deleted rows by default, so a deleted account reads as gone here - the
    // /auth/me self-revoke then logs the stale session out (spec 0040).
    const account = await this.repo.findById(id);
    return account ? toPublic(account) : null;
  }

  /**
   * Contact details for reaching a player out-of-band - the host in-game feedback email (spec 0048):
   * the canonical gamer tag + email. Unlike `getById`/`PublicAccount`, this intentionally exposes the
   * email, so it is used ONLY server-side to build the internal feedback notification and is never
   * returned to a browser. Null when the account is unknown or soft-deleted (findById filters deleted).
   */
  async contactById(id: string): Promise<AccountContact | null> {
    const account = await this.repo.findById(id);
    return account ? { gamerTag: account.gamerTag, email: account.email } : null;
  }

  /** Like getById, but includes soft-deleted accounts - for the admin console, which must still show
   * a deleted player (spec 0040). */
  async getByIdForAdmin(id: string): Promise<PublicAccount | null> {
    const account = await this.repo.findById(id, { includeDeleted: true });
    return account ? toPublic(account) : null;
  }

  /** Soft-delete the caller's own account (spec 0040): keep the row (flagged deleted, visible to
   * admins) but free the email + gamer tag for reuse. Returns null if the account is already gone. */
  async softDeleteSelf(id: string): Promise<PublicAccount | null> {
    const account = await this.repo.softDelete(id);
    return account ? toPublic(account) : null;
  }

  /** Hard-delete an account (spec 0040, admin only): purge the row. Returns true if a row was
   * removed. account_game_plays cascades; the credit ledger is kept by design. */
  async hardDelete(id: string): Promise<boolean> {
    return this.repo.hardDelete(id);
  }

  /** Look up an account by its (public, unique) gamer tag - the key the public profile page uses. */
  async getByGamerTag(rawTag: string): Promise<PublicAccount | null> {
    const account = await this.repo.findByGamerTagNormalized(normalizeGamerTag(rawTag));
    return account ? toPublic(account) : null;
  }

  async changeNickname(id: string, rawNickname: string): Promise<PublicAccount> {
    const nickname = validateDisplayName(rawNickname);
    if (!nickname.ok) {
      throw new ValidationError('nickname', nickname.error!);
    }
    const account = await this.repo.updateNickname(id, nickname.value!);
    if (!account) {
      throw new ValidationError('account', 'Account not found.');
    }
    return toPublic(account);
  }

  /** Set the account's avatar. The id is validated against the bounded set (never free text). */
  async changeAvatar(id: string, avatar: unknown): Promise<PublicAccount> {
    if (!isAvatarId(avatar)) {
      throw new ValidationError('avatar', 'Pick an avatar from the set.');
    }
    const account = await this.repo.updateAvatar(id, avatar);
    if (!account) {
      throw new ValidationError('account', 'Account not found.');
    }
    return toPublic(account);
  }

  /** Set the account's profile visibility. Validated against the enum. */
  async changeVisibility(id: string, visibility: unknown): Promise<PublicAccount> {
    if (
      typeof visibility !== 'string' ||
      !(PROFILE_VISIBILITIES as readonly string[]).includes(visibility)
    ) {
      throw new ValidationError('visibility', 'Choose a valid visibility.');
    }
    const account = await this.repo.updateVisibility(id, visibility as ProfileVisibility);
    if (!account) {
      throw new ValidationError('account', 'Account not found.');
    }
    return toPublic(account);
  }

  /** Grant or revoke the insider role (spec 0037 admin toggle). */
  async changeInsider(id: string, insider: unknown): Promise<PublicAccount> {
    if (typeof insider !== 'boolean') {
      throw new ValidationError('insider', 'insider must be a boolean.');
    }
    const account = await this.repo.updateInsider(id, insider);
    if (!account) {
      throw new ValidationError('account', 'Account not found.');
    }
    return toPublic(account);
  }

  /** A page of players for the admin console, optionally filtered by gamer tag (spec 0037). */
  async listPlayers(opts: {
    query?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: PublicAccount[]; total: number }> {
    const page = await this.repo.listAccounts(opts);
    return { items: page.items.map(toPublic), total: page.total };
  }
}
