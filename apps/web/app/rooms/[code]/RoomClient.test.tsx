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
  recalled: null as Membership | null,
}));
const { getRoom, listMembers } = hoisted;

vi.mock('../../../lib/room-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/room-api')>();
  return {
    ...actual,
    getRoom: (code: string) => hoisted.getRoom(code),
    listMembers: (code: string) => hoisted.listMembers(code),
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

// The engine socket is out of scope for this transition test; stub the hook.
vi.mock('../../../lib/use-game-client', () => ({
  useGameClient: () => ({
    state: { connection: 'connecting', joined: false, phase: 'configuring', paused: false },
    submitAnswer: vi.fn(),
    raiseDispute: vi.fn(),
    castBallot: vi.fn(),
  }),
}));

vi.mock('../../../components/game/Lobby', () => ({ Lobby: () => <div>LOBBY_VIEW</div> }));
vi.mock('../../../components/game/GameStage', () => ({ GameStage: () => <div>GAME_VIEW</div> }));

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

beforeEach(() => {
  getRoom.mockReset();
  listMembers.mockReset();
  listMembers.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RoomClient non-host transitions on the room-status poll', () => {
  it('moves a non-host from the lobby into the game when the host starts it', async () => {
    hoisted.recalled = nonHostMembership('lobby');
    getRoom.mockResolvedValue(roomAt('running'));

    render(<RoomClient code="ABC12" />);

    // Starts in the lobby (the recalled status), then the poll observes `running` and enters.
    expect(screen.getByText('LOBBY_VIEW')).toBeDefined();
    await waitFor(() => expect(screen.getByText('GAME_VIEW')).toBeDefined());
    expect(getRoom).toHaveBeenCalledWith('ABC12');
  });

  it('returns a non-host to the lobby when the host exits the game', async () => {
    hoisted.recalled = nonHostMembership('running');
    getRoom.mockResolvedValue(roomAt('lobby'));

    render(<RoomClient code="ABC12" />);

    // Starts in the game (recalled `running`), then the poll observes the exit and returns.
    expect(screen.getByText('GAME_VIEW')).toBeDefined();
    await waitFor(() => expect(screen.getByText('LOBBY_VIEW')).toBeDefined());
  });
});
