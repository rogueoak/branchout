'use client';

// The shared site top nav (spec 0028). Present on the marketing and room hosting/joining surfaces,
// absent inside a running game (each surface opts in by rendering this, so there is no fragile
// hide-on-route check). Left: the wordmark (home) + a Games link. Right: signed out shows Log in
// (quiet) and Sign up (the SOLE primary CTA - one-primary-per-view); signed in shows the player's
// avatar opening the account menu. The `viewer` is read server-side and injected as a prop, so the
// correct nav renders on the first byte with no signed-in/out flash.
//
// 'use client' because the account menu is interactive (dropdown, logout); it also composes canopy's
// button styles, and canopy owns its own client boundary needs (see the Theming learning).

import { buttonVariants } from '@rogueoak/canopy';
import type { Viewer } from '../lib/session';
import { AccountMenu } from './AccountMenu';
import { Wordmark } from './Wordmark';

export function TopNav({ viewer }: { viewer: Viewer }) {
  return (
    <header className="border-b border-border bg-bg">
      <nav
        aria-label="Site navigation"
        className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6"
      >
        <div className="flex items-center gap-4 sm:gap-6">
          <a
            href="/"
            aria-label="Branch Out Games home"
            className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Wordmark />
          </a>
          <a
            href="/games"
            className="text-body-sm font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Games
          </a>
        </div>

        {viewer.signedIn && viewer.gamerTag ? (
          <AccountMenu
            gamerTag={viewer.gamerTag}
            nickname={viewer.nickname}
            avatar={viewer.avatar}
          />
        ) : (
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href="/login"
              className="text-body-sm font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Log in
            </a>
            <a href="/signup" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
              Sign up
            </a>
          </div>
        )}
      </nav>
    </header>
  );
}
