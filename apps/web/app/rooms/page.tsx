import { RoomsHome } from './RoomsHome';
import { getViewer } from '../../lib/session';
import { getSurface } from '../../lib/surface';

// The rooms home page. The client component handles the session-dependent host/join actions. A
// `?game=<slug>` query is the "Start a game" deep link from a game feature page (spec 0030): the
// host creates a room pre-selected to that game and skips the pick step (spec 0029). The viewer is
// read server-side so the shared top nav (spec 0028) renders without an auth flash. The surface
// (feedback 0028) is read from the host so this one page serves both the apex and the insider
// subdomain (which rewrites into `/insider/rooms`), gating the insider-only deep link by site.
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game } = await searchParams;
  const [viewer, surface] = await Promise.all([getViewer(), getSurface()]);
  return <RoomsHome initialGame={game} viewer={viewer} surface={surface} />;
}
