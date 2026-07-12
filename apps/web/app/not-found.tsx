// The global 404 boundary. Rendered for any unmatched route and, deliberately, when the insiders
// layout host-guards a direct apex `/insiders` request via `notFound()` (spec 0035) - so that path
// gets a real 404 status in the site look and feel, not a bare string.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
      <p className="text-body-sm font-semibold uppercase tracking-wide text-text-muted">404</p>
      <h1 className="text-h2 text-text">Page not found</h1>
      <p className="text-body text-text-muted max-w-md">
        The page you are looking for does not exist or has moved.
      </p>
      <a
        href="/"
        className="text-body-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Back to Branch Out
      </a>
    </main>
  );
}
