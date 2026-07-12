import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Branch Out Admin',
  description: 'Operator console.',
  // Operators only; keep this surface out of search results.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Dark theme, same as the main site (spec 0037: consistent look and feel).
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
