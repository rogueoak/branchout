import { describe, expect, it } from 'vitest';
import { detectFlips, turnPopupMessage } from './turn-notice';
import type { Cell } from './protocol';

describe('detectFlips (piece-flip animation trigger)', () => {
  it('reports only discs that changed from one color to the other', () => {
    const prev: Cell[] = ['violet', 'amber', 'empty', 'violet'];
    const next: Cell[] = ['violet', 'violet', 'empty', 'amber'];
    // index 1 (amber -> violet) and index 3 (violet -> amber) flipped; index 0 unchanged.
    expect(detectFlips(prev, next)).toEqual([1, 3]);
  });

  it('does NOT count a freshly placed disc (empty -> disc) as a flip', () => {
    const prev: Cell[] = ['empty', 'violet'];
    const next: Cell[] = ['amber', 'violet'];
    expect(detectFlips(prev, next)).toEqual([]);
  });

  it('does NOT count a disc that was removed (disc -> empty) as a flip', () => {
    const prev: Cell[] = ['amber'];
    const next: Cell[] = ['empty'];
    expect(detectFlips(prev, next)).toEqual([]);
  });

  it('returns no flips when the boards are identical', () => {
    const board: Cell[] = ['violet', 'amber', 'empty'];
    expect(detectFlips(board, board)).toEqual([]);
  });

  it('returns no flips when the board sizes differ (a skipped diff)', () => {
    expect(detectFlips(['violet'], ['violet', 'amber'])).toEqual([]);
  });
});

describe('turnPopupMessage (turn-start popup copy)', () => {
  it('says "Your turn" for the active player on a normal turn', () => {
    expect(turnPopupMessage({ isActive: true, passed: false, otherName: 'Amy' })).toBe('Your turn');
  });

  it('names the skipped opponent when the active player got an extra turn', () => {
    expect(turnPopupMessage({ isActive: true, passed: true, otherName: 'Amy' })).toBe(
      'Amy has no moves, your turn',
    );
  });

  it('tells the skipped player their turn was skipped', () => {
    expect(turnPopupMessage({ isActive: false, passed: true, otherName: 'Amy' })).toBe(
      'You have no moves, turn skipped',
    );
  });

  it('shows nothing for the waiting (non-active) player on a normal turn', () => {
    expect(turnPopupMessage({ isActive: false, passed: false, otherName: 'Amy' })).toBeNull();
  });
});
