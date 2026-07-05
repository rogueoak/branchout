import { HomeShowcase } from '../components/home-showcase';

// Home page: a themed canopy showcase. The Confetti brand comes entirely from the token layer
// (spec 0002); toggling `.dark` on <html> flips the whole page.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 bg-bg p-8 text-text">
      <HomeShowcase />
    </main>
  );
}
