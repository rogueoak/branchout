'use client';

// A responsive sheet (spec 0051): bottom on mobile, right on desktop. Canopy ships a `ResponsiveDialog`
// (bottom sheet on phones, CENTRED modal on desktop) but no side drawer, and the requirement is a
// RIGHT panel on desktop - so this composes the Radix Dialog primitive canopy already depends on with
// our own positioning. Radix gives us role="dialog", the focus trap (FocusScope), Escape-to-close,
// scroll lock (RemoveScroll), a portal, and it marks the rest of the page inert/aria-hidden via
// DismissableLayer - i.e. it provides modal SEMANTICS, though it does NOT set an explicit `aria-modal`
// attribute in this version - so we do not hand-roll a11y, only the position:
//   phone:   fixed to the bottom edge, rounded top, up to 85vh tall, slides up.
//   desktop: pinned to the right edge, full height, capped width, slides in from the right.
// Motion (spec 0051's intent): keyed off Radix's `data-[state=open|closed]` on Content/Overlay, using
// the roots `bottom-sheet`/`fade` presets on phone + overlay and a right-drawer keyframe (in
// globals.css) on desktop, all gated by `motion-reduce:animate-none`.
// The header carries the title and an X close (aria-label="Close"); the body scrolls. Radix's
// Dialog.Content auto-sets `aria-describedby` at a generated id, so we render an `sr-only`
// Dialog.Description to resolve that reference (and silence Radix's dev warning). `@radix-ui/
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
        {/* The scrim: dims the live game behind the sheet; a tap on it closes (backdrop dismiss).
            Fades in/out with the dialog state (reduced-motion falls back to an instant swap). */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out motion-reduce:animate-none" />
        <Dialog.Content
          aria-describedby={undefined}
          className={
            // Phone: pinned to the bottom edge, rounded top, capped height, scrollable body inside.
            // Slides up from the bottom edge on open, back down on close.
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-surface shadow-xl ' +
            'data-[state=open]:animate-bottom-sheet-in data-[state=closed]:animate-bottom-sheet-out ' +
            // Desktop: pinned to the right edge, full height, capped width, square corners. Slides in
            // from the right edge on open, back out on close (a right-anchored drawer keyframe lives in
            // globals.css - roots' `drawer-*` is left-anchored, the wrong side for this panel).
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0 ' +
            'sm:data-[state=open]:animate-sheet-right-in sm:data-[state=closed]:animate-sheet-right-out ' +
            'motion-reduce:animate-none'
          }
        >
          {/* Radix auto-sets aria-describedby on Content; we pass undefined above to drop the dangling
              reference, and the visible RulesContent (or child) carries the description. */}
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
