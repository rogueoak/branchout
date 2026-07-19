import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultTriviaConfig } from '../../lib/games/trivia/config';
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

function hostMember(mode: 'viewer' | 'interactive' | 'remote'): RoomMember {
  return {
    sessionId: 'sess_host',
    playerId: 'pid_host',
    isHost: true,
    mode,
    nickname: 'Ada',
    connected: true,
  };
}

/** A non-host member in a given mode, for player-count / roster tests. */
function member(id: string, mode: 'viewer' | 'interactive' | 'remote'): RoomMember {
  return {
    sessionId: `sess_${id}`,
    playerId: `pid_${id}`,
    isHost: false,
    mode,
    nickname: id,
    connected: true,
  };
}

function renderLobby(props: Partial<Parameters<typeof Lobby>[0]>) {
  return render(
    <Lobby
      room={room}
      members={[hostMember('interactive')]}
      mode="interactive"
      isHost
      me="pid_host"
      game="trivia"
      onChangeGame={() => {}}
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

  it('offers the invite affordance: the room code as a link into the join URL', () => {
    renderLobby({});
    expect(screen.getByText(/invite friends/i)).toBeDefined();
    // ShareLink shows the code as the link text, resolving to the absolute join URL after mount.
    const link = screen.getByRole('link', { name: 'ABC12' });
    expect(link.getAttribute('href')).toContain('code=ABC12');
    // The copy control is an icon button, not the word "Copy".
    expect(screen.getByRole('button', { name: /copy join link/i })).toBeDefined();
  });

  it('reflects a remote host in the roster badge', () => {
    renderLobby({ members: [hostMember('remote')], mode: 'remote' });
    expect(screen.getByText('Host - Remote')).toBeDefined();
  });

  it('tells a solo remote host to switch itself so there is a screen to start', () => {
    // A remote host with no display device is the only device that could show the game: the
    // blocked-start copy must point at the host's own mode, not "wait for someone".
    renderLobby({ members: [hostMember('remote')], mode: 'remote' });
    expect(screen.getByText(/switch yourself to Viewer or Interactive/i)).toBeDefined();
    expect(screen.queryByText(/Waiting for a screen/)).toBeNull();
  });

  it('does not block an interactive host on a screen (the host is one)', () => {
    // An interactive host is itself a display, so start is not blocked and no blocked-copy appears.
    renderLobby({ members: [hostMember('interactive')], mode: 'interactive' });
    expect(screen.queryByText(/switch yourself/i)).toBeNull();
    expect(screen.queryByText(/Waiting for a screen/)).toBeNull();
  });

  it('shows the selected game detail card and a Change game button (selection moved to the picker)', () => {
    const onChangeGame = vi.fn();
    renderLobby({ game: 'trivia', onChangeGame });
    // The chosen game is shown as a detail card (name + summary), not a row of title buttons.
    expect(screen.getByRole('heading', { name: 'Trivia' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /change game/i }));
    expect(onChangeGame).toHaveBeenCalled();
  });

  it('renders the selected game config panel and detail card (Liar Liar)', () => {
    renderLobby({ game: 'liar-liar', config: defaultLiarLiarConfig() });
    // Liar Liar's config panel, not Trivia's category select.
    expect(screen.getByRole('button', { name: /random \(all\)/i })).toBeDefined();
    // The detail card carries the game's tagline.
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

  it('enables Start and fires onStart when the config is valid and the player minimum is met', () => {
    const onStart = vi.fn();
    // Liar Liar needs 2 players (spec 0050), so a lone host does not meet the minimum - add one.
    renderLobby({
      game: 'liar-liar',
      members: [hostMember('interactive'), member('bo', 'remote')],
      config: defaultLiarLiarConfig(),
      onStart,
    });
    const start = screen.getByRole('button', { name: /start game/i });
    expect((start as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalled();
  });

  it('blocks Start below a game player minimum, naming the minimum (Liar Liar needs 2)', () => {
    const onStart = vi.fn();
    // A lone interactive host: a screen is present, config is valid, but only 1 player < min 2.
    renderLobby({ game: 'liar-liar', config: defaultLiarLiarConfig(), onStart });
    const start = screen.getByRole('button', { name: /start game/i });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/needs at least 2 players/i)).toBeDefined();
    fireEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('offers the three modes and disables the playing modes when the game is full', () => {
    // Teeter Tower caps at 4 players. Fill it with 4 remotes; a viewer host cannot take a 5th seat.
    const onModeChange = vi.fn();
    renderLobby({
      game: 'teeter-tower',
      mode: 'viewer',
      members: [
        hostMember('viewer'),
        member('a', 'remote'),
        member('b', 'remote'),
        member('c', 'remote'),
        member('d', 'remote'),
      ],
      onModeChange,
    });
    // Your mode is collapsed by default - expand it to reach the picker.
    fireEvent.click(screen.getByRole('button', { name: /your mode/i }));
    // The picker offers Viewer / Interactive / Remote.
    expect(screen.getByRole('radio', { name: /viewer/i })).toBeDefined();
    const interactive = screen.getByRole('radio', { name: /interactive/i }) as HTMLButtonElement;
    const remote = screen.getByRole('radio', { name: /remote/i }) as HTMLButtonElement;
    expect(interactive.disabled).toBe(true);
    expect(remote.disabled).toBe(true);
    // Viewer stays available.
    fireEvent.click(screen.getByRole('radio', { name: /viewer/i }));
    expect(onModeChange).toHaveBeenCalledWith('viewer');
  });

  it('gates Start on an invalid Trivia config too', () => {
    const onStart = vi.fn();
    renderLobby({ game: 'trivia', config: { ...defaultTriviaConfig(), rounds: 0 }, onStart });
    fireEvent.click(screen.getByRole('button', { name: /start game/i }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('collapses Your mode by default, showing the current selection on the trigger', () => {
    renderLobby({ mode: 'interactive' });
    // The trigger reads "Your mode" and carries the current mode so a collapsed state still informs.
    const trigger = screen.getByRole('button', { name: /your mode/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toMatch(/interactive/i);
    // Collapsed means the mode radios are not rendered until the section is expanded.
    expect(screen.queryByRole('radio', { name: /viewer/i })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole('radio', { name: /viewer/i })).toBeDefined();
  });

  it('renders Game setup above Your mode', () => {
    renderLobby({});
    const setup = screen.getByRole('heading', { name: /game setup/i });
    const yourMode = screen.getByRole('button', { name: /your mode/i });
    // A preceding node comes first in document order (bitmask 4 = DOCUMENT_POSITION_FOLLOWING).
    expect(setup.compareDocumentPosition(yourMode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the Advanced settings accordion when the game supplies no advanced content', () => {
    // Every game today supplies no advanced content, so the disclosure must not render (no empty
    // drawer). The prop is left unset here to model that default.
    renderLobby({});
    expect(screen.queryByRole('button', { name: /advanced settings/i })).toBeNull();
  });

  it('renders the Advanced settings accordion (collapsed) when advanced content is provided', () => {
    // A later workstream passes the game's advanced knobs via the `advanced` slot; model that with a
    // dummy node. The accordion appears, collapsed, below the standard config and above Your mode.
    renderLobby({ advanced: <p>Shuffle seed 42</p> });
    const advanced = screen.getByRole('button', { name: /advanced settings/i });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    // Collapsed: Radix unmounts the content until it is opened.
    expect(screen.queryByText('Shuffle seed 42')).toBeNull();
    // Ordering: after Game setup's standard config heading, before Your mode.
    const setup = screen.getByRole('heading', { name: /game setup/i });
    const yourMode = screen.getByRole('button', { name: /your mode/i });
    expect(setup.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      advanced.compareDocumentPosition(yourMode) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Opening it reveals the provided content.
    fireEvent.click(advanced);
    expect(screen.getByText('Shuffle seed 42')).toBeDefined();
  });

  it('shows the forced-viewer reason while Your mode stays collapsed (never buried in the drawer)', () => {
    // Teeter Tower caps at 4. Fill it with 4 remotes and make the host a viewer who cannot take a
    // 5th playing seat: the explanation must be visible even though Your mode is collapsed, since
    // Radix unmounts collapsed content and the live region would otherwise never announce.
    renderLobby({
      game: 'teeter-tower',
      mode: 'viewer',
      members: [
        hostMember('viewer'),
        member('a', 'remote'),
        member('b', 'remote'),
        member('c', 'remote'),
        member('d', 'remote'),
      ],
    });
    // Your mode is still collapsed (radios not mounted)...
    expect(screen.getByRole('button', { name: /your mode/i }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByRole('radio', { name: /viewer/i })).toBeNull();
    // ...yet the reason is visible.
    expect(screen.getByText(/this game is full at 4 players/i)).toBeDefined();
  });
});
