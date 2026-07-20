import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeHeroCarousel, type HomeHeroSlide } from './HomeHeroCarousel';

// The carousel is built on canopy's embla Carousel; the browser APIs embla probes on init
// (ResizeObserver / IntersectionObserver / matchMedia) are shimmed globally in vitest.setup.ts.
// embla does no real layout in jsdom, so we assert observable wiring - the labelled region and each
// slide's link/href - not snap math or the dot pager (which needs a real snap list).
const SLIDES: HomeHeroSlide[] = [
  { slug: 'trivia', name: 'Trivia', artPortrait: '<svg></svg>', artLandscape: '<svg></svg>' },
  { slug: 'liar-liar', name: 'Liar Liar', artPortrait: '<svg></svg>', artLandscape: '<svg></svg>' },
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

  it('pads the slide track vertically so a hover-scaled or focused card is not clipped by the viewport overflow', () => {
    // The card scales up on hover and shows a ring on focus; canopy's viewport is `overflow-hidden`,
    // so without vertical padding on the track the card's top/bottom border is clipped. Assert the
    // track (the flex parent of the slides) carries a `py-*` class that reserves that clearance.
    render(<HomeHeroCarousel slides={SLIDES} />);
    const track = screen.getByRole('link', { name: 'Trivia - game details' }).closest('div.flex');
    expect(track).not.toBeNull();
    // Require a base-level, non-zero `py-*` (e.g. `py-3`): the leading `(^|\s)` boundary excludes a
    // responsive-only `md:py-3` that would leave phones clipped, and `[1-9]` excludes `py-0` (zero
    // clearance) - either would defeat the fix yet pass a looser `\bpy-\d`.
    expect(track!.className).toMatch(/(^|\s)py-[1-9]/);
  });

  it('hides the decorative hero art from the accessibility tree (the link carries the name)', () => {
    render(<HomeHeroCarousel slides={[SLIDES[0]!]} />);
    const link = screen.getByRole('link', { name: 'Trivia - game details' });
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
