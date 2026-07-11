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
    submitAnswer: vi.fn(),
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
  Lobby: ({ onChangeGame }: { onChangeGame: () => void }) => (
    <div>
      LOBBY_VIEW
      <button type="button" onClick={onChangeGame}>
        Change game
      </button>
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
    role: 'player',
    isHost: false,
    mode: 'remote',
    nickname: 'Bob',
    player: 'p2',
    room: roomAt(status),
  };
}

function hostMembership(status: string): Membership {
  return {
    role: 'player',
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

describe('RoomClient top nav (spec 0028)', () => {
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

  it('shows the invite step (room code) to a host at ?step=invite', async () => {
    hoisted.recalled = hostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" viewer={{ signedIn: false }} initialStep="invite" />);

    expect(await screen.findByRole('heading', { name: /invite your friends/i })).toBeDefined();
    // The invite affordance shows the room code (as a join link).
    expect(screen.getByRole('link', { name: 'ABC12' })).toBeDefined();
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
