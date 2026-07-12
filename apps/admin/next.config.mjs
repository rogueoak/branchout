/** @type {import('next').NextConfig} */
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Same-origin API: the browser calls admin-host/api/v1/* (the `/v1` is in the client path) and Next
  // proxies to control-plane, stripping only `/api` - exactly like the prod Caddy `(api)` snippet
  // (handle_path /api/*), so dev and prod map identically: /api/v1/admin/... -> /v1/admin/... . Keeps
  // the host-only admin cookie flowing without CORS. In prod Caddy fronts /api before Next.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${CONTROL_PLANE_URL}/:path*` }];
  },
};

export default nextConfig;
