import { LandingContent } from '../components/LandingContent';
import { getSignedIn } from '../lib/session';

// Home page: the Branch out marketing landing page (spec 0005). Server-rendered so the
// signed-in vs anonymous CTA swap happens before the first byte, with no layout shift. The
// session read lives in ../lib/session so it stays unit-testable (a Next.js page file may only
// export the default component and route config).
export default async function HomePage() {
  const signedIn = await getSignedIn();
  return <LandingContent signedIn={signedIn} />;
}
