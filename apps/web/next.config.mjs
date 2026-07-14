/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Linting runs through the shared flat config via `pnpm lint`, not Next's bundled setup.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Enables `forbidden()` / `unauthorized()` (Next 15.1): the insider layout (spec 0035) calls
    // `forbidden()` for a signed-in non-insider so the app returns a real, styled 403 rather than a
    // 200 "not allowed" page.
    authInterrupts: true,
  },
  // First-party analytics proxy (spec 0032): PostHog JS points at the same-origin `/ingest` path, and
  // these rewrites forward it to the PostHog US cloud - so the browser only ever calls our own domain
  // (no third-party tracker hostname; ad/tracking blockers that target PostHog do not drop our data).
  // In prod this sits behind the same Caddy origin (everything except /api and /ws routes to web).
  // posthog-js posts to no-trailing-slash paths (/ingest/e/, /ingest/flags), so no global
  // skipTrailingSlashRedirect is needed - keeping trailing-slash normalization on for the real pages.
  async rewrites() {
    // Same-origin `/api` proxy (feedback 0028): in prod the browser calls a relative `/api` and Caddy
    // re-serves it same-origin per host (apex AND `insider.`), stripping `/api` -> control-plane's
    // `/v1/*`. Dev/e2e has no Caddy, so this rewrite stands in for that hop - letting the browser call
    // `/api` same-origin on the insider subdomain too (a cross-origin call there cannot carry the
    // session over http). Restricted to NON-production: prod's `web` also sets `CONTROL_PLANE_URL`
    // (for SSR), so guarding on that alone would emit the proxy in prod, exposing the internal-only
    // `/api/v1/engine/*` money endpoint on the web tier to in-network peers (Caddy blocks it at the
    // edge, but the web tier would not). In prod Caddy owns `/api` and Next must never proxy it.
    const controlPlane = process.env.CONTROL_PLANE_URL;
    const apiProxy =
      process.env.NODE_ENV !== 'production' && controlPlane
        ? [{ source: '/api/:path*', destination: `${controlPlane.replace(/\/$/, '')}/:path*` }]
        : [];
    return {
      beforeFiles: apiProxy,
      afterFiles: [
        {
          source: '/ingest/static/:path*',
          destination: 'https://us-assets.i.posthog.com/static/:path*',
        },
        // Catch-all for ingestion + config endpoints (/e, /flags, etc.); PostHog uses /flags now, and
        // this covers whatever path the client SDK hits without a redundant per-endpoint rule.
        { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
      ],
    };
  },
};

export default nextConfig;
