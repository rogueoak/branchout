import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignupPage from './page';
import { internalNext } from '../../lib/internal-next';

describe('internalNext (post-signup redirect validation)', () => {
  it('accepts a same-origin absolute path (the game deep link)', () => {
    expect(internalNext('/rooms?game=trivia')).toBe('/rooms?game=trivia');
    expect(internalNext('/account')).toBe('/account');
  });

  it('rejects external, protocol-relative, backslash, and empty targets', () => {
    expect(internalNext(null)).toBeNull();
    expect(internalNext('')).toBeNull();
    expect(internalNext('//evil.com')).toBeNull();
    expect(internalNext('https://evil.com')).toBeNull();
    expect(internalNext('/\\evil.com')).toBeNull();
    expect(internalNext('rooms?game=trivia')).toBeNull();
  });
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'player@example.com' } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'supersecret' } });
  fireEvent.change(screen.getByLabelText(/Gamer tag/), { target: { value: 'CoolCat' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('signup page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the sign-up form and reassures that play needs no account', () => {
    render(<SignupPage />);
    // getByRole/getByLabelText throw on a miss, so the query itself is the assertion.
    screen.getByRole('heading', { name: 'Create your account' });
    screen.getByLabelText('Email');
    screen.getByLabelText(/Password/);
    screen.getByLabelText(/Gamer tag/);
    screen.getByText(/Joining a room by code is free/);
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login');
  });

  it('posts to the control-plane and confirms success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ account: { gamerTag: 'CoolCat' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() => screen.getByRole('heading', { name: 'You are in' }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/auth/signup'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('surfaces the server error message on a taken gamer tag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'That gamer tag is already taken.', field: 'gamerTag' }),
      }),
    );

    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('That gamer tag is already taken.'),
    );
  });

  it('shows a friendly message when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Could not reach the server/),
    );
  });
});
