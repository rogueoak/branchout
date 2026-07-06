import { RoomClient } from './RoomClient';

// The room page. A thin server wrapper: it resolves the dynamic `code` and hands off to the client
// orchestrator, which owns the lobby, the engine connection, and the in-game stage.
export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomClient code={code} />;
}
