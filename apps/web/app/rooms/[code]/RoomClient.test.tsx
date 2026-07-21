import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomView } from '../../../lib/room-api';
import type { Membership } from '../../../lib/membership';

// The room page transition is the client half of bug #3 (feedback 0014): a non-host device never
// runs the host's start/exit handler, so it must POLL the room status to move between the lobby and
// the game. Mock the child views to markers and the engine hook so the test isolates that poll.

// vi.hoisted so these are defined before the hoisted vi.mock factories reference them.
const hoisted = vi.hoisted(() => ({
  getRoom: vi.fn(),
  listMembers: vi.fn(),
  selectGame: vi.fn(),
  resumeRoom: vi.fn(),
  setPalette: vi.fn(),
  replace: vi.fn(),
  recalled: null as Membership | null,
  // The engine state the mocked useGameClient returns - mutable so a test can drive a phase change.
  gameState: {
    connection: 'connecting',
    joined: false,
    phase: 'configuring' as string,
    paused: false,
  },
}));
const { getRoom, listMembers } = hoisted;

// The setup wizard navigates between steps via the router; mock it so the steps render without a
// real app-router context.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: hoisted.replace, push: vi.fn() }),
}));

vi.mock('../../../lib/room-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/room-api')>();
  return {
    ...actual,
    getRoom: (code: string) => hoisted.getRoom(code),
    listMembers: (code: string) => hoisted.listMembers(code),
    selectGame: (...args: unknown[]) => hoisted.selectGame(...args),
    resumeRoom: (code: string) => hoisted.resumeRoom(code),
    setPalette: (...args: unknown[]) => hoisted.setPalette(...args),
  };
});

vi.mock('../../../lib/membership', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/membership')>();
  return {
    ...actual,
    recallMembership: () => hoisted.recalled,
    rememberMembership: vi.fn(),
  };
});

// The engine socket is out of scope for this transition test; stub the hook. It returns the mutable
// hoisted.gameState so a test can drive the phase (e.g. into `complete`) across re-renders.
vi.mock('../../../lib/use-game-client', () => ({
  useGameClient: () => ({
    state: hoisted.gameState,
    submitMove: vi.fn(),
    submitVote: vi.fn(),
  }),
}));

// Analytics seams (spec 0032): game_picked on pick, game_completed once on the host's complete
// transition. Mock the module so we assert the seam without PostHog.
vi.mock('../../../lib/analytics', () => ({
  trackGamePicked: vi.fn(),
  trackGameStarted: vi.fn(),
  trackGameCompleted: vi.fn(),
  identifyPlayer: vi.fn(),
  resetAnalytics: vi.fn(),
}));

// The lobby is mocked to a marker, but it exposes the "Change game" trigger so a test can drive the
// in-room change-game flow through RoomClient (the real Lobby owns that button).
vi.mock('../../../components/game/Lobby', () => ({
  Lobby: ({
    onChangeGame,
    onClaimPalette,
    paletteError,
  }: {
    onChangeGame: () => void;
    onClaimPalette?: (id: string) => void;
    paletteError?: string | null;
  }) => (
    <div>
      LOBBY_VIEW
      <button type="button" onClick={onChangeGame}>
        Change game
      </button>
      <button type="button" onClick={() => onClaimPalette?.('grape')}>
        Claim grape
      </button>
      {paletteError ? <p>PALETTE_ERROR: {paletteError}</p> : null}
    </div>
  ),
}));
vi.mock('../../../components/game/GameStage', () => ({ GameStage: () => <div>GAME_VIEW</div> }));

import { fireEvent } from '@testing-library/react';
import { RoomApiError } from '../../../lib/room-api';
import { trackGameCompleted, trackGamePicked } from '../../../lib/analytics';
import { RoomClient } from './RoomClient';

const roomAt = (status: string): RoomView => ({
  id: 'room-1',
  code: 'ABC12',
  shareLink: '/join?code=ABC12',
  status,
  selectedGame: 'trivia',
  hostAccountId: 'acct-1',
});

function nonHostMembership(status: string): Membership {
  return {
    isHost: false,
    mode: 'remote',
    nickname: 'Bob',
    player: 'p2',
    room: roomAt(status),
  };
}

function hostMembership(status: string): Membership {
  return {
    isHost: true,
    mode: 'interactive',
    nickname: 'Ada',
    player: 'p1',
    room: roomAt(status),
  };
}

