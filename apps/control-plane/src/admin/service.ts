import { randomBytes } from 'node:crypto';
import { validateEmail } from '../accounts/email';
import type { PasswordHasher } from '../accounts/hasher';
import { ValidationError } from '../accounts/service';
import { type AdminAccount, type AdminRepository, DuplicateAdminError } from './repository';

/** Admins should carry a strong password; stricter than the player minimum. */
export const ADMIN_PASSWORD_MIN = 12;
export const ADMIN_PASSWORD_MAX = 200;

/** The admin fields safe to hand back to a caller. Never carries the password hash. */
export interface PublicAdmin {
  id: string;
  email: string;
  createdBy: string | null;
  createdAt: Date;
}

/** Raised when an admin email is already taken. */
export class AdminEmailTakenError extends Error {
  constructor() {
    super('That email is already an admin.');
    this.name = 'AdminEmailTakenError';
  }
}

function toPublic(admin: AdminAccount): PublicAdmin {
  return {
    id: admin.id,
    email: admin.email,
    createdBy: admin.createdBy,
    createdAt: admin.createdAt,
  };
}

function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < ADMIN_PASSWORD_MIN) {
    throw new ValidationError(
      'password',
      `Password must be at least ${ADMIN_PASSWORD_MIN} characters.`,
    );
  }
  if (password.length > ADMIN_PASSWORD_MAX) {
    throw new ValidationError(
      'password',
      `Password must be at most ${ADMIN_PASSWORD_MAX} characters.`,
    );
  }
  return password;
}

/**
 * Admin business logic (spec 0037): a separate identity from player accounts. Login, create-admin
 * (only by an existing admin), and an env-seeded root reconcile. There is deliberately no public
 * signup - the only ways to become an admin are the root seed or an existing admin creating one.
 */
export class AdminService {
  constructor(
    private readonly repo: AdminRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Verify admin credentials. Returns the admin on success, null on any failure. An unknown email
   * still runs a verify against a throwaway hash so login latency does not betray whether an email is
   * a registered admin (timing-based enumeration).
   */
  async login(rawEmail: string, rawPassword: string): Promise<PublicAdmin | null> {
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    const email = validateEmail(rawEmail);
    const admin = email.ok ? await this.repo.findByEmailNormalized(email.normalized!) : null;
    const hash = admin?.passwordHash ?? (await this.getDummyHash());
    const ok = await this.hasher.verify(hash, password);
    return admin && ok ? toPublic(admin) : null;
  }

  /** Create an admin, attributed to the admin who created it. Throws on a taken email / bad input. */
  async createAdmin(
    byAdminId: string,
    rawEmail: string,
    rawPassword: string,
  ): Promise<PublicAdmin> {
    const email = validateEmail(rawEmail);
    if (!email.ok) {
      throw new ValidationError('email', email.error!);
    }
    const password = validatePassword(rawPassword);
    const passwordHash = await this.hasher.hash(password);
    try {
      const admin = await this.repo.create({
        email: rawEmail.trim(),
        emailNormalized: email.normalized!,
        passwordHash,
        createdBy: byAdminId,
      });
      return toPublic(admin);
    } catch (error) {
      if (error instanceof DuplicateAdminError) {
        throw new AdminEmailTakenError();
      }
      throw error;
    }
  }

  /**
   * Reconcile the env-seeded root admin on boot. Env is the source of truth for its password (a
   * break-glass recovery): if the root admin exists, its password is upserted to match; otherwise it
   * is created with no `createdBy`. A blank email/password is a no-op (feature simply off).
   */
  async ensureRootAdmin(
    rawEmail: string | undefined,
    rawPassword: string | undefined,
  ): Promise<void> {
    if (!rawEmail || !rawPassword) return;
    const email = validateEmail(rawEmail);
    if (!email.ok) {
      throw new ValidationError('email', `ADMIN_ROOT_EMAIL is invalid: ${email.error}`);
    }
    validatePassword(rawPassword);
    const passwordHash = await this.hasher.hash(rawPassword);
    const existing = await this.repo.findByEmailNormalized(email.normalized!);
    if (existing) {
      await this.repo.updatePasswordHash(existing.id, passwordHash);
      return;
    }
    await this.repo.create({
      email: rawEmail.trim(),
      emailNormalized: email.normalized!,
      passwordHash,
      createdBy: null,
    });
  }

  async getById(id: string): Promise<PublicAdmin | null> {
    const admin = await this.repo.findById(id);
    return admin ? toPublic(admin) : null;
  }

  async listAdmins(): Promise<PublicAdmin[]> {
    return (await this.repo.list()).map(toPublic);
  }

  private dummyHash: Promise<string> | null = null;
  private getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = this.hasher.hash(randomBytes(32).toString('hex'));
    }
    return this.dummyHash;
  }
}
