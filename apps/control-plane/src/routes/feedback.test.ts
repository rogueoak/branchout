import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { Session } from '../sessions/session';
import { type FeedbackAccountLookup, resolveSubmitter } from './feedback';

/** A minimal request stub carrying only the `log` the resolver touches. */
const stubRequest = () => ({ log: { warn: vi.fn() } }) as unknown as Pick<FastifyRequest, 'log'>;

const accountSession: Session = {
  id: 'sess-1',
  kind: 'account',
  accountId: 'acc-1',
  displayName: 'SessionName',
  createdAt: 0,
};

const anonSession: Session = {
  id: 'sess-2',
  kind: 'anonymous',
  displayName: 'GuestFox',
  createdAt: 0,
};

describe('resolveSubmitter', () => {
  it('uses the account contact (canonical gamer tag + email) when signed in', async () => {
    const accounts: FeedbackAccountLookup = {
      contactById: async () => ({ gamerTag: 'CoolCat', email: 'player@example.com' }),
    };
    const submitter = await resolveSubmitter(accountSession, accounts, stubRequest());
    expect(submitter).toEqual({ gamerTag: 'CoolCat', email: 'player@example.com' });
  });

  it('falls back to the session display name (no email) when the account is not found', async () => {
    const accounts: FeedbackAccountLookup = { contactById: async () => null };
    const submitter = await resolveSubmitter(accountSession, accounts, stubRequest());
    expect(submitter).toEqual({ gamerTag: 'SessionName' });
  });

  it('degrades to the display name and logs a warning when the lookup throws', async () => {
    const accounts: FeedbackAccountLookup = {
      contactById: async () => {
        throw new Error('db down');
      },
    };
    const request = stubRequest();
    const submitter = await resolveSubmitter(accountSession, accounts, request);
    expect(submitter).toEqual({ gamerTag: 'SessionName' });
    expect(request.log.warn).toHaveBeenCalledOnce();
  });

  it('names an anonymous session by its display name without calling the lookup', async () => {
    const contactById = vi.fn();
    const submitter = await resolveSubmitter(anonSession, { contactById }, stubRequest());
    expect(submitter).toEqual({ gamerTag: 'GuestFox' });
    expect(contactById).not.toHaveBeenCalled();
  });

  it('names the submitter by display name when no account lookup is wired', async () => {
    const submitter = await resolveSubmitter(accountSession, undefined, stubRequest());
    expect(submitter).toEqual({ gamerTag: 'SessionName' });
  });
});
