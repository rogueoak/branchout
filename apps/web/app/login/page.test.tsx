import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'player@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('login page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the log-in form and links to sign up', () => {
    render(<LoginPage />);
    // getByRole/getByLabelText throw on a miss, so the query itself is the assertion.
    screen.getByRole('heading', { name: 'Log in' });
    screen.getByLabelText('Email');
    screen.getByLabelText('Password');
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe(
      '/signup',
    );
  });

  it('posts to the control-plane and confirms success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/login'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('shows the generic error on bad credentials without leaking which field was wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid email or password.' }),
      }),
    );

    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Invalid email or password.'),
    );
  });

  it('shows a friendly message when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Could not reach the server/),
    );
  });
});
