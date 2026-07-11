import type { Metadata } from 'next';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';
import { getViewer } from '../../lib/session';
import { PrivacyContent } from './PrivacyContent';

// The privacy policy route (spec 0031). Static content, but the page reads the viewer server-side so
// the shared top nav renders signed-in/out correctly with no flash (the same pattern the other
// surfaces use). The policy body lives in PrivacyContent so it stays unit-testable without mocking
// next/headers.
export const metadata: Metadata = {
  title: 'Privacy Policy - Branch Out Games',
  description:
    'What Branch Out Games collects and why: first-party analytics, what accounts store, and your choices.',
};

export default async function PrivacyPage() {
  const viewer = await getViewer();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <TopNav viewer={viewer} />
      <main className="flex-1">
        <PrivacyContent />
      </main>
      <Footer />
    </div>
  );
}