beforeEach(() => {
  getRoom.mockReset();
  listMembers.mockReset();
  listMembers.mockResolvedValue([]);
  hoisted.selectGame.mockReset();
  hoisted.selectGame.mockResolvedValue(roomAt('lobby'));
  hoisted.resumeRoom.mockReset();
  hoisted.setPalette.mockReset();
  hoisted.setPalette.mockResolvedValue(undefined);
  // Default: the tab has no live seat to resume, so an absent recall falls through to the join
  // prompt. Tests that exercise resume override this.
  hoisted.resumeRoom.mockRejectedValue(new RoomApiError(404, 'not_member', 'Join the room.'));
  hoisted.gameState = {
    connection: 'connecting',
    joined: false,
    phase: 'configuring',
    paused: false,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RoomClient non-host transitions on the room-status poll', () => {
  it('moves a non-host from the lobby into the game when the host starts it', async () => {
    hoisted.recalled = nonHostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('running'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);

    // Starts in the lobby (the recalled status), then the poll observes `running` and enters.
    expect(screen.getByText('LOBBY_VIEW')).toBeDefined();
    await waitFor(() => expect(screen.getByText('GAME_VIEW')).toBeDefined());
    expect(getRoom).toHaveBeenCalledWith('ABC12');
  });

  it('returns a non-host to the lobby when the host exits the game', async () => {
    hoisted.recalled = nonHostMembership('running');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);

    // Starts in the game (recalled `running`), then the poll observes the exit and returns.
    expect(screen.getByText('GAME_VIEW')).toBeDefined();
    await waitFor(() => expect(screen.getByText('LOBBY_VIEW')).toBeDefined());
  });
});

describe('RoomClient resume when the tab forgot its membership (feedback 0021)', () => {
  it('re-seats a returning host from the server instead of showing the join prompt', async () => {
    hoisted.recalled = null;
    hoisted.resumeRoom.mockResolvedValue({
      room: roomAt('lobby'),
      membership: {
        isHost: true,
        mode: 'interactive',
        nickname: 'Ada',
        player: 'p1',
      },
    });
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: true }} />);

    // The host lands straight in the lobby - no "Join room" prompt.
    await waitFor(() => expect(screen.getByText('LOBBY_VIEW')).toBeDefined());
    expect(screen.queryByRole('heading', { name: /join room/i })).toBeNull();
    expect(hoisted.resumeRoom).toHaveBeenCalledWith('ABC12');
  });

  it('shows the join prompt when the server says the caller is not a member', async () => {
    hoisted.recalled = null;
    // resumeRoom rejects with not_member (the beforeEach default), so we fall through to join.
    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);

    expect(await screen.findByRole('heading', { name: /join room/i })).toBeDefined();
    expect(screen.queryByText('LOBBY_VIEW')).toBeNull();
  });
});

describe('RoomClient top nav (spec 0029)', () => {
  it('shows the shared site nav in the lobby', async () => {
    hoisted.recalled = nonHostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);

    expect(screen.getByText('LOBBY_VIEW')).toBeDefined();
    expect(screen.getByRole('navigation', { name: /site navigation/i })).toBeDefined();
  });

  it('hides the site nav once the game is running (the stage keeps its own header)', async () => {
    hoisted.recalled = nonHostMembership('running');
    getRoom.mockResolvedValue(roomAt('running'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);

    expect(screen.getByText('GAME_VIEW')).toBeDefined();
    expect(screen.queryByRole('navigation', { name: /site navigation/i })).toBeNull();
  });
});

describe('RoomClient host setup wizard (spec 0029)', () => {
  it('shows the pick step to a host arriving with ?step=pick', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} initialStep="pick" />);

    expect(await screen.findByRole('heading', { name: /pick a game/i })).toBeDefined();
    // The wizard replaces the lobby, not layers on top of it.
    expect(screen.queryByText('LOBBY_VIEW')).toBeNull();
  });

  it('HIDES the insider-only game from the picker on the apex surface (feedback 0029)', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    // Default surface is the apex: even though the picker renders, the insider-only Teeter Tower
    // must not be an option, while public games still are.
    render(
      <RoomClient code="ABC12" viewer={{ signedIn: true, insider: true }} initialStep="pick" />,
    );

    expect(await screen.findByRole('button', { name: /pick trivia/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /pick teeter tower/i })).toBeNull();
  });

  it('SHOWS the insider-only game in the picker on the insider surface (feedback 0029)', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(
      <RoomClient
        code="ABC12"
        viewer={{ signedIn: true, insider: true }}
        initialStep="pick"
        surface={{ insider: true, linkOrigin: 'https://branchout.games' }}
      />,
    );

    expect(await screen.findByRole('button', { name: /pick teeter tower/i })).toBeDefined();
  });

  it('lands a host in the lobby for a stale ?step=invite (the invite step was removed)', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} initialStep="invite" />);

    // The old standalone invite step is gone; the share link lives in the lobby now.
    expect(await screen.findByText('LOBBY_VIEW')).toBeDefined();
  });

  it('ignores the setup step for a non-host - it goes straight to the lobby', async () => {
    hoisted.recalled = nonHostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} initialStep="pick" />);

    expect(await screen.findByText('LOBBY_VIEW')).toBeDefined();
    expect(screen.queryByRole('heading', { name: /pick a game/i })).toBeNull();
  });

  it('lands a host with no step in the lobby', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);

    expect(await screen.findByText('LOBBY_VIEW')).toBeDefined();
  });
});

