import { describe, expect, it } from 'vitest';
import { shareCardFor } from './share-card';

describe('shareCardFor', () => {
  it('maps trivia to the trivia share card', () => {
    expect(shareCardFor('trivia')).toEqual({
      image: '/share-trivia.png',
      alt: 'Join my Branch Out trivia game',
    });
  });

  it('maps liarliar to the Liar Liar share card', () => {
    expect(shareCardFor('liarliar')).toEqual({
      image: '/share-liarliar.png',
      alt: 'Join my Branch Out Liar Liar game',
    });
  });

  it.each([null, undefined, '', 'unknown-game'])(
    'falls back to the generic invite card for %s',
    (game) => {
      expect(shareCardFor(game)).toEqual({
        image: '/share-join.png',
        alt: 'Join my Branch Out game',
      });
    },
  );

  it('uses ASCII-only alt text (Trellis language rule)', () => {
    for (const game of ['trivia', 'liarliar', null]) {
      // eslint-disable-next-line no-control-regex
      expect(shareCardFor(game).alt).toMatch(/^[\x00-\x7F]+$/);
    }
  });
});
