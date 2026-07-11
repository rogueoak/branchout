// The shared site footer (spec 0031): a brand line plus links to the privacy policy and terms of
// service. Rendered on the marketing and rooms/join surfaces so the legal pages are always one tap
// away. A plain component (no 'use client', no server-only imports) so it drops into both server
// pages (the legal pages) and client ones (LandingContent, RoomsHome, JoinForm) unchanged.

const linkClass =
  'text-body-sm text-text-muted underline-offset-4 hover:text-text hover:underline ' +
  'focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function Footer() {
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl border-t border-border px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-text-muted">Branch Out Games - where game night grows.</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          <a href="/privacy" className={linkClass}>
            Privacy
          </a>
          <a href="/terms" className={linkClass}>
            Terms
          </a>
        </nav>
      </div>
    </footer>
  );
}
