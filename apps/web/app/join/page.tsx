import { JoinForm } from './JoinForm';

// The join-by-code page (the share link target). Resolves the `code` query param and seeds the
// form; the client component runs the join.
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return <JoinForm initialCode={(code ?? '').toUpperCase()} />;
}
