import { describe, expect, it, vi } from 'vitest';
import type { PasswordHasher } from '../accounts/hasher';
import { ValidationError } from '../accounts/service';
import { InMemoryAdminRepository } from './repository.memory';
import { AdminEmailTakenError, AdminService } from './service';

// A fast deterministic hasher (the real argon2/bcrypt is proven in hasher.test.ts).
const fakeHasher: PasswordHasher = {
  hash: async (plain) => `hashed:${plain}`,
  verify: async (stored, plain) => stored === `hashed:${plain}`,
};

const ROOT_PW = 'root-admin-strong-pw'; // >= ADMIN_PASSWORD_MIN (12)

function make(hasher: PasswordHasher = fakeHasher) {
  const repo = new InMemoryAdminRepository();
  return { repo, service: new AdminService(repo, hasher) };
}

async function seededRoot(service: AdminService) {
  await service.ensureRootAdmin('root@x.test', ROOT_PW);
  const root = await service.login('root@x.test', ROOT_PW);
  if (!root) throw new Error('root bootstrap failed');
  return root;
}

describe('AdminService (spec 0037)', () => {
  describe('login', () => {
    it('returns the admin on correct credentials', async () => {
      const { service } = make();
      await service.ensureRootAdmin('root@x.test', ROOT_PW);
      const admin = await service.login('root@x.test', ROOT_PW);
      expect(admin?.email).toBe('root@x.test');
    });

    it('returns null on a wrong password', async () => {
      const { service } = make();
      await service.ensureRootAdmin('root@x.test', ROOT_PW);
      expect(await service.login('root@x.test', 'the-wrong-password')).toBeNull();
    });

    it('returns null for an unknown email but still runs a verify (timing-safe)', async () => {
      const verify = vi.fn(fakeHasher.verify);
      const { service } = make({ hash: fakeHasher.hash, verify });
      expect(await service.login('nobody@x.test', ROOT_PW)).toBeNull();
      // A verify ran against a dummy hash even though no admin matched - no early return that would
      // betray a non-existent admin by latency.
      expect(verify).toHaveBeenCalledTimes(1);
    });
  });

  describe('createAdmin', () => {
    it('creates an admin attributed to the creator', async () => {
      const { service } = make();
      const root = await seededRoot(service);
      const created = await service.createAdmin(root.id, 'ops@x.test', 'ops-strong-pw-12');
      expect(created.email).toBe('ops@x.test');
      expect(created.createdBy).toBe(root.id);
    });

    it('rejects a short password', async () => {
      const { service } = make();
      await expect(service.createAdmin('someid', 'ops@x.test', 'short')).rejects.toThrow(
        ValidationError,
      );
    });

    it('rejects an invalid email', async () => {
      const { service } = make();
      await expect(
        service.createAdmin('someid', 'not-an-email', 'ops-strong-pw-12'),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects a duplicate email (case-insensitive)', async () => {
      const { service } = make();
      const root = await seededRoot(service);
      await service.createAdmin(root.id, 'ops@x.test', 'ops-strong-pw-12');
      await expect(service.createAdmin(root.id, 'OPS@x.test', 'ops-strong-pw-12')).rejects.toThrow(
        AdminEmailTakenError,
      );
    });
  });

  describe('ensureRootAdmin', () => {
    it('is a no-op when email or password is unset', async () => {
      const { service, repo } = make();
      await service.ensureRootAdmin(undefined, undefined);
      await service.ensureRootAdmin('root@x.test', undefined);
      await service.ensureRootAdmin(undefined, ROOT_PW);
      expect(await repo.list()).toHaveLength(0);
    });

    it('creates the root admin when absent, with no createdBy', async () => {
      const { service } = make();
      await service.ensureRootAdmin('root@x.test', ROOT_PW);
      const admin = await service.login('root@x.test', ROOT_PW);
      expect(admin?.createdBy).toBeNull();
    });

    it('upserts the password on reconcile (break-glass): the new one logs in, the old is rejected', async () => {
      const { service, repo } = make();
      await service.ensureRootAdmin('root@x.test', ROOT_PW);
      const rotated = 'rotated-root-pw-99';
      await service.ensureRootAdmin('root@x.test', rotated);
      expect(await repo.list()).toHaveLength(1); // reconcile, not a second row
      expect(await service.login('root@x.test', rotated)).not.toBeNull();
      expect(await service.login('root@x.test', ROOT_PW)).toBeNull();
    });

    it('refreshes the display email on reconcile (same normalized email, changed casing)', async () => {
      const { service } = make();
      await service.ensureRootAdmin('root@x.test', ROOT_PW);
      await service.ensureRootAdmin('Root@X.test', ROOT_PW);
      const list = await service.listAdmins();
      expect(list).toHaveLength(1);
      expect(list[0]!.email).toBe('Root@X.test');
    });

    it('throws on an invalid ADMIN_ROOT_EMAIL', async () => {
      const { service } = make();
      await expect(service.ensureRootAdmin('bad-email', ROOT_PW)).rejects.toThrow(ValidationError);
    });
  });
});
