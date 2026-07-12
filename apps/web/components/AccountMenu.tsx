'use client';

// The signed-in account dropdown for the top nav (spec 0028): the player's avatar is the trigger, and
// the menu offers "Manage account" (-> /account, spec 0027) and "Log out". Canopy ships no menu
// primitive, so this is a small headless disclosure with the ARIA + keyboard behaviour a menu needs -
// aria-haspopup/expanded on the trigger, role=menu/menuitem, Escape and outside-click to close,
// focus moved into the menu on open and returned to the trigger on close, and arrow-key navigation.
// It is NOT hover-only, so it works on touch.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from './Avatar';
import { logout } from '../lib/account-api';
import { identifyPlayer, resetAnalytics } from '../lib/analytics';

interface AccountMenuProps {
  gamerTag: string;
  nickname?: string;
  avatar?: string;
  // Cross the menu's own links + post-logout nav to another origin (spec 0035): on the insiders
  // subdomain, `/account` is an apex page, so the surface passes its apex origin. Unset = relative.
  linkOrigin?: string;
}

export function AccountMenu({ gamerTag, nickname, avatar, linkOrigin }: AccountMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([]);
  const name = nickname || gamerTag;

  // Analytics (spec 0032): this menu only renders for a signed-in player, so it is where we identify
  // them - by their PUBLIC gamer tag (never email/session). Re-runs only if the tag changes.
  useEffect(() => {
    identifyPlayer(gamerTag);
  }, [gamerTag]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Close on an outside pointer or Escape; move focus to the first item when the menu opens.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // A menu is a roving-tabindex widget: the items carry `tabIndex={-1}` (not in the page tab order),
  // arrow keys move between them, Home/End jump to the ends, and Tab closes the menu and returns focus
  // to the trigger (Tab does not step through menu items).
  function onMenuKeyDown(event: React.KeyboardEvent) {
    const items = itemRefs.current.filter(Boolean) as HTMLElement[];
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close();
    }
  }

  async function onLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // Best-effort: even if the revoke call fails, send them home; the cookie clear is idempotent.
    }
    // Clear the analytics identity so a shared device does not attribute the next player to this one.
    resetAnalytics();
    close(false);
    // On a crossed-origin surface (insiders), leave to the apex home; the Next router is same-origin
    // only, so a full navigation is needed to cross back.
    if (linkOrigin) {
      window.location.assign(`${linkOrigin}/`);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((v) => !v)}
        // p-1 pads the 36px avatar art to a >=44px hit area (comfortable one-handed tap) without
        // enlarging the avatar itself.
        className="inline-flex rounded-full p-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <Avatar avatar={avatar} name={name} className="h-9 w-9" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-50 mt-2 flex w-56 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-border bg-surface-raised py-1 shadow-lg"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-body-sm font-medium text-text">{name}</p>
            <p className="truncate text-caption text-text-muted">@{gamerTag}</p>
          </div>
          <a
            ref={(el) => {
              itemRefs.current[0] = el;
            }}
            role="menuitem"
            tabIndex={-1}
            href={linkOrigin ? `${linkOrigin}/account` : '/account'}
            onClick={() => close(false)}
            className="px-3 py-2 text-left text-body-sm text-text hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
          >
            Manage account
          </a>
          <button
            ref={(el) => {
              itemRefs.current[1] = el;
            }}
            role="menuitem"
            tabIndex={-1}
            type="button"
            disabled={loggingOut}
            onClick={onLogout}
            className="px-3 py-2 text-left text-body-sm text-text hover:bg-surface focus-visible:bg-surface focus-visible:outline-none disabled:opacity-60"
          >
            {loggingOut ? 'Logging out...' : 'Log out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
