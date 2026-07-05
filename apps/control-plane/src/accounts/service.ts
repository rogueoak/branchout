import { validateEmail } from './email';
import { normalizeGamerTag, validateGamerTag } from './gamertag';
import type { PasswordHasher } from './hasher';
import { validateNickname } from './nickname';
import { type Account, type AccountRepository, DuplicateAccountError } from './repository';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** The identity fields safe to hand back to a caller. Never carries the password hash. */
export interface PublicAccount {
  id: string;
  gamerTag: string;
  nickname: string;
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
  email: string;
  password: string;
}

function toPublic(account: Account): PublicAccount {
  return { id: account.id, gamerTag: account.gamerTag, nickname: account.nickname };
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

    if (
      typeof input.password !== 'string' ||
      input.password.length < PASSWORD_MIN ||
      input.password.length > PASSWORD_MAX
    ) {
      throw new ValidationError(
        'password',
        `Password must be at least ${PASSWORD_MIN} characters.`,
      );
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
   * Verify credentials. Returns the account on success, null on any failure. The caller must
   * not reveal which field was wrong - an unknown email and a bad password both return null.
   */
  async login(input: LoginInput): Promise<PublicAccount | null> {
    const email = validateEmail(input.email);
    if (!email.ok || typeof input.password !== 'string') {
      return null;
    }
    const account = await this.repo.findByEmail(email.normalized!);
    if (!account) {
      return null;
    }
    const ok = await this.hasher.verify(account.passwordHash, input.password);
    return ok ? toPublic(account) : null;
  }

  async getById(id: string): Promise<PublicAccount | null> {
    const account = await this.repo.findById(id);
    return account ? toPublic(account) : null;
  }

  async changeNickname(id: string, rawNickname: string): Promise<PublicAccount> {
    const nickname = validateNickname(rawNickname);
    if (!nickname.ok) {
      throw new ValidationError('nickname', nickname.error!);
    }
    const account = await this.repo.updateNickname(id, nickname.value!);
    if (!account) {
      throw new ValidationError('account', 'Account not found.');
    }
    return toPublic(account);
  }
}

/** Map the gamer tag a user typed to the value uniqueness is checked against. Exposed for
 * callers that need the normalized handle (e.g. lookups) without re-importing the validator. */
export function gamerTagKey(raw: string): string {
  return normalizeGamerTag(raw);
}
