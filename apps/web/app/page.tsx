import { LandingContent } from '../components/LandingContent';
import { getViewer } from '../lib/session';

// Home page: the Branch out marketing landing page (spec 0005). Server-rendered so the top nav and
// the signed-in vs anonymous CTA render correctly before the first byte, with no layout shift or
// auth flash. The session read lives in ../lib/session so it stays unit-testable (a Next.js page
// file may only export the default component and route config).
export default async function HomePage() {
  const viewer = await getViewer();
  return <LandingContent viewer={viewer} />;
}
