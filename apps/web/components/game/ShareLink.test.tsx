import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareLink } from './ShareLink';

// A relative shareLink resolves against whatever origin jsdom serves the app at.
const ORIGIN = window.location.origin;

describe('ShareLink', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the share link as an absolute URL, not a bare path', async () => {
    render(<ShareLink href="/join?code=ABC12" />);
    const link = await screen.findByRole('link');
    await waitFor(() => {
      expect(link).toHaveProperty('href', `${ORIGIN}/join?code=ABC12`);
    });
    // The visible text is the full URL a host can paste anywhere.
    expect(link.textContent).toBe(`${ORIGIN}/join?code=ABC12`);
  });

  it('copies the absolute URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ShareLink href="/join?code=ABC12" />);
    // Wait for the post-mount effect to resolve the absolute URL.
    await screen.findByText(`${ORIGIN}/join?code=ABC12`);
    screen.getByRole('button', { name: /copy link/i }).click();

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/join?code=ABC12`);
    });
  });

  it('leaves an already-absolute href untouched', async () => {
    render(<ShareLink href="https://branchout.games/join?code=ZZZ99" />);
    await screen.findByText('https://branchout.games/join?code=ZZZ99');
  });
});
