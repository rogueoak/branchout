import { CanopyButton } from '../components/canopy-button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Branch out</h1>
      <p className="text-lg text-gray-600">where game night grows.</p>
      <CanopyButton>Start a room</CanopyButton>
      <p className="text-sm text-gray-400">
        Placeholder home page. The Branch out theme lands in spec 0002.
      </p>
    </main>
  );
}
