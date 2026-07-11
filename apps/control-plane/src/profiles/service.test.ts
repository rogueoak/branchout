import { describe, expect, it } from 'vitest';
import type { PasswordHasher } from '../accounts/hasher';
import { InMemoryAccountRepository } from '../accounts/repository.memory';
import type { ProfileVisibility } from '../accounts/repository';
import { AccountService } from '../accounts/service';
import { InMemoryPlaysRepository } from './plays.memory';
import { ProfileService } from './service';

const hasher: PasswordHasher = {
  hash: async (plain) => `hashed:${plain}`,
  verify: async (stored, plain) => stored === `hashed:${plain}`,
};

async function setup(visibility: ProfileVisibility) {
  const repo = new InMemoryAccountRepository();
  const accounts = new AccountService(repo, hasher);
  const plays = new InMemoryPlaysRepository();
  const account = await accounts.signup({
    email: 'ada@example.com',
    password: 'supersecret',
    gamerTag: 'AdaL',
  });
  if (visibility !== 'public') {
    await accounts.changeVisibility(account.id, visibility);
  }
  await plays.recordPlays([
    { accountId: account.id, gameId: 'g1', game: 'trivia', rank: 1, stars: 3 },
    { accountId: account.id, gameId: 'g2', game: 'trivia', rank: 2, stars: 2 },
  ]);
  return { profiles: new ProfileService(accounts, plays), account };
}

describe('ProfileService visibility projection', () => {
  it('a public profile returns the full projection with stars and recent plays', async () => {
    const { profiles } = await setup('public');
    const profile = await profiles.getPublicProfile('AdaL');
    expect(profile).toMatchObject({
      gamerTag: 'AdaL',
      totalStars: 5,
      visibility: 'public',
      restricted: false,
      nickname: 'AdaL',
    });
    expect(profile!.avatar).toBeTruthy();
    expect(profile!.recentPlays).toHaveLength(2);
  });

  it('a private profile returns only the always-public gamer tag + stars (restricted)', async () => {
    const { profiles } = await setup('private');
    const profile = await profiles.getPublicProfile('AdaL');
    expect(profile).toEqual({
      gamerTag: 'AdaL',
      totalStars: 5,
      visibility: 'private',
      restricted: true,
    });
    expect(profile!.nickname).toBeUndefined();
    expect(profile!.recentPlays).toBeUndefined();
  });

  it('friends-only collapses to restricted until friends ship', async () => {
    const { profiles } = await setup('friends-only');
    const profile = await profiles.getPublicProfile('AdaL');
    expect(profile!.restricted).toBe(true);
    expect(profile!.visibility).toBe('friends-only');
    expect(profile!.avatar).toBeUndefined();
  });

  it('is case-insensitive on the gamer tag and 404s (null) an unknown tag', async () => {
    const { profiles } = await setup('public');
    expect(await profiles.getPublicProfile('adal')).not.toBeNull();
    expect(await profiles.getPublicProfile('ghost')).toBeNull();
  });

  it('NEVER leaks email, account id, or session in any visibility branch', async () => {
    for (const visibility of ['public', 'private', 'friends-only'] as const) {
      const { profiles } = await setup(visibility);
      const profile = await profiles.getPublicProfile('AdaL');
      const serialized = JSON.stringify(profile);
      expect(serialized).not.toContain('ada@example.com');
      expect(serialized).not.toContain('acct_');
      expect(profile).not.toHaveProperty('id');
      expect(profile).not.toHaveProperty('email');
    }
  });
});
