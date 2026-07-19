import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeHeroCarousel, type HomeHeroSlide } from './HomeHeroCarousel';

// The carousel is built on canopy's embla Carousel; the browser APIs embla probes on init
// (ResizeObserver / IntersectionObserver / matchMedia) are shimmed globally in vitest.setup.ts.
// embla does no real layout in jsdom, so we assert observable wiring - the labelled region and each
// slide's link/href - not snap math or the dot pager (which needs a real snap list).
const SLIDES: HomeHeroSlide[] = [
  { slug: 'trivia', name: 'Trivia', art: '<svg aria-label="Branch out Trivia"></svg>' },
  { slug: 'liar-liar', name: 'Liar Liar', art: '<svg aria-label="Branch out Liar Liar"></svg>' },
];

describe('HomeHeroCarousel', () => {
  it('renders the labelled carousel region', () => {
    render(<HomeHeroCarousel slides={SLIDES} />);
    // getByRole throws if absent, so resolving the labelled region is the assertion.
    expect(screen.getByRole('region', { name: 'Featured games' })).toBeTruthy();
  });

  it('renders one slide link per game, pointing at the feature page', () => {
    render(<HomeHeroCarousel slides={SLIDES} />);
    const trivia = screen.getByRole('link', { name: 'Trivia - game details' });
    const liar = screen.getByRole('link', { name: 'Liar Liar - game details' });
    expect(trivia.getAttribute('href')).toBe('/games/trivia');
    expect(liar.getAttribute('href')).toBe('/games/liar-liar');
  });

  it('hides the decorative hero art from the accessibility tree (the link carries the name)', () => {
    render(<HomeHeroCarousel slides={[SLIDES[0]!]} />);
    const link = screen.getByRole('link', { name: 'Trivia - game details' });
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
