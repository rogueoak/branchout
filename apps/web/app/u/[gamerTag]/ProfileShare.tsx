'use client';

// Share a link to this public profile so a player can show off their stars (spec 0027). The profile
// page is a Server Component, so this small client child owns the interactivity. Self-contained (does
// NOT reuse the room ShareLink, which lives on a separate branch): navigator.share where supported
// (the fast mobile path), clipboard copy as the desktop fallback. A dismissed native sheet does NOT
// silently copy - only the unsupported branch copies.

import { Button } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-4"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

export function ProfileShare({ name }: { name: string }) {
  const [url, setUrl] = useState('');
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(window.location.href);
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  async function onShare() {
    if (canShare) {
      try {
        await navigator.share({
          title: `${name} on Branch Out`,
          text: `See ${name}'s stars on Branch Out`,
          url,
        });
      } catch {
        // The player dismissed the sheet (or it failed) - do NOT fall back to copy on a real
        // invocation; that would be a surprising silent action.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (no permission or insecure context): nothing else to do.
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onShare}
        aria-label={canShare ? 'Share this profile' : 'Copy a link to this profile'}
      >
        <ShareIcon />
        <span className="ml-1.5">{canShare ? 'Share' : copied ? 'Copied' : 'Copy link'}</span>
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Profile link copied' : ''}
      </span>
    </>
  );
}
