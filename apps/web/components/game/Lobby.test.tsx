import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultTriviaConfig } from '../../lib/trivia-config';
import { defaultLiarLiarConfig } from '../../lib/games/liar-liar/config';
import type { RoomMember, RoomView } from '../../lib/room-api';
import { Lobby } from './Lobby';

const room: RoomView = {
  id: 'r1',
  code: 'ABC12',
  shareLink: '/join?code=ABC12',
  status: 'lobby',
  selectedGame: null,
  hostAccountId: 'acct1',
};

function hostMember(mode: 'interactive' | 'remote'): RoomMember {
  return {
    sessionId: 'sess_host',
    playerId: 'pid_host',
    role: 'player',
    isHost: true,
    mode,
    nickname: 'Ada',
    connected: true,
  };
}

function renderLobby(props: Partial<Parameters<typeof Lobby>[0]>) {
  return render(
    <Lobby
      room={room}
      members={[hostMember('interactive')]}
      role="player"
      mode="interactive"
      isHost
      me="pid_host"
      game="trivia"
      onGameChange={() => {}}
      config={defaultTriviaConfig()}
      onConfigChange={() => {}}
      onStart={() => {}}
      starting={false}
      startError={null}
      onModeChange={() => {}}
      onKick={() => {}}
      {...props}
    />,
  );
}

describe('Lobby', () => {
  it('badges the host row with its mode so the roster shows who holds the viewer', () => {
    renderLobby({ members: [hostMember('interactive')] });
    expect(screen.getByText('Host - Interactive')).toBeDefined();
  });

  it('reflects a remote host in the roster badge', () => {
    renderLobby({ members: [hostMember('remote')], mode: 'remote' });
    expect(screen.getByText('Host - Remote')).toBeDefined();
  });

  it('tells a solo remote host to switch itself to interactive to start', () => {
    // A remote host with no other viewer is the only viewer-capable device: the blocked-start copy
    // must point at the host's own toggle, not "wait for a viewer".
    renderLobby({ members: [hostMember('remote')], mode: 'remote' });
    expect(screen.getByText(/Switch yourself to Interactive/)).toBeDefined();
    expect(screen.queryByText(/Waiting for a viewer/)).toBeNull();
  });

  it('does not block an interactive host on a viewer (the host is one)', () => {
    // An interactive host is itself a viewer, so start is not blocked and neither blocked-copy
    // variant appears.
    renderLobby({ members: [hostMember('interactive')], mode: 'interactive' });
    expect(screen.queryByText(/Switch yourself to Interactive/)).toBeNull();
    expect(screen.queryByText(/Waiting for a viewer/)).toBeNull();
  });

  it('lets the host pick a game and shows that game config panel', () => {
    const onGameChange = vi.fn();
    // The picker offers both registered games.
    renderLobby({ onGameChange });
    expect(screen.getByRole('button', { name: 'Trivia' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Liar Liar' }));
    expect(onGameChange).toHaveBeenCalledWith('liar-liar');
  });

  it('renders the selected game config panel (Liar Liar)', () => {
    renderLobby({ game: 'liar-liar', config: defaultLiarLiarConfig() });
    // Liar Liar's config panel, not Trivia's category select.
    expect(screen.getByRole('button', { name: /random \(all\)/i })).toBeDefined();
    expect(screen.getByText(/Bluff your friends/i)).toBeDefined();
  });

  it('disables Start and does not fire onStart when the selected game config is invalid', () => {
    // The Start gate moved here from the deleted HostConfigPanel: an out-of-range config blocks it.
    const onStart = vi.fn();
    renderLobby({ game: 'liar-liar', config: { categories: 'random', rounds: 0 }, onStart });
    const start = screen.getByRole('button', { name: /start game/i });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('enables Start and fires onStart when the config is valid', () => {
    const onStart = vi.fn();
    renderLobby({ game: 'liar-liar', config: defaultLiarLiarConfig(), onStart });
    const start = screen.getByRole('button', { name: /start game/i });
    expect((start as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalled();
  });

  it('gates Start on an invalid Trivia config too', () => {
    const onStart = vi.fn();
    renderLobby({ game: 'trivia', config: { ...defaultTriviaConfig(), rounds: 0 }, onStart });
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));
    expect(onStart).not.toHaveBeenCalled();
  });
});
