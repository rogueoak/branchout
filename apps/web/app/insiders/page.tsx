import type { Metadata } from 'next';
import { getViewer } from '../../lib/session';
import { InsidersHome } from './InsidersHome';

// The insiders surface index (spec 0035): a list of in-development games a beta tester can try.
// Empty for now - games are added under this tree by later specs. Gated by the layout; the viewer is
// read server-side so the shared top nav renders without an auth flash. Noindex: it is private and
// only ever reached via the gated insiders subdomain.
export const metadata: Metadata = {
  title: 'Insiders - Branch Out Games',
  robots: { index: false, follow: false },
};

export default async function InsidersPage() {
  const viewer = await getViewer();
  return <InsidersHome viewer={viewer} />;
}
