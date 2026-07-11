import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareLink } from './ShareLink';

// A relative shareLink resolves against whatever origin jsdom serves the app at.
const ORIGIN = window.location.origin;

describe('ShareLink', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // navigator.share is set per-test; remove it so it never leaks into the next case.
    delete (navigator as { share?: unknown }).share;
  });

  it('shows the room code as a link to the absolute join URL (not a bare path)', async () => {
    render(<ShareLink code="ABC12" href="/join?code=ABC12" />);
    const link = await screen.findByRole('link', { name: 'ABC12' });
    await waitFor(() => {
      expect(link).toHaveProperty('href', `${ORIGIN}/join?code=ABC12`);
    });
  });

  it('copies the absolute URL from the copy icon button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ShareLink code="ABC12" href="/join?code=ABC12" />);
    await screen.findByRole('link', { name: 'ABC12' });
    fireEvent.click(screen.getByRole('button', { name: /copy join link/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/join?code=ABC12`);
    });
  });

  it('opens the native share sheet when the browser supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share });

    render(<ShareLink code="ABC12" href="/join?code=ABC12" />);
    await screen.findByRole('link', { name: 'ABC12' });
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => {
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({ url: `${ORIGIN}/join?code=ABC12` }),
      );
    });
  });

  it('falls back to copying when the native share sheet is unavailable (desktop)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    // No navigator.share in this environment.

    render(<ShareLink code="ABC12" href="/join?code=ABC12" />);
    await screen.findByRole('link', { name: 'ABC12' });
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/join?code=ABC12`);
    });
  });

  it('does NOT copy when a supported share sheet is dismissed (AbortError), not a fallback', async () => {
    // Share IS supported here, but the user dismisses the sheet (share rejects). Dismissing must not
    // silently copy the link - only an UNSUPPORTED sheet falls back to copy.
    const share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share, clipboard: { writeText } });

    render(<ShareLink code="ABC12" href="/join?code=ABC12" />);
    await screen.findByRole('link', { name: 'ABC12' });
    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(writeText).not.toHaveBeenCalled();
  });
});
