import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The rooms home drives the create flow: a plain create routes to the pick step; a `?game=` deep
// link (spec 0029) pre-selects the game and skips straight to invite. Mock the router + room-api so
// the test asserts exactly where the host is routed.
const hoisted = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hoisted.push }) }));

vi.mock('../../lib/room-api', () => ({
  RoomApiError: class RoomApiError extends Error {},
  createRoom: vi.fn(),
  fetchIdentity: vi.fn(),
  selectGame: vi.fn(),
  setMode: vi.fn(),
}));
vi.mock('../../lib/membership', () => ({ rememberMembership: vi.fn() }));

// Analytics seam (spec 0032): room_created fires on a successful create.
vi.mock('../../lib/analytics', () => ({
  trackRoomCreated: vi.fn(),
  identifyPlayer: vi.fn(),
  resetAnalytics: vi.fn(),
}));

import * as roomApi from '../../lib/room-api';
import { trackRoomCreated } from '../../lib/analytics';
import { RoomsHome } from './RoomsHome';

const room = {
  id: 'r1',
  code: 'ABC12',
  shareLink: '/join?code=ABC12',
  status: 'lobby',
  selectedGame: null,
  hostAccountId: 'a1',
};

beforeEach(() => {
  vi.mocked(roomApi.fetchIdentity).mockResolvedValue({ kind: 'account', displayName: 'Ada' });
  vi.mocked(roomApi.createRoom).mockResolvedValue({ room, playerId: 'p1' });
  vi.mocked(roomApi.setMode).mockResolvedValue(undefined);
  hoisted.push.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('RoomsHome create flow', () => {
  it('routes to the pick step when there is no game deep link', async () => {
    render(<RoomsHome viewer={{ signedIn: false }} />);
    fireEvent.click(await screen.findByRole('button', { name: /create a room/i }));
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/rooms/ABC12?step=pick'));
    expect(roomApi.selectGame).not.toHaveBeenCalled();
    expect(trackRoomCreated).toHaveBeenCalledTimes(1);
  });

  it('pre-selects the game and skips to invite when ?game names a known game', async () => {
    vi.mocked(roomApi.selectGame).mockResolvedValue({ ...room, selectedGame: 'liar-liar' });
    render(<RoomsHome viewer={{ signedIn: false }} initialGame="liar-liar" />);
    fireEvent.click(await screen.findByRole('button', { name: /create a room/i }));
    await waitFor(() =>
      expect(roomApi.selectGame).toHaveBeenCalledWith('ABC12', 'liar-liar', expect.anything()),
    );
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/rooms/ABC12?step=invite'));
  });

  it('ignores an unknown ?game and falls back to the pick step', async () => {
    render(<RoomsHome viewer={{ signedIn: false }} initialGame="not-a-game" />);
    fireEvent.click(await screen.findByRole('button', { name: /create a room/i }));
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/rooms/ABC12?step=pick'));
    expect(roomApi.selectGame).not.toHaveBeenCalled();
  });

  it('IGNORES an insider-only game deep link on the apex, even for an insider (feedback 0028)', async () => {
    // An insider viewer, but the surface is the apex (default): the insider-only game must not be
    // pre-selected, so it never starts on the main site. The host falls back to the pick step.
    render(
      <RoomsHome
        viewer={{ signedIn: true, insider: true }}
        initialGame="teeter-tower"
        surface={{ insider: false, linkOrigin: '' }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /create a room/i }));
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/rooms/ABC12?step=pick'));
    expect(roomApi.selectGame).not.toHaveBeenCalled();
  });

  it('pre-selects an insider-only game deep link on the insider surface (feedback 0028)', async () => {
    vi.mocked(roomApi.selectGame).mockResolvedValue({ ...room, selectedGame: 'teeter-tower' });
    render(
      <RoomsHome
        viewer={{ signedIn: true, insider: true }}
        initialGame="teeter-tower"
        surface={{ insider: true, linkOrigin: 'https://branchout.games' }}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /create a room/i }));
    await waitFor(() =>
      expect(roomApi.selectGame).toHaveBeenCalledWith('ABC12', 'teeter-tower', expect.anything()),
    );
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/rooms/ABC12?step=invite'));
  });

  it('renders the shared footer with privacy and terms links (spec 0031)', async () => {
    render(<RoomsHome viewer={{ signedIn: false }} />);
    const footer = await screen.findByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveProperty(
      'href',
      expect.stringContaining('/privacy'),
    );
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveProperty(
      'href',
      expect.stringContaining('/terms'),
    );
  });
});
