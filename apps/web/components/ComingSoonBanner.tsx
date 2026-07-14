'use client';

// The "More games coming soon" banner on /games (spec 0047). A tasteful, mobile-first strip with a
// "Subscribe for updates" button that reveals the newsletter SubscribeForm inline. Kept a client
// component (the games page itself stays a Server Component) so the reveal + the form's own state
// live at the client boundary.

import { Button } from '@rogueoak/canopy';
import { useState } from 'react';
import { SubscribeForm } from './SubscribeForm';

export function ComingSoonBanner() {
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-labelledby="coming-soon-heading"
      className="mx-auto mb-10 max-w-5xl rounded-xl border border-border bg-surface px-4 py-6 sm:px-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="coming-soon-heading" className="text-h4 text-text">
            More games coming soon
          </h2>
          <p className="text-body-sm text-text-muted">
            We are always building. Subscribe and we will let you know when a new game lands.
          </p>
        </div>
        {!open ? (
          <Button
            type="button"
            variant="primary"
            className="shrink-0"
            onClick={() => setOpen(true)}
            aria-expanded={false}
            aria-controls="coming-soon-subscribe"
          >
            Subscribe for updates
          </Button>
        ) : null}
      </div>

      {open ? (
        <div id="coming-soon-subscribe" className="mt-4">
          <SubscribeForm />
        </div>
      ) : null}
    </section>
  );
}
