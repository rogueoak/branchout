// Client boundary: the carousel is built on canopy's embla `Carousel` (spec 0061) - a stateful,
// hook-driven client component - plus the `embla-carousel-autoplay` plugin. It owns its own
// `use client` boundary so the landing page's server read stays server-side.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Autoplay from 'embla-carousel-autoplay';
import { Carousel, CarouselContent, CarouselDots, CarouselItem } from '@rogueoak/canopy/branches';
import { featurePath } from '../../lib/games/catalog';

/** One carousel slide: a public game, its display name, and its hero art in both shapes. */
export interface HomeHeroSlide {
  slug: string;
  name: string;
  /** Inline portrait (3:4) hero SVG string - shown on phones. */
  artPortrait: string;
  /** Inline wide (16:9) hero SVG string - shown from `md` up. */
  artLandscape: string;
}

interface HomeHeroCarouselProps {
  slides: HomeHeroSlide[];
}

// Stable references: a new `opts` object or `plugins` array on each render would re-init embla
// (resetting position and autoplay), so the loop options are a module constant and the plugin lives
// in a ref, folded into a memoized array keyed only on the reduced-motion flag.
// `align: 'center'` centers the active card so the prev/next cards peek at the left and right edges
// (each `CarouselItem` is a partial `basis` below full width); `loop` keeps neighbors present at
// every position so the peek never runs dry at an "end".
const CAROUSEL_OPTS = { loop: true, align: 'center' } as const;

/**
 * HomeHeroCarousel - the landing page's hero: a rotating strip of one portrait card per public game
 * (spec 0067). Auto-advances every 5s via the autoplay plugin, but the FIRST player interaction -
 * swipe, dot tap, or arrow key (`stopOnInteraction: true`) - hands control over and stops the
 * rotation for good, so the strip never yanks a card out from under a reaching finger on a phone
 * (WCAG 2.2.2 / mobile-first). It also pauses on hover / focus for pointer users. Honors
 * `prefers-reduced-motion` by dropping the autoplay plugin entirely, so it holds still from the
 * start and is driven only by swipe / dots. Each slide links to that game's feature page. On phones
 * the slide is a tall portrait (3:4) card; from `md` up it swaps to the wide (16:9) hero so it reads
 * as a landscape banner on desktop. The active card is centered with its neighbors peeking at the
 * left and right edges; a pair of edge-gradient overlays fade those peeking cards into the page
 * background so the strip reads as a focused hero rather than a flat filmstrip.
 */
export function HomeHeroCarousel({ slides }: HomeHeroCarouselProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  // Lazy singleton: `useRef(Autoplay(...))` would re-invoke the factory (allocating a throwaway
  // plugin) on every render even though React keeps only the first. Create it once, on first render.
  const autoplayRef = useRef<ReturnType<typeof Autoplay> | null>(null);
  if (!autoplayRef.current) {
    autoplayRef.current = Autoplay({
      delay: 5000,
      stopOnMouseEnter: true,
      stopOnFocusIn: true,
      stopOnInteraction: true,
    });
  }

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const plugins = useMemo(() => (reducedMotion ? [] : [autoplayRef.current!]), [reducedMotion]);

  return (
    <div className="mx-auto w-full max-w-sm md:max-w-3xl">
      <Carousel opts={CAROUSEL_OPTS} plugins={plugins} aria-label="Featured games">
        {/* The viewport is wrapped so the edge fades can sit over exactly the card strip (not the
            dots below). The overlays are decorative and let taps through to the peeking cards. */}
        <div className="relative">
          <CarouselContent>
            {slides.map((slide) => (
              // Each slide is narrower than the viewport so the prev/next cards peek at the edges:
              // ~10% of a neighbor on phones (basis-4/5), a smaller sliver for the wider landscape
              // banner at md+ (basis-5/6). The extra `pr-4` balances canopy's built-in `pl-4` gutter
              // so the padding is symmetric and the centered card peeks evenly on both sides.
              <CarouselItem key={slide.slug} className="basis-4/5 pr-4 md:basis-5/6">
                <a
                  href={featurePath(slide.slug)}
                  aria-label={`${slide.name} - game details`}
                  className="group relative block overflow-hidden rounded-lg border border-border transition-[transform,border-color] hover:scale-[1.02] hover:border-primary active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:rounded-2xl"
                >
                  {/* The hero art is decorative here - the link carries the accessible name - so the
                    injected SVG (which has its own role/label) is hidden from the a11y tree. Phones
                    get the tall 3:4 portrait; from md up the wide 16:9 hero reads as a banner. */}
                  <div
                    aria-hidden="true"
                    className="aspect-[3/4] w-full overflow-hidden bg-[#0d0a15] md:hidden [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: slide.artPortrait }}
                  />
                  <div
                    aria-hidden="true"
                    className="hidden aspect-[16/9] w-full overflow-hidden bg-[#0d0a15] md:block [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: slide.artLandscape }}
                  />
                  {/* A persistent "View game" cue so it reads as tappable on touch, where the hover
                    scale never fires. Decorative (the link already carries the name); it lifts a
                    touch on press and on hover for pointer users. */}
                  {/* Portrait centers the cue under the stacked wordmark; landscape moves it to the
                    bottom-left under the left-aligned wordmark, clear of the centered mark motif. */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-body-sm font-medium text-white/90 backdrop-blur-sm transition-colors group-hover:bg-white/20 md:bottom-6 md:left-8 md:translate-x-0"
                  >
                    View game
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </a>
              </CarouselItem>
            ))}
          </CarouselContent>
          {/* Edge fades: the peeking neighbors dissolve into the page background at both sides so the
              centered card stays the focus. Gradients run from the `bg` token to transparent and are
              decorative + non-interactive. Matching the viewport's rounded corners keeps them clean. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-12 rounded-l-md bg-gradient-to-r from-bg to-transparent md:w-20"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-md bg-gradient-to-l from-bg to-transparent md:w-20"
          />
        </div>
        <CarouselDots className="mt-5" />
      </Carousel>
    </div>
  );
}
