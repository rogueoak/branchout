'use client';

import { Button } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, ShareIcon } from './icons';

/**
 * The room's invite affordance (spec 0029): the room CODE as a tappable link to the join URL, a
 * copy button that is an ICON (not the word "Copy"), and a share button that opens the native share
 * sheet on devices that support it (falling back to copy on desktop).
 *
 * The control-plane returns `shareLink` as a relative path (`/join?code=ABC12`); a friend needs the
 * full URL, so we resolve it against this origin after mount (no `window` on the server, so this
 * avoids an SSR/CSR hydration mismatch). `navigator.share` exists on most mobile browsers and few
 * desktops, so the share button is feature-detected and degrades to copy - it always does something.
 */
export function ShareLink({ code, href }: { code: string; href: string }) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState(href);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setShareUrl(new URL(href, window.location.origin).toString());
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, [href]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (no permission or insecure context): the visible link still works.
    }
  }

  async function share() {
    if (canShare) {
      try {
        await navigator.share({
          title: 'Join my Branch Out game',
          text: `Join my game - room ${code}`,
          url: shareUrl,
        });
        return;
      } catch {
        // The user dismissed the sheet, or share failed - fall back to copying the link.
      }
    }
    await copy();
  }

  return (
    <span className="flex items-center gap-2">
      <a
        className="text-primary tabular-nums tracking-widest underline-offset-4 hover:underline"
        href={shareUrl}
      >
        {code}
      </a>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        aria-label={copied ? 'Join link copied' : 'Copy join link'}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={share}
        aria-label="Share join link"
      >
        <ShareIcon />
      </Button>
      {/* A polite live region announces the copy to screen readers, since the button's only visible
          change is the icon swap. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Join link copied' : ''}
      </span>
    </span>
  );
}
