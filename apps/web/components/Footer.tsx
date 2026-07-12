// The shared site footer (spec 0031): a brand line plus links to the privacy policy and terms of
// service. Rendered on the marketing and rooms/join surfaces so the legal pages are always one tap
// away. A plain component (no 'use client', no server-only imports) so it drops into both server
// pages (the legal pages) and client ones (LandingContent, RoomsHome, JoinForm) unchanged.

const linkClass =
  'text-body-sm text-text-muted underline-offset-4 hover:text-text hover:underline ' +
  'focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

// `linkOrigin` crosses the legal links to another origin (spec 0035): on a subdomain surface
// (insider) whose middleware rewrites every path into its tree, apex-relative `/privacy` would 404,
// so the surface passes its apex origin. Unset = relative (the default on the apex itself).
export function Footer({ linkOrigin }: { linkOrigin?: string }) {
  const to = (path: string) => (linkOrigin ? `${linkOrigin}${path}` : path);
  return (
    <footer className="mx-auto mt-auto w-full max-w-5xl border-t border-border px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-text-muted">Branch Out Games - where game night grows.</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          <a href={to('/privacy')} className={linkClass}>
            Privacy
          </a>
          <a href={to('/terms')} className={linkClass}>
            Terms
          </a>
        </nav>
      </div>
    </footer>
  );
}
