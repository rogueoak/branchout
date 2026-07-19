import { vi } from 'vitest';

// Global jsdom shims for the browser APIs embla (canopy's Carousel, spec 0061) probes on init but
// jsdom omits: ResizeObserver + IntersectionObserver (the resize / slides-in-view trackers) and
// matchMedia (reduced-motion / breakpoint options). The landing page now embeds the hero carousel
// (spec 0067), so any test that renders it needs these present. embla does no real layout in jsdom
// (all boxes are 0), so these are inert no-ops - tests assert observable wiring, not snap math.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}