describe('RoomClient in-room change game (local state, not ?step=)', () => {
  it('opens the change-game picker from the lobby without touching the URL', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    fireEvent.click(await screen.findByRole('button', { name: /change game/i }));

    // The picker shows with the change-game heading; it is local state, so the URL is NOT changed.
    expect(await screen.findByRole('heading', { name: /change game/i })).toBeDefined();
    expect(hoisted.replace).not.toHaveBeenCalled();
  });

  it('Cancel returns to the lobby', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    fireEvent.click(await screen.findByRole('button', { name: /change game/i }));
    await screen.findByRole('heading', { name: /change game/i });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(await screen.findByText('LOBBY_VIEW')).toBeDefined();
  });

  it('picking a game in the change flow returns to the LOBBY (not the invite step)', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    fireEvent.click(await screen.findByRole('button', { name: /change game/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pick liar liar/i }));

    // Returns to the lobby, NOT the invite step - and never navigated the URL for the change flow.
    expect(await screen.findByText('LOBBY_VIEW')).toBeDefined();
    expect(screen.queryByRole('heading', { name: /invite your friends/i })).toBeNull();
    expect(hoisted.selectGame).toHaveBeenCalledWith('ABC12', 'liar-liar', expect.anything());
    expect(hoisted.replace).not.toHaveBeenCalled();
    // Analytics seam: picking a game fires game_picked with the chosen game id.
    expect(trackGamePicked).toHaveBeenCalledWith('liar-liar');
  });
});

describe('RoomClient game_completed analytics (spec 0032)', () => {
  it('fires once for the host on a real transition into complete', async () => {
    hoisted.recalled = hostMembership('running');
    getRoom.mockResolvedValue(roomAt('running'));
    hoisted.gameState = { connection: 'open', joined: true, phase: 'answering', paused: false };

    const { rerender } = render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    await screen.findByText('GAME_VIEW');
    expect(trackGameCompleted).not.toHaveBeenCalled();

    // The game ends: phase transitions to complete.
    hoisted.gameState = { ...hoisted.gameState, phase: 'complete' };
    rerender(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    await waitFor(() => expect(trackGameCompleted).toHaveBeenCalledTimes(1));
    expect(trackGameCompleted).toHaveBeenCalledWith('trivia');
  });

  it('does NOT fire for a non-host (avoids one event per connected client)', async () => {
    hoisted.recalled = nonHostMembership('running');
    getRoom.mockResolvedValue(roomAt('running'));
    hoisted.gameState = { connection: 'open', joined: true, phase: 'answering', paused: false };

    const { rerender } = render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    await screen.findByText('GAME_VIEW');
    hoisted.gameState = { ...hoisted.gameState, phase: 'complete' };
    rerender(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    await waitFor(() => expect(screen.getByText('GAME_VIEW')).toBeDefined());
    expect(trackGameCompleted).not.toHaveBeenCalled();
  });

  it('does NOT fire on a reload/late-join that lands directly on complete', async () => {
    hoisted.recalled = hostMembership('running');
    getRoom.mockResolvedValue(roomAt('running'));
    // First observed phase is already complete (a reload into a finished game).
    hoisted.gameState = { connection: 'open', joined: true, phase: 'complete', paused: false };

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    await screen.findByText('GAME_VIEW');
    await waitFor(() => expect(getRoom).toHaveBeenCalled());
    expect(trackGameCompleted).not.toHaveBeenCalled();
  });
});

describe('RoomClient pick-step selectGame failure', () => {
  it('keeps the host on the picker and surfaces the error when selection fails', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));
    hoisted.selectGame.mockRejectedValueOnce(new RoomApiError(500, null, 'Could not select.'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} initialStep="pick" />);
    fireEvent.click(await screen.findByRole('button', { name: /pick liar liar/i }));

    // Error is shown and the host stays on the pick step (not advanced to invite).
    expect(await screen.findByText(/could not select/i)).toBeDefined();
    expect(screen.getByRole('heading', { name: /pick a game/i })).toBeDefined();
    expect(screen.queryByRole('heading', { name: /invite your friends/i })).toBeNull();
  });
});

describe('RoomClient palette claim (spec 0063)', () => {
  it('surfaces a lost-race claim error inline and re-syncs the roster', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));
    listMembers.mockResolvedValue([
      {
        playerId: 'p1',
        isHost: true,
        mode: 'interactive',
        nickname: 'Ada',
        connected: true,
        paletteId: 'ember',
      },
    ]);
    // The server refuses the claim (another member won the race).
    hoisted.setPalette.mockRejectedValueOnce(
      new RoomApiError(409, 'palette_taken', 'Someone just took that palette. Pick another.'),
    );

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} />);
    // Let the initial roster poll settle, then claim.
    await waitFor(() => expect(listMembers).toHaveBeenCalled());
    const callsBefore = listMembers.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: /claim grape/i }));

    // The error surfaces inline in the picker (not the top-of-page loadError)...
    expect(await screen.findByText(/palette_error: someone just took that palette/i)).toBeDefined();
    expect(hoisted.setPalette).toHaveBeenCalledWith('ABC12', 'grape');
    // ...and the roster is re-fetched from the authority so the optimistic claim is corrected.
    await waitFor(() => expect(listMembers.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});
