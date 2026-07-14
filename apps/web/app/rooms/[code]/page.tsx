import { RoomClient } from './RoomClient';
import { getViewer } from '../../../lib/session';
import { getSurface } from '../../../lib/surface';

// The room page. A thin server wrapper: it resolves the dynamic `code` and the `?step=` query (the
// host's create-flow setup step, spec 0029) and hands off to the client orchestrator, which owns the
// setup wizard, the lobby, the engine connection, and the in-game stage. The viewer is read
// server-side so the shared top nav (spec 0028) renders without an auth flash in the lobby/setup.
// The surface (feedback 0028) is read from the host so the picker offers insider-only games only on
// the insider subdomain (which rewrites this route into `/insider/rooms/[code]`).
export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { code } = await params;
  const { step } = await searchParams;
  const [viewer, surface] = await Promise.all([getViewer(), getSurface()]);
  return <RoomClient code={code} initialStep={step} viewer={viewer} surface={surface} />;
}
