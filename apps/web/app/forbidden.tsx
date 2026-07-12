import { LEGAL_CONTACT_EMAIL } from '../lib/legal';

// The 403 boundary rendered when a route calls `forbidden()` (Next 15.1 authInterrupts). Today the
// only caller is the insider surface (spec 0035), reached by a signed-in account that is not an
// insider - so the copy speaks to that case: they are logged in, just not entitled.
export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
      <p className="text-body-sm font-semibold uppercase tracking-wide text-text-muted">403</p>
      <h1 className="text-h2 text-text">Insider only</h1>
      <p className="text-body text-text-muted max-w-md">
        Your account does not have access to this surface yet. If you think that is a mistake,{' '}
        <a
          href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=Insider%20access`}
          className="text-primary underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          reach out
        </a>{' '}
        and we will get you in.
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
