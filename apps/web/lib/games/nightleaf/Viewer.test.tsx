import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { NightleafViewer } from './Viewer';
import { NightleafRemote } from './Remote';
import type { NightleafSim } from './protocol';

function sim(overrides: Partial<NightleafSim> = {}): NightleafSim {
  return {
    tier: 2,
    finalTier: 4,
    buds: 3,
    maxBuds: 3,
    fireflies: 1,
    trunk: [4, 12],
    top: 12,
    hands: [
      { player: 'a', nickname: 'Ada', count: 1 },
      { player: 'b', nickname: 'Bo', count: 2 },
    ],
    leavesLeft: 3,
    hushProposers: [],
    over: false,
    won: false,
    phase: 'playing',
    lastMisplay: null,
    ...overrides,
  };
}

function stateWith(over: Partial<GameState>): GameState {
  return { ...initialGameState('a'), phase: 'collecting', joined: true, ...over };
}

describe('NightleafViewer (the shared grove)', () => {
  it('renders the trunk, buds, tier, and per-player leaf COUNTS - never a leaf value', () => {
    const { container } = render(<NightleafViewer state={stateWith({ sim: sim() })} me="a" />);
    // The trunk shows the played leaves in order.
    const trunk = screen.getByRole('list', { name: /leaves played on the trunk/i });
    expect(within(trunk).getByText('4')).toBeDefined();
    expect(within(trunk).getByText('12')).toBeDefined();
    // The grove shows counts, not values.
    const grove = screen.getByRole('list', { name: /players and their remaining leaf counts/i });
    expect(within(grove).getByText(/Ada/)).toBeDefined();
    expect(within(grove).getByText(/1 leaf/)).toBeDefined();
    expect(within(grove).getByText(/2 leaves/)).toBeDefined();
    // Secrecy at the UI: the shared viewer never carries another player's secret leaf values. The
    // played trunk (4, 12) is public; no unplayed hand value can appear here because the sim has none.
    expect(within(grove).queryByText('7')).toBeNull();
    expect(within(grove).queryByText('90')).toBeNull();
    void container;
  });

  it('flashes the misplay banner with the offending order', () => {
    render(
      <NightleafViewer
        state={stateWith({
          sim: sim({ phase: 'misplay', buds: 2, lastMisplay: { played: 40, lowestHeld: 9 } }),
        })}
        me="a"
      />,
    );
    // The banner Badge and the sr-only status both carry the misplay - assert at least one is present.
    expect(screen.getAllByText(/Out of order/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/40 beat 9/i)).toBeDefined();
  });

  it('shows the win screen when the grove clears the final tier', () => {
    render(
      <NightleafViewer
        state={stateWith({ sim: sim({ over: true, won: true, phase: 'won' }) })}
        me="a"
      />,
    );
    expect(screen.getAllByText(/The grove wins/i).length).toBeGreaterThan(0);
  });
});

describe('NightleafRemote (the private controller)', () => {
  it("shows THIS player's own hand from state.private, and no one else's leaves", () => {
    // The reducer already targeted this device's own hand into state.private (spec 0052).
    const state = stateWith({ sim: sim(), private: { leaves: [7, 55, 90], lowest: 7 } });
    render(<NightleafRemote state={state} me="a" onMove={vi.fn()} onVote={vi.fn()} />);
    const hand = screen.getByRole('list', { name: /your hand, lowest first/i });
    expect(within(hand).getByText('7')).toBeDefined();
    expect(within(hand).getByText('55')).toBeDefined();
    expect(within(hand).getByText('90')).toBeDefined();
    // The play button names this player's own lowest leaf.
    expect(screen.getByRole('button', { name: /Play your lowest \(7\)/i })).toBeDefined();
  });

  it('submits a play move for the player own lowest leaf', () => {
    const onMove = vi.fn();
    const state = stateWith({ round: 1, sim: sim(), private: { leaves: [7], lowest: 7 } });
    render(<NightleafRemote state={state} me="a" onMove={onMove} onVote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Play your lowest/i }));
    expect(onMove).toHaveBeenCalledWith(1, '{"kind":"play"}');
  });

  it('offers a hush when a firefly is available and submits it', () => {
    const onMove = vi.fn();
    const state = stateWith({
      round: 1,
      sim: sim({ fireflies: 1 }),
      private: { leaves: [7], lowest: 7 },
    });
    render(<NightleafRemote state={state} me="a" onMove={onMove} onVote={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Propose a hush/i }));
    expect(onMove).toHaveBeenCalledWith(1, '{"kind":"hush"}');
  });

  it('holds input during a banner beat (a tier-cleared / misplay pause)', () => {
    const state = stateWith({
      sim: sim({ phase: 'tier-cleared' }),
      private: { leaves: [7], lowest: 7 },
    });
    render(<NightleafRemote state={state} me="a" onMove={vi.fn()} onVote={vi.fn()} />);
    const play = screen.getByRole('button', { name: /Play your lowest/i }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
  });
});
