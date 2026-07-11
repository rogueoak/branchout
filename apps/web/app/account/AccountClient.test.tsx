import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  setNickname: vi.fn(),
  setAvatar: vi.fn(),
  setVisibility: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../../lib/account-api', () => ({
  ...api,
  // Keep the real error class so `instanceof` checks in the component hold.
  AccountApiError: class AccountApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { AccountClient } from './AccountClient';

const account = {
  id: 'a1',
  gamerTag: 'AdaL',
  nickname: 'Ada',
  avatar: 'sprout',
  visibility: 'public' as const,
};

describe('AccountClient', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates from /me and shows the account, avatar picker, and privacy control', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    render(<AccountClient />);
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeDefined();
    expect(screen.getByLabelText('Who can see your full profile')).toHaveProperty(
      'value',
      'public',
    );
    // The picker offers every avatar.
    expect(screen.getByRole('button', { name: 'Choose the berry avatar' })).toBeDefined();
  });

  it('picks an avatar', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.setAvatar.mockResolvedValue({ ...account, avatar: 'berry' });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose the berry avatar' }));
    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledWith('berry'));
  });

  it('changes visibility through the native select', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.setVisibility.mockResolvedValue({ ...account, visibility: 'private' });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.change(screen.getByLabelText('Who can see your full profile'), {
      target: { value: 'private' },
    });
    await waitFor(() => expect(api.setVisibility).toHaveBeenCalledWith('private'));
  });

  it('logs out and routes home', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.logout.mockResolvedValue(undefined);
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith('/');
  });

  it('sends a non-account visitor to log in', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'unauthenticated' });
    render(<AccountClient />);
    expect(await screen.findByRole('link', { name: 'Log in' })).toBeDefined();
  });
});
