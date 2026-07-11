import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileShare } from './ProfileShare';

// navigator.share / navigator.clipboard are not defined in jsdom; define them per case so the
// feature-detect (canShare) picks the branch under test. `configurable` lets afterEach reset them.
function setShare(fn: ((data?: unknown) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'share', { value: fn, configurable: true });
}
function setClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('ProfileShare', () => {
  afterEach(() => {
    setShare(undefined);
    vi.restoreAllMocks();
  });

  it('opens the native share sheet when supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    render(<ProfileShare name="Ada" />);
    const button = await screen.findByRole('button', { name: /share this profile/i });
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share.mock.calls[0][0]).toMatchObject({ title: expect.stringContaining('Ada') });
  });

  it('does not copy when the player dismisses the native sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError'));
    setShare(share);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<ProfileShare name="Ada" />);
    fireEvent.click(await screen.findByRole('button', { name: /share this profile/i }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to copying the link when share is unsupported', async () => {
    setShare(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<ProfileShare name="Ada" />);
    const button = await screen.findByRole('button', { name: /copy a link to this profile/i });
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  });
});
