import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AnalyticsProvider } from '../components/AnalyticsProvider';
import { SITE_URL } from '../lib/site';
import './globals.css';

export const metadata: Metadata = {
  // Absolute-URL base for og:image and friends; child routes (e.g. /join) inherit it.
  metadataBase: new URL(SITE_URL),
  title: 'Branch Out Games',
  description: 'Where game night grows.',
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'Branch Out Games',
    description: 'Where game night grows.',
    images: [
      { url: '/og.png', width: 1200, height: 630, alt: 'Branch Out - where game night grows' },
    ],
  },
  // Render the large card (not the small summary) on X, iMessage, and other Twitter-card readers.
  twitter: {
    card: 'summary_large_image',
    title: 'Branch Out Games',
    description: 'Where game night grows.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Dark is the default (and, for now, only) theme. The `dark` class flips both the roots and
  // Confetti brand token layers, which are class-toggled (no prefers-color-scheme auto-flip).
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <AnalyticsProvider />
      </body>
    </html>
  );
}
