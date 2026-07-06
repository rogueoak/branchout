import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Logo } from '../components/Logo';
import './globals.css';

export const metadata: Metadata = {
  title: 'Branch out',
  description: 'Where game night grows.',
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'Branch out',
    description: 'Where game night grows.',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="flex items-center px-6 py-4">
          <Logo />
        </header>
        {children}
      </body>
    </html>
  );
}
