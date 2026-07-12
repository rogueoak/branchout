'use client';

import { buttonVariants } from '@rogueoak/canopy';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminLogout } from '../lib/admin-api';

const linkClass =
  'text-body-sm font-medium text-text-muted underline-offset-4 hover:text-text hover:underline ' +
  'focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

// The console's top bar: an "Admin" marker, section links, the signed-in admin, and log out. Client
// because log out is interactive (POST + redirect). Rendered on every authed page (spec 0037).
export function AdminNav({ email }: { email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await adminLogout();
    } catch {
      // Even if the network call fails, the cookie clear + redirect gets the operator out.
    }
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="border-b border-border bg-bg">
      <nav
        aria-label="Admin navigation"
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <span className="text-body-sm font-semibold uppercase tracking-wide text-primary">
            Branch Out Admin
          </span>
          <a href="/users" className={linkClass}>
            Users
          </a>
          <a href="/admins" className={linkClass}>
            Admins
          </a>
        </div>
        <div className="flex items-center gap-3">
          <span className="truncate text-caption text-text-muted" title={email}>
            {email}
          </span>
          <button
            type="button"
            onClick={onLogout}
            disabled={busy}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {busy ? 'Logging out...' : 'Log out'}
          </button>
        </div>
      </nav>
    </header>
  );
}
