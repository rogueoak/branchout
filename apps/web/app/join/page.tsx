import type { Metadata } from 'next';
import { getRoomPreview } from '../../lib/room-preview';
import { getViewer } from '../../lib/session';
import { getSurface } from '../../lib/surface';
import { shareCardFor } from '../../lib/share-card';
import { JoinForm } from './JoinForm';

// Open Graph for a share link: unfurl as "Join my game" over the art of the game this room is
// playing. The room's game is resolved server-side via the public preview endpoint (a crawler is
// not a member, so getRoom cannot serve it). Any failure - no code, bad/expired code, unreachable
// control-plane - falls back to the generic invite card, so every /join link still unfurls well.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}): Promise<Metadata> {
  const { code } = await searchParams;
  let selectedGame: string | null = null;
  if (code) {
    try {
      selectedGame = (await getRoomPreview(code)).selectedGame;
    } catch {
      // Leave selectedGame null -> generic card. A share link must never fail to unfurl.
    }
  }
  const card = shareCardFor(selectedGame);
  const title = 'Join my game';
  const description = 'Tap to join on Branch Out.';
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: card.image, width: 1200, height: 630, alt: card.alt }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [card.image] },
  };
}

// The join-by-code page (the share link target). Resolves the `code` query param and seeds the
// form; the client component runs the join.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const [viewer, surface] = await Promise.all([getViewer(), getSurface()]);
  return <JoinForm initialCode={(code ?? '').toUpperCase()} viewer={viewer} surface={surface} />;
}
