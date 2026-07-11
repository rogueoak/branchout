import { RoomsHome } from './RoomsHome';

// The rooms home page. The client component handles the session-dependent host/join actions. A
// `?game=<slug>` query is the "Start a game" deep link from a game feature page (spec 0030): the
// host creates a room pre-selected to that game and skips the pick step (spec 0029).
export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const { game } = await searchParams;
  return <RoomsHome initialGame={game} />;
}
