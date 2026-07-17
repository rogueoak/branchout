'use client';

// A responsive sheet (spec 0051): bottom on mobile, right on desktop. Canopy ships a `ResponsiveDialog`
// (bottom sheet on phones, CENTRED modal on desktop) but no side drawer, and the requirement is a
// RIGHT panel on desktop - so this composes the Radix Dialog primitive canopy already depends on with
// our own positioning. Radix gives us role="dialog", aria-modal, the focus trap, Escape-to-close,
// scroll lock, and a portal for free - so we do not hand-roll a11y, only the position:
//   phone:   fixed to the bottom edge, rounded top, up to 85vh tall, slides up.
//   desktop: pinned to the right edge, full height, capped width, slides in from the right.
// The header carries the title and an X close (aria-label="Close"); the body scrolls. `@radix-ui/
// react-dialog` is a direct dependency of apps/web pinned to the version canopy already resolves.

import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet title, shown in the header and used as the dialog's accessible name. */
  title: string;
  /** The trigger button; `asChild` so the caller owns the element and its styling. */
  trigger?: ReactNode;
  children: ReactNode;
}

export function Sheet({ open, onOpenChange, title, trigger, children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        {/* The scrim: dims the live game behind the sheet; a tap on it closes (backdrop dismiss). */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={
            // Phone: pinned to the bottom edge, rounded top, capped height, scrollable body inside.
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-surface shadow-xl ' +
            // Desktop: pinned to the right edge, full height, capped width, square corners.
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0'
          }
        >
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <Dialog.Title className="text-h4 text-text">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded-md p-1 text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className="size-5"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
