import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The join surface carries the shared footer (spec 0031). Mock the router so JoinForm renders.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// Analytics seam (spec 0032): room_joined fires on a successful join, never on a failed one.
vi.mock('../../lib/analytics', () => ({
  trackRoomJoined: vi.fn(),
  identifyPlayer: vi.fn(),
  resetAnalytics: vi.fn(),
}));
vi.mock('../../lib/membership', () => ({ rememberMembership: vi.fn() }));
vi.mock('../../lib/room-api', () => ({
  RoomApiError: class RoomApiError extends Error {
    status: number;
    constructor(status = 500, message = 'err') {
      super(message);
      this.status = status;
    }
  },
  joinRoom: vi.fn(),
  startAnonymousSession: vi.fn(),
}));

import * as roomApi from '../../lib/room-api';
import { trackRoomJoined } from '../../lib/analytics';
import { JoinForm } from './JoinForm';

afterEach(() => vi.clearAllMocks());

/** Fill the required name and submit the join form. */
function submitJoin() {
  render(<JoinForm initialCode="ABC12" viewer={{ signedIn: false }} />);
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
}

describe('JoinForm', () => {
  it('renders the shared footer with privacy and terms links', () => {
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: false }} />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveProperty(
      'href',
      expect.stringContaining('/privacy'),
    );
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveProperty(
      'href',
      expect.stringContaining('/terms'),
    );
  });

  it('fires room_joined on a successful join', async () => {
    vi.mocked(roomApi.joinRoom).mockResolvedValue({
      room: { code: 'ABC12' },
      playerId: 'p1',
    } as never);
    submitJoin();
    await waitFor(() => expect(trackRoomJoined).toHaveBeenCalledTimes(1));
  });

  it('does NOT fire room_joined when the join fails', async () => {
    vi.mocked(roomApi.joinRoom).mockRejectedValue(
      new (roomApi.RoomApiError as unknown as new (s: number, m: string) => Error)(500, 'nope'),
    );
    submitJoin();
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(trackRoomJoined).not.toHaveBeenCalled();
  });
});
