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
    // `/v1/*`. Dev/e2e has no Caddy, so when a server-side CONTROL_PLANE_URL is present this rewrite
    // stands in for that hop - letting the browser call `/api` same-origin on the insider subdomain
    // too (a cross-origin call there cannot carry the session over http). Inert in prod: Caddy handles
    // `/api` before a request ever reaches Next. Guarded so a build without the server URL never emits
    // an `undefined/...` destination.
    const controlPlane = process.env.CONTROL_PLANE_URL;
    const apiProxy = controlPlane
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
