import type { Metadata } from 'next';
import { Footer } from '../../components/Footer';
import { TopNav } from '../../components/TopNav';
import { getViewer } from '../../lib/session';
import { TermsContent } from './TermsContent';

// The terms of service route (spec 0031). Static content; reads the viewer server-side so the shared
// top nav renders correctly with no flash. The terms body lives in TermsContent so it stays
// unit-testable without mocking next/headers.
export const metadata: Metadata = {
  title: 'Terms of Service - Branch Out Games',
  description:
    'The terms for using Branch Out Games: the service is provided as is, and the terms can change.',
};

export default async function TermsPage() {
  const viewer = await getViewer();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <TopNav viewer={viewer} />
      <main className="flex-1">
        <TermsContent />
      </main>
      <Footer />
    </div>
  );
}
