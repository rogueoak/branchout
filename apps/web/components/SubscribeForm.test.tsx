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

// SubscribeForm is now a thin wrapper around canopy's `SubscribeForm` Branch (spec 0035): canopy owns
// the fields, the submit/success/error state machine and the a11y roles; this wrapper owns only the
// transport. These tests exercise the wrapper's contract - it POSTs { email, name, company } to
// /v1/subscribe and maps the response to canopy's success/error surfaces.
describe('SubscribeForm (spec 0047)', () => {
  it('posts the email to /v1/subscribe and shows the success state', async () => {
    const fetchMock = mockFetch({ ok: true, body: { ok: true } });
    render(<SubscribeForm />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^subscribe$/i }));

    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    expect(screen.getByRole('status').textContent).toMatch(/on the list/i);

    // It posted to the subscribe endpoint with the email, the (empty) name, and the honeypot field.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call[0])).toMatch(/\/v1\/subscribe$/);
    const sent = JSON.parse(String(call[1].body));
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

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^subscribe$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toMatch(/Subscribe is not configured yet\./);
    // The success state is NOT shown.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a generic message when the request cannot reach the server', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    render(<SubscribeForm />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^subscribe$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toMatch(/could not reach the server/i);
  });
});
