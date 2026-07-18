'use client';

// The shared site top nav (spec 0028). Present on the marketing and room hosting/joining surfaces,
// absent inside a running game (each surface opts in by rendering this, so there is no fragile
// hide-on-route check). Left: the wordmark (home), an optional surface badge, + a Games link. Right:
// signed out shows Log in
// (quiet) and a Sign up CTA (primary by default, de-emphasized via `signupVariant` on a page whose
// body already owns the signup primary - one-primary-per-view); signed in shows the player's avatar
// opening the account menu. The `viewer` is read server-side and injected as a prop, so the correct
// nav renders on the first byte with no signed-in/out flash.
//
// 'use client' because the account menu is interactive (dropdown, logout); it also composes canopy's
// button styles, and canopy owns its own client boundary needs (see the Theming learning).

import { Badge, buttonVariants } from '@rogueoak/canopy';
import type { Viewer } from '../lib/session';
import { AccountMenu } from './AccountMenu';
import { Wordmark } from './Wordmark';

// `signupVariant` lets a surface de-emphasize the nav's Sign up CTA. On a page whose body already
// carries the primary signup action (the home hero's "Sign up free"), pass `outline` so there is one
// primary per view; elsewhere (/rooms, /join, the lobby) the nav CTA is the page's primary.
// `label` renders a small pill just after the wordmark (spec 0035): a surface marker like "Insider"
// so a tester always knows which surface they are on. Omitted on the main site.
// `linkOrigin` crosses the nav's APEX-ONLY links (Log in, Sign up, Manage account) to another origin
// (spec 0035): on a subdomain surface (insider) whose middleware rewrites every path into its tree,
// an apex-relative `/login` would 404, so the surface passes its apex origin and those links point
// absolute to the apex. Unset = relative (the default on the apex itself).
// `insider` marks the insider surface so the SURFACE-OWNED links stay on this host (feedback 0030):
// the wordmark/home and Games point at the insider landing (`/insider`, relative here) where the
// insider games live, instead of crossing to the apex home / public games. Only apex-only chrome
// crosses; surface-owned nav links stay on the host.
export function TopNav({
  viewer,
  signupVariant = 'primary',
  label,
  linkOrigin,
  insider = false,
}: {
  viewer: Viewer;
  signupVariant?: 'primary' | 'outline';
  label?: string;
  linkOrigin?: string;
  insider?: boolean;
}) {
  // Apex-only links cross to the apex origin on a subdomain surface.
  const toApex = (path: string) => (linkOrigin ? `${linkOrigin}${path}` : path);
  // Surface-owned links (home + Games) stay on the current host - relative, never crossed. Home is
  // always `/` (the insider host rewrites `/` into the insider landing). Games points at the public
  // `/games` index on the apex, and at the insider landing (`/`, where the insider games are listed)
  // on the insider surface - there is no separate `/insider/games` page.
  const homeHref = '/';
  const gamesHref = insider ? '/' : '/games';
  return (
    <header className="border-b border-border bg-bg">
      <nav
        aria-label="Site navigation"
        className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-2 sm:gap-6">
          <a
            href={homeHref}
            aria-label="Branch Out Games home"
            className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {/* Collapse the wordmark to icon-only on the narrowest phones so the nav (wordmark +
                Games + Join + Log in + Sign up, spec 0029) fits at 360px without the left and right
                groups overlapping (which made the Join link untappable). */}
            <Wordmark collapseTextOnMobile />
          </a>
          {/* The surface badge (e.g. "Insider", spec 0035) sits right after the wordmark so the
              marker reads as part of the brand lockup - left-aligned, matching the admin console's
              "Admin" badge. Omitted on the main apex. */}
          {label ? (
            <Badge variant="primary" className="uppercase tracking-wide">
              {label}
            </Badge>
          ) : null}
          <a
            href={gamesHref}
            className="text-body-sm font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Games
          </a>
          {/* Join (spec 0029): a one-tap path to the join screen for a player who already has a code.
              Surface-owned like Games - stays relative so on the insider host the middleware rewrites
              it into the insider join tree; never crossed to the apex (feedback 0030). */}
          <a
            href="/join"
            className="text-body-sm font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Join
          </a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {viewer.signedIn && viewer.gamerTag ? (
            <AccountMenu
              gamerTag={viewer.gamerTag}
              nickname={viewer.nickname}
              avatar={viewer.avatar}
              linkOrigin={linkOrigin}
            />
          ) : (
            <div className="flex items-center gap-2 sm:gap-3">
              <a
                href={toApex('/login')}
                className="text-body-sm font-medium text-text-muted underline-offset-4 hover:text-text hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Log in
              </a>
              <a
                href={toApex('/signup')}
                className={buttonVariants({ variant: signupVariant, size: 'sm' })}
              >
                Sign up
              </a>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
