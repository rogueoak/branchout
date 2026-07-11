import type { Metadata } from 'next';
import { AccountClient } from './AccountClient';

export const metadata: Metadata = {
  title: 'Your account - Branch Out',
  // Not a page we want indexed - it is personal and gated.
  robots: { index: false, follow: false },
};

// The account page (spec 0027): manage nickname, avatar, and privacy, and log out. The interactive
// work lives in the client component; this server page just sets metadata.
export default function AccountPage() {
  return <AccountClient />;
}
