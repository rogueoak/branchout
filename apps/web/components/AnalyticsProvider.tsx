'use client';

// Boots analytics (spec 0032) and captures a pageview on every App Router route change. Rendered once
// in the root layout. Everything it calls is a no-op unless analytics is enabled (production + key),
// so this is inert in dev/test/CI. Renders nothing.

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { capturePageview, initAnalytics } from '../lib/analytics';

// useSearchParams() must sit under a Suspense boundary in the App Router, so the pageview tracker is
// its own child; the parent only initializes the client.
function Pageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const qs = searchParams?.toString();
    capturePageview(`${window.location.origin}${pathname}${qs ? `?${qs}` : ''}`);
  }, [pathname, searchParams]);

  return null;
}

export function AnalyticsProvider() {
  useEffect(() => {
    initAnalytics();
  }, []);

  return (
    <Suspense fallback={null}>
      <Pageview />
    </Suspense>
  );
}
