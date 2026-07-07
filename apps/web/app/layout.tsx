import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
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
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Dark is the default (and, for now, only) theme. The `dark` class flips both the roots and
  // Confetti brand token layers, which are class-toggled (no prefers-color-scheme auto-flip).
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
