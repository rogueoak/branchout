// Client boundary: the carousel is built on canopy's embla `Carousel` (spec 0061) - a stateful,
// hook-driven client component - plus the `embla-carousel-autoplay` plugin. It owns its own
// `use client` boundary so the landing page's server read stays server-side.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Autoplay from 'embla-carousel-autoplay';
import { Carousel, CarouselContent, CarouselDots, CarouselItem } from '@rogueoak/canopy/branches';
import { featurePath } from '../../lib/games/catalog';

/** One carousel slide: a public game, its display name, and the portrait hero SVG string to show. */
export interface HomeHeroSlide {
  slug: string;
  name: string;
  /** Inline portrait (3:4) hero SVG string. */
  art: string;
}

interface HomeHeroCarouselProps {
  slides: HomeHeroSlide[];
}

// Stable references: a new `opts` object or `plugins` array on each render would re-init embla
// (resetting position and autoplay), so the loop options are a module constant and the plugin lives
// in a ref, folded into a memoized array keyed only on the reduced-motion flag.
const CAROUSEL_OPTS = { loop: true } as const;

/**
 * HomeHeroCarousel - the landing page's hero: a rotating strip of one portrait card per public game
 * (spec 0067). Auto-advances every 5s via the autoplay plugin (paused on hover / focus / while
 * dragging), supports swipe and the `CarouselDots` pager, and each slide is a link to that game's
 * feature page. Honors `prefers-reduced-motion` by dropping the autoplay plugin, so the carousel
 * holds still and is driven only by swipe / dots for players who ask for less motion.
 */
export function HomeHeroCarousel({ slides }: HomeHeroCarouselProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const autoplay = useRef(
    Autoplay({
      delay: 5000,
      stopOnMouseEnter: true,
      stopOnFocusIn: true,
      stopOnInteraction: false,
    }),
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const plugins = useMemo(() => (reducedMotion ? [] : [autoplay.current]), [reducedMotion]);

  return (
    <div className="mx-auto w-full max-w-xs">
      <Carousel opts={CAROUSEL_OPTS} plugins={plugins} aria-label="Featured games">
        <CarouselContent>
          {slides.map((slide) => (
            <CarouselItem key={slide.slug}>
              <a
                href={featurePath(slide.slug)}
                aria-label={`${slide.name} - game details`}
                className="block overflow-hidden rounded-2xl transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                {/* The portrait hero art is decorative here - the link carries the accessible name -
                    so the injected SVG (which has its own role/label) is hidden from the a11y tree. */}
                <div
                  aria-hidden="true"
                  className="aspect-[3/4] w-full overflow-hidden bg-[#0d0a15] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: slide.art }}
                />
              </a>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselDots className="mt-5" />
      </Carousel>
    </div>
  );
}
