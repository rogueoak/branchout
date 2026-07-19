import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Capture the `plugins` prop the carousel receives without standing up embla: mock canopy's Carousel
// to record it. This is the only place the autoplay-vs-reduced-motion decision is observable - embla
// does no real layout in jsdom, so it cannot be proven by rotation. A hoisted holder is used because
// vi.mock factories run before module imports.
const captured = vi.hoisted(() => ({ plugins: undefined as unknown[] | undefined }));

vi.mock('@rogueoak/canopy/branches', () => ({
  Carousel: (props: { plugins?: unknown[]; children?: unknown }) => {
    captured.plugins = props.plugins;
    return props.children;
  },
  CarouselContent: (props: { children?: unknown }) => props.children,
  CarouselItem: (props: { children?: unknown }) => props.children,
  CarouselDots: () => null,
}));

// A sentinel autoplay plugin so a passed plugin is identifiable and the lazy-init ref is truthy.
vi.mock('embla-carousel-autoplay', () => ({ default: () => ({ name: 'autoplay' }) }));

import { HomeHeroCarousel } from './HomeHeroCarousel';

const SLIDES = [
  { slug: 'trivia', name: 'Trivia', artPortrait: '<svg></svg>', artLandscape: '<svg></svg>' },
];

function stubReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('HomeHeroCarousel autoplay wiring', () => {
  afterEach(() => {
    captured.plugins = undefined;
  });

  it('passes the autoplay plugin when motion is allowed', () => {
    stubReducedMotion(false);
    render(<HomeHeroCarousel slides={SLIDES} />);
    expect(captured.plugins).toHaveLength(1);
  });

  it('drops the autoplay plugin under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(<HomeHeroCarousel slides={SLIDES} />);
    expect(captured.plugins).toHaveLength(0);
  });
});
