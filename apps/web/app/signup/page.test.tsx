import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SignupPage from './page';

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
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeDefined();
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText(/Password/)).toBeDefined();
    expect(screen.getByLabelText(/Gamer tag/)).toBeDefined();
    expect(screen.getByText(/Joining a room by code is free/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login');
  });

  it('posts to the control-plane and confirms success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ account: { gamerTag: 'CoolCat' } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<SignupPage />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'You are in' })).toBeDefined());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/signup'),
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
