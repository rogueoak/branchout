import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The provider boots analytics and captures a pageview on mount + every route change (spec 0032).
// Mock the router hooks and the analytics module so we assert the seam, not PostHog.
vi.mock('next/navigation', () => ({
  usePathname: () => '/games',
  useSearchParams: () => new URLSearchParams('cat=trivia'),
}));
vi.mock('../lib/analytics', () => ({ initAnalytics: vi.fn(), capturePageview: vi.fn() }));

import { capturePageview, initAnalytics } from '../lib/analytics';
import { AnalyticsProvider } from './AnalyticsProvider';

describe('AnalyticsProvider', () => {
  it('initializes analytics and captures the first pageview on mount (absolute url from path + query)', () => {
    render(<AnalyticsProvider />);
    expect(initAnalytics).toHaveBeenCalled();
    // The landing pageview must fire, not just later route changes; url = origin + path + query.
    expect(capturePageview).toHaveBeenCalledWith(`${window.location.origin}/games?cat=trivia`);
  });
});
