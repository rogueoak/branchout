import { buttonVariants } from '@rogueoak/canopy';
import { Wordmark } from '../components/Wordmark';

// The global 404 boundary. Rendered for any unmatched route and, deliberately, when the insider
// layout host-guards a direct apex `/insider` request via `notFound()` (spec 0035) - so that path
// gets a real 404 status in the site look and feel, not a bare string. Friendly, on-brand copy with
// the wordmark and a primary "go home" button; mobile-first (centered, wraps at 360px).
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center text-text">
      <Wordmark />
      <p className="text-body-sm font-semibold uppercase tracking-wide text-text-muted">
        Off the map
      </p>
      <h1 className="text-h2 text-text">Whoops, looks like you are lost!</h1>
      <p className="text-body text-text-muted max-w-md">
        The page you are looking for does not exist or has moved.
      </p>
      <a href="/" className={buttonVariants({ variant: 'primary' })}>
        Let&apos;s go home
      </a>
    </main>
  );
}
