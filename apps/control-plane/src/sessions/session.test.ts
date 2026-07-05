import { describe, expect, it } from 'vitest';
import { canHost, type Session } from './session';

const account: Session = {
  id: 'a',
  kind: 'account',
  accountId: 'acct_1',
  displayName: 'Cat',
  createdAt: 0,
};

const anonymous: Session = {
  id: 'b',
  kind: 'anonymous',
  displayName: 'Guest',
  roomCode: 'ABCD',
  createdAt: 0,
};

describe('canHost', () => {
  it('lets an account session host', () => {
    expect(canHost(account)).toBe(true);
  });

  it('blocks an anonymous session from hosting', () => {
    expect(canHost(anonymous)).toBe(false);
  });
});
