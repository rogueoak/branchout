/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Linting runs through the shared flat config via `pnpm lint`, not Next's bundled setup.
    ignoreDuringBuilds: true,
  },
  // First-party analytics proxy (spec 0032): PostHog JS points at the same-origin `/ingest` path, and
  // these rewrites forward it to the PostHog US cloud - so the browser only ever calls our own domain
  // (no third-party tracker hostname; ad/tracking blockers that target PostHog do not drop our data).
  // In prod this sits behind the same Caddy origin (everything except /api and /ws routes to web).
  // posthog-js posts to no-trailing-slash paths (/ingest/e/, /ingest/flags), so no global
  // skipTrailingSlashRedirect is needed - keeping trailing-slash normalization on for the real pages.
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      // Catch-all for ingestion + config endpoints (/e, /flags, etc.); PostHog uses /flags now, and
      // this covers whatever path the client SDK hits without a redundant per-endpoint rule.
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ];
  },
};

export default nextConfig;
