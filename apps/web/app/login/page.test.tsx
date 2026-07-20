import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

function fillAndSubmit(identifier = 'player@example.com') {
  fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: identifier } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'supersecret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('login page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the log-in form with an email-or-username field and links to sign up', () => {
    render(<LoginPage />);
    // getByRole/getByLabelText throw on a miss, so the query itself is the assertion.
    screen.getByRole('heading', { name: 'Log in' });
    // The identifier field accepts an email OR a username (spec 0072): a plain text input, not
    // type=email (which the browser would reject for a bare username).
    const identifier = screen.getByLabelText('Email or username') as HTMLInputElement;
    expect(identifier.type).toBe('text');
    expect(identifier.getAttribute('name')).toBe('identifier');
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
      expect.stringContaining('/v1/auth/login'),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('accepts a bare username (no email format) and posts it as the identifier (spec 0072)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage />);
    // A username has no `@`; the field must not reject it, and it posts under `identifier`.
    fillAndSubmit('CoolCat');

    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ identifier: 'CoolCat', password: 'supersecret' });
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
