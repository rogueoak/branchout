import { describe, expect, it } from 'vitest';
import { generateMetadata } from './page';

describe('game feature page route', () => {
  it('generates per-game metadata and a not-found title for an unknown slug', async () => {
    const trivia = await generateMetadata({ params: Promise.resolve({ slug: 'trivia' }) });
    expect(String(trivia.title)).toContain('Trivia');
    const missing = await generateMetadata({ params: Promise.resolve({ slug: 'nope' }) });
    expect(String(missing.title)).toContain('not found');
  });
});
