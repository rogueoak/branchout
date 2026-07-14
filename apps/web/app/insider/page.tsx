import type { Metadata } from 'next';
import { getViewer } from '../../lib/session';
import { getSurface } from '../../lib/surface';
import { InsiderHome } from './InsiderHome';

// The insider surface index (spec 0035): a list of in-development games a beta tester can try.
// Empty for now - games are added under this tree by later specs. Gated by the layout; the viewer is
// read server-side so the shared top nav renders without an auth flash. Noindex: it is private and
// only ever reached via the gated insider subdomain.
export const metadata: Metadata = {
  title: 'Insider - Branch Out Games',
  robots: { index: false, follow: false },
};

export default async function InsiderPage() {
  const [viewer, surface] = await Promise.all([getViewer(), getSurface()]);
  return <InsiderHome viewer={viewer} surface={surface} />;
}
