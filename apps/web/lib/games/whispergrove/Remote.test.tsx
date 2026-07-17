import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialGameState, type GameState } from '../../game-state';
import { WhispergroveRemote } from './Remote';
import type { LeafRole } from './protocol';

const SEATS = [
  { player: 'p0', team: 'violet', role: 'whisperer' },
  { player: 'p1', team: 'amber', role: 'whisperer' },
  { player: 'p2', team: 'violet', role: 'seeker' },
  { player: 'p3', team: 'amber', role: 'seeker' },
];

function baseLeaves() {
  return Array.from({ length: 25 }, (_, i) => ({
    index: i,
    word: `W${i}`,
    revealed: false,
    shown: null,
  }));
}

function stateWith(sim: Record<string, unknown>, priv: unknown = null): GameState {
  return { ...initialGameState('p0'), phase: 'collecting', sim, private: priv, standings: [] };
}

const whisperingSim = {
  leaves: baseLeaves(),
  turn: 'violet',
  phase: 'whispering',
  whisper: null,
  guessesLeft: 0,
  violetLeft: 9,
  amberLeft: 8,
  winner: null,
  endReason: null,
  seats: SEATS,
};

describe('WhispergroveRemote', () => {
  it('the Whisperer can compose a whisper on their turn and it is sent via onMove', () => {
    const onMove = vi.fn();
    render(
      <WhispergroveRemote
        state={stateWith(whisperingSim, {
          key: Array.from({ length: 25 }, () => 'sapling' as LeafRole),
        })}
        me="p0"
        onMove={onMove}
        onVote={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Whisper word'), { target: { value: 'canopy' } });
    fireEvent.change(screen.getByLabelText('Whisper count'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Whisper' }));
    expect(onMove).toHaveBeenCalledWith(
      0,
      JSON.stringify({ kind: 'whisper', word: 'canopy', count: 2 }),
    );
  });

  it('a seeker can tap a leaf during their grove guessing turn', () => {
    const onMove = vi.fn();
    const guessing = {
      ...whisperingSim,
      phase: 'guessing',
      whisper: { word: 'canopy', count: 2, team: 'violet' },
      guessesLeft: 3,
    };
    render(
      <WhispergroveRemote
        state={{ ...stateWith(guessing), player: 'p2' }}
        me="p2"
        onMove={onMove}
        onVote={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tap W5' }));
    expect(onMove).toHaveBeenCalledWith(0, JSON.stringify({ kind: 'tap', index: 5 }));
  });

  it('shows the winner banner from this grove vantage when the game is over', () => {
    const over = { ...whisperingSim, phase: 'over', winner: 'violet', endReason: 'cleared' };
    render(
      <WhispergroveRemote state={stateWith(over)} me="p0" onMove={() => {}} onVote={() => {}} />,
    );
    expect(screen.getByText('Your grove wins!')).toBeTruthy();
  });
});
