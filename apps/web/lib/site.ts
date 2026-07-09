// The site's own public origin. Open Graph crawlers need absolute og:image URLs, so this seeds
// Next's `metadataBase` (set once in the root layout; child routes inherit it). Mirrors the
// NEXT_PUBLIC_* pattern used for the control-plane and engine URLs, with a localhost dev default.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
