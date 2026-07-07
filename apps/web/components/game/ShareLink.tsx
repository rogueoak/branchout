'use client';

import { Button } from '@rogueoak/canopy';
import { useEffect, useState } from 'react';

/**
 * The room's tap-to-join share link with a copy-to-clipboard shortcut.
 *
 * The control-plane returns `shareLink` as a relative path (`/join?code=ABC12`) so it resolves
 * against whatever origin serves the app. That is fine for clicking, but a host who copies it to
 * send to a friend needs the full URL - a bare path is useless pasted into a text or DM. So we
 * resolve it against this origin to an absolute URL for both the visible link and the copied
 * text. Resolved after mount to avoid an SSR/CSR hydration mismatch (no `window` on the server);
 * `new URL` leaves an already-absolute href untouched.
 */
export function ShareLink({ href }: { href: string }) {
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState(href);
  useEffect(() => {
    setShareUrl(new URL(href, window.location.origin).toString());
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

  return (
    <span className="flex flex-wrap items-center gap-2">
      <a className="text-primary underline-offset-4 hover:underline" href={shareUrl}>
        {shareUrl}
      </a>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </span>
  );
}
