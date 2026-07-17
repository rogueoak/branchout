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
  deleteAccount: vi.fn(),
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
  avatar: 'fox',
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
    expect(screen.getByRole('button', { name: 'Choose the frog avatar' })).toBeDefined();
  });

  it('picks an avatar', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.setAvatar.mockResolvedValue({ ...account, avatar: 'frog' });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose the frog avatar' }));
    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledWith('frog'));
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

  it('confirms after saving visibility (a privacy control needs feedback)', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.setVisibility.mockResolvedValue({ ...account, visibility: 'private' });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.change(screen.getByLabelText('Who can see your full profile'), {
      target: { value: 'private' },
    });
    expect(await screen.findByText('Privacy updated.')).toBeDefined();
  });

  it('confirms after saving an avatar', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.setAvatar.mockResolvedValue({ ...account, avatar: 'frog' });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose the frog avatar' }));
    expect(await screen.findByText('Avatar updated.')).toBeDefined();
  });

  it('shows an error and keeps the confirmed avatar when the save fails', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.setAvatar.mockRejectedValue(new Error('network down'));
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose the frog avatar' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    // Confirm-then-reflect: a failed write leaves the prior avatar selected (nothing to revert).
    expect(
      screen.getByRole('button', { name: 'Choose the fox avatar' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Choose the frog avatar' }).getAttribute('aria-pressed'),
    ).toBe('false');
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

  it('shows no insider entry point for a non-insider account (spec 0039)', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    expect(screen.queryByRole('link', { name: 'Insider game previews' })).toBeNull();
  });

  it('shows an insider the previews button targeting the insider host (spec 0039)', async () => {
    // The real `insiderOrigin` runs (only account-api is mocked); with NEXT_PUBLIC_SITE_URL unset in
    // the test it falls back to window.location.origin, so this exercises that fallback path too.
    api.fetchMe.mockResolvedValue({ kind: 'account', account: { ...account, insider: true } });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    const link = await screen.findByRole('link', { name: 'Insider game previews' });
    const href = link.getAttribute('href') ?? '';
    expect(new URL(href).hostname.startsWith('insider.')).toBe(true);
  });

  it('deletes the account only after a confirm step, then routes home (spec 0040)', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.deleteAccount.mockResolvedValue(undefined);
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });

    // First tap reveals the confirm - it does NOT delete yet.
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(api.deleteAccount).not.toHaveBeenCalled();

    // Confirming deletes and routes home.
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));
    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith('/');
  });

  it('cancels the delete confirm without deleting (spec 0040)', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // Back to the initial state, nothing deleted.
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDefined();
    expect(api.deleteAccount).not.toHaveBeenCalled();
  });

  it('surfaces an error when the delete fails and does not route away (spec 0040)', async () => {
    api.fetchMe.mockResolvedValue({ kind: 'account', account });
    api.deleteAccount.mockRejectedValue(new Error('network down'));
    render(<AccountClient />);
    await screen.findByRole('heading', { name: 'Ada' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(push).not.toHaveBeenCalledWith('/');
  });
});
