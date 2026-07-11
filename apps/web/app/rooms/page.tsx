import { RoomsHome } from './RoomsHome';
import { getViewer } from '../../lib/session';

// The rooms home page. The client component handles the session-dependent host/join actions. A
// `?game=<slug>` query is the "Start a game" deep link from a game feature page (spec 0030): the
// host creates a room pre-selected to that game and skips the pick step (spec 0029). The viewer is
// read server-side so the shared top nav (spec 0028) renders without an auth flash.
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game } = await searchParams;
  const viewer = await getViewer();
  return <RoomsHome initialGame={game} viewer={viewer} />;
}
