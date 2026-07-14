import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackDialog } from './FeedbackDialog';

// canopy's ResponsiveDialog reads useIsMobile() -> matchMedia, which jsdom does not implement.
// Stub it so the desktop (modal) form mounts deterministically. Radix portals into document.body,
// which Testing Library queries fine.
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const context = { code: 'ABC12', game: 'teeter-tower', phase: 'collecting', isHost: true };

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Feedback' }));
}

describe('FeedbackDialog', () => {
  it('opens the dialog from the trigger', async () => {
    render(<FeedbackDialog context={context} />);
    openDialog();
    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByLabelText('Your feedback')).toBeDefined();
  });

  it('keeps Submit disabled until a message is typed (message is required)', async () => {
    render(<FeedbackDialog context={context} />);
    openDialog();
    await screen.findByRole('dialog');
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Your feedback'), {
      target: { value: 'The drop button is hard to reach.' },
    });
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty('disabled', false);
  });

  it('sends the message with context and shows a success message on submit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<FeedbackDialog context={context} />);
    openDialog();
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Your feedback'), {
      target: { value: 'Great game.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await screen.findByText(/on its way/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.message).toBe('Great game.');
    expect(body.context).toMatchObject({
      code: 'ABC12',
      game: 'teeter-tower',
      phase: 'collecting',
      isHost: true,
    });
    // The dialog stamps the submit time.
    expect(typeof body.context.at).toBe('string');
  });

  it('shows the server error verbatim on failure (e.g. the not-configured 503)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'Feedback email is not configured yet.' }), {
        status: 503,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<FeedbackDialog context={context} />);
    openDialog();
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('not configured');
    });
  });
});
