import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The rooms home drives the create flow: a plain create routes to the pick step; a `?game=` deep
// link (spec 0029) pre-selects the game and skips straight to invite. Mock the router + room-api so
// the test asserts exactly where the host is routed.
const hoisted = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: hoisted.push, replace: hoisted.replace }),
}));

vi.mock('../../lib/room-api', () => ({
  RoomApiError: class RoomApiError extends Error {},
  createRoom: vi.fn(),
  fetchIdentity: vi.fn(),
  selectGame: vi.fn(),
  setMode: vi.fn(),
}));
vi.mock('../../lib/membership', () => ({
  rememberMembership: vi.fn(),
  recallDeviceMode: vi.fn(() => null),
}));

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
  hoisted.replace.mockReset();
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

  it('auto-creates and REPLACES to the lobby when ?game names a known game (no Create tap)', async () => {
    vi.mocked(roomApi.selectGame).mockResolvedValue({ ...room, selectedGame: 'liar-liar' });
    render(<RoomsHome viewer={{ signedIn: true }} initialGame="liar-liar" />);
    // The auto-create runs on mount with no "Create a room" tap: the setup state shows, the game is
    // selected, and the host is REPLACED (not pushed) straight into the lobby.
    expect(await screen.findByText(/setting up your room/i)).toBeDefined();
    await waitFor(() =>
      expect(roomApi.selectGame).toHaveBeenCalledWith('ABC12', 'liar-liar', expect.anything()),
    );
    await waitFor(() => expect(hoisted.replace).toHaveBeenCalledWith('/rooms/ABC12'));
    expect(hoisted.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /create a room/i })).toBeNull();
  });

  it('auto-creates exactly ONCE even when the deep-link game changes (the one-shot guard, spec 0029)', async () => {
    vi.mocked(roomApi.selectGame).mockResolvedValue({ ...room, selectedGame: 'liar-liar' });
    const { rerender } = render(<RoomsHome viewer={{ signedIn: true }} initialGame="liar-liar" />);
    await waitFor(() => expect(roomApi.createRoom).toHaveBeenCalledTimes(1));
    // Re-render with a DIFFERENT valid slug: this changes the `preselected` memo, so the auto-create
    // effect (deps `[preselected, isAccount]`) actually RE-FIRES - the discriminating case a same-props
    // rerender never exercises. The ref guard must still block the second run, so exactly one room is
    // ever minted per arrival. Without the guard this second slug fires a second createRoom and the
    // final assertion goes red (confirmed by mutation).
    rerender(<RoomsHome viewer={{ signedIn: true }} initialGame="trivia" />);
    await waitFor(() => expect(hoisted.replace).toHaveBeenCalledWith('/rooms/ABC12'));
    expect(roomApi.createRoom).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-create for a viewer who cannot host - shows the landing (spec 0029)', async () => {
    // Identity resolves to anonymous (not an account): the deep-link host gate fails, so no room is
    // created and the create landing shows with the "Log in to host" affordance.
    vi.mocked(roomApi.fetchIdentity).mockResolvedValue({ kind: 'anonymous' });
    render(<RoomsHome viewer={{ signedIn: false }} initialGame="liar-liar" />);
    expect(await screen.findByRole('link', { name: /log in to host/i })).toBeDefined();
    expect(roomApi.createRoom).not.toHaveBeenCalled();
    expect(roomApi.selectGame).not.toHaveBeenCalled();
    expect(hoisted.replace).not.toHaveBeenCalled();
  });

  it('never flashes the setup screen for a signed-out visitor on a deep link (review #138)', async () => {
    // Identity fetch is still in flight (isAccount === null). A signed-out viewer opening a shared
    // `?game=` link must NOT see the "Setting up your room..." head-fake during that async window -
    // showSetup is gated on the server-known viewer.signedIn.
    vi.mocked(roomApi.fetchIdentity).mockReturnValue(new Promise<never>(() => {}));
    render(<RoomsHome viewer={{ signedIn: false }} initialGame="liar-liar" />);
    // The create landing shows immediately; the setup text never appears and no room is created.
    expect(await screen.findByRole('heading', { name: /play a game/i })).toBeDefined();
    expect(screen.queryByText(/setting up your room/i)).toBeNull();
    expect(roomApi.createRoom).not.toHaveBeenCalled();
  });

  it('the signed-out deep link carries the game as ?next on login and sign up (review #138)', async () => {
    // A signed-out deep-linker must resume into the game after auth: both auth links carry the
    // `?game=` deep link as a validated internal `next`.
    vi.mocked(roomApi.fetchIdentity).mockResolvedValue({ kind: 'anonymous' });
    render(<RoomsHome viewer={{ signedIn: false }} initialGame="liar-liar" />);
    const login = await screen.findByRole('link', { name: /log in to host/i });
    expect(login.getAttribute('href')).toBe('/login?next=%2Frooms%3Fgame%3Dliar-liar');
    // Scope to the Host section - the shared top nav also carries a (plain) "Sign up" link.
    const host = within(screen.getByRole('region', { name: /host a room/i }));
    expect(host.getByRole('link', { name: /^sign up$/i }).getAttribute('href')).toBe(
      '/signup?next=%2Frooms%3Fgame%3Dliar-liar',
    );
  });

  it('times out of the setup screen to a retry-able landing when the create stalls (review #138)', async () => {
    // A flaky-network stall must not leave the host on "Setting up your room..." forever: after the
    // safety timeout, drop to the create landing with a retry-able message.
    vi.useFakeTimers();
    try {
      vi.mocked(roomApi.createRoom).mockReturnValue(new Promise(() => {}) as never);
      render(<RoomsHome viewer={{ signedIn: true }} initialGame="liar-liar" />);
      // Flush the identity resolve + auto-create kickoff, then run out the setup timeout (8s).
      await vi.advanceTimersByTimeAsync(8000);
      expect(screen.getByRole('alert').textContent).toMatch(/taking longer than expected/i);
      expect(screen.getByRole('button', { name: /create a room/i })).toBeDefined();
      expect(hoisted.replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the create landing with a message when the auto-create fails (spec 0029)', async () => {
    vi.mocked(roomApi.createRoom).mockRejectedValue(new Error('boom'));
    render(<RoomsHome viewer={{ signedIn: true }} initialGame="liar-liar" />);
    // The setup state gives way to the landing with an alert; no navigation happens.
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('button', { name: /create a room/i })).toBeDefined();
    expect(hoisted.replace).not.toHaveBeenCalled();
  });

  it('ignores an unknown ?game and falls back to the pick step', async () => {
    render(<RoomsHome viewer={{ signedIn: false }} initialGame="not-a-game" />);
    fireEvent.click(await screen.findByRole('button', { name: /create a room/i }));
    await waitFor(() => expect(hoisted.push).toHaveBeenCalledWith('/rooms/ABC12?step=pick'));
    expect(roomApi.selectGame).not.toHaveBeenCalled();
  });

  it('IGNORES an insider-only game deep link on the apex, even for an insider (feedback 0029)', async () => {
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

  it('auto-creates an insider-only game deep link on the insider surface (feedback 0029)', async () => {
    vi.mocked(roomApi.selectGame).mockResolvedValue({ ...room, selectedGame: 'teeter-tower' });
    render(
      <RoomsHome
        viewer={{ signedIn: true, insider: true }}
        initialGame="teeter-tower"
        surface={{ insider: true, linkOrigin: 'https://branchout.games' }}
      />,
    );
    await waitFor(() =>
      expect(roomApi.selectGame).toHaveBeenCalledWith('ABC12', 'teeter-tower', expect.anything()),
    );
    await waitFor(() => expect(hoisted.replace).toHaveBeenCalledWith('/rooms/ABC12'));
  });

  it('does NOT autofocus the join-code input on mount (feedback 0031)', async () => {
    render(<RoomsHome viewer={{ signedIn: false }} />);
    const input = await screen.findByLabelText('Room code');
    // The field must not steal focus on load - that pops the mobile keyboard and buries the primary
    // "Create a room" action. jsdom cannot exercise the mobile browser autofocus heuristic, so this
    // asserts only that nothing in our code focuses the field on mount; the explicit `autoFocus={false}`
    // prop is the guard, provable end-to-end only in a real browser.
    expect(document.activeElement).not.toBe(input);
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
