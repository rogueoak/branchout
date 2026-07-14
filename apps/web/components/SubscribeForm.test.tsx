import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubscribeForm } from './SubscribeForm';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    json: async () => response.body,
  }));
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

describe('SubscribeForm (spec 0047)', () => {
  it('posts the email to /v1/subscribe and shows the success state', async () => {
    const fetchMock = mockFetch({ ok: true, body: { ok: true } });
    render(<SubscribeForm />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }));

    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    expect(screen.getByRole('status').textContent).toMatch(/on the list/i);

    // It posted to the subscribe endpoint with the email + the honeypot field.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/subscribe$/);
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.email).toBe('ada@example.com');
    expect(sent).toHaveProperty('company', '');
  });

  it('renders the server error message on a failed subscribe', async () => {
    mockFetch({
      ok: false,
      status: 503,
      body: { ok: false, error: 'Subscribe is not configured yet.' },
    });
    render(<SubscribeForm />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toBe('Subscribe is not configured yet.');
    // The success state is NOT shown.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a generic message when the request cannot reach the server', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<SubscribeForm />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /subscribe/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toMatch(/could not reach the server/i);
  });

  it('disables submit until an email is entered', () => {
    render(<SubscribeForm />);
    expect(screen.getByRole('button', { name: /subscribe/i })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    expect(screen.getByRole('button', { name: /subscribe/i })).toHaveProperty('disabled', false);
  });
});
