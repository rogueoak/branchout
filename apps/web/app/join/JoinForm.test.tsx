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
vi.mock('../../lib/membership', () => ({
  rememberMembership: vi.fn(),
  recallDeviceMode: vi.fn(() => null),
  recallMembership: vi.fn(() => null),
  recallPlayerName: vi.fn(() => null),
  rememberPlayerName: vi.fn(),
  recallAnonName: vi.fn(() => null),
  rememberAnonName: vi.fn(),
}));
vi.mock('../../lib/random-name', () => ({
  generateRandomName: vi.fn(() => 'Prickly Ostrich'),
}));
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
import * as membership from '../../lib/membership';
import { generateRandomName } from '../../lib/random-name';
import { JoinForm } from './JoinForm';

afterEach(() => vi.clearAllMocks());

/** The current value of the pre-filled "Your name" field. */
function nameValue(): string {
  return (screen.getByLabelText('Your name') as HTMLInputElement).value;
}

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

describe('JoinForm name seeding (spec 0066)', () => {
  it("pre-fills a signed-in player's gamer tag when no name is remembered", async () => {
    vi.mocked(membership.recallPlayerName).mockReturnValue(null);
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: true, gamerTag: 'AdaLovelace' }} />);
    await waitFor(() => expect(nameValue()).toBe('AdaLovelace'));
    // The gamer tag is authoritative: no random name is minted and nothing is persisted to either
    // slot, so a "always generate/persist" regression fails here.
    expect(generateRandomName).not.toHaveBeenCalled();
    expect(membership.rememberAnonName).not.toHaveBeenCalled();
    expect(membership.rememberPlayerName).not.toHaveBeenCalled();
  });

  it('a remembered name wins over the gamer tag', async () => {
    vi.mocked(membership.recallPlayerName).mockReturnValue('Mossy Otter');
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: true, gamerTag: 'AdaLovelace' }} />);
    await waitFor(() => expect(nameValue()).toBe('Mossy Otter'));
    // A picked name short-circuits precedence: no generate, no re-persist of the seeded value.
    expect(generateRandomName).not.toHaveBeenCalled();
    expect(membership.rememberAnonName).not.toHaveBeenCalled();
    expect(membership.rememberPlayerName).not.toHaveBeenCalled();
  });

  it('a fresh anonymous player gets a generated name persisted under the anon key (once)', async () => {
    vi.mocked(membership.recallPlayerName).mockReturnValue(null);
    vi.mocked(membership.recallAnonName).mockReturnValue(null);
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: false }} />);
    await waitFor(() => expect(nameValue()).toBe('Prickly Ostrich'));
    // Persisted on first use under the DISTINCT anon key (never the picked key, so it can never
    // shadow a future gamer tag), and minted at most once per browser.
    expect(membership.rememberAnonName).toHaveBeenCalledWith('Prickly Ostrich');
    expect(membership.rememberAnonName).toHaveBeenCalledTimes(1);
    expect(membership.rememberPlayerName).not.toHaveBeenCalled();
  });

  it('reuses a previously generated anon name without minting a new one', async () => {
    vi.mocked(membership.recallPlayerName).mockReturnValue(null);
    vi.mocked(membership.recallAnonName).mockReturnValue('Sunny Robin');
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: false }} />);
    await waitFor(() => expect(nameValue()).toBe('Sunny Robin'));
    expect(generateRandomName).not.toHaveBeenCalled();
    expect(membership.rememberAnonName).not.toHaveBeenCalled();
  });

  it('persists an edited name on submit so the next visit reuses it', async () => {
    vi.mocked(membership.recallPlayerName).mockReturnValue(null);
    vi.mocked(membership.recallAnonName).mockReturnValue(null);
    vi.mocked(roomApi.joinRoom).mockResolvedValue({
      room: { code: 'ABC12' },
      playerId: 'p1',
    } as never);
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: false }} />);
    await waitFor(() => expect(nameValue()).toBe('Prickly Ostrich'));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join room' }));
    await waitFor(() => expect(membership.rememberPlayerName).toHaveBeenCalledWith('Ada'));
  });

  it('persists a typed name on blur, but never the untouched seeded default', async () => {
    vi.mocked(membership.recallPlayerName).mockReturnValue(null);
    vi.mocked(membership.recallAnonName).mockReturnValue(null);
    render(<JoinForm initialCode="ABC12" viewer={{ signedIn: false }} />);
    await waitFor(() => expect(nameValue()).toBe('Prickly Ostrich'));
    // Blurring the seeded default (untouched) must NOT write it to the picked slot.
    fireEvent.blur(screen.getByLabelText('Your name'));
    expect(membership.rememberPlayerName).not.toHaveBeenCalled();
    // Once the player types, blur commits that value to the picked slot.
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.blur(screen.getByLabelText('Your name'));
    expect(membership.rememberPlayerName).toHaveBeenCalledWith('Ada');
  });
});
