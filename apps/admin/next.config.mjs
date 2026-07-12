/** @type {import('next').NextConfig} */
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:4000';

const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Same-origin API: the browser calls admin-host/api/* and Next proxies to control-plane's /v1.
  // Keeps the host-only admin cookie flowing without CORS. In prod Caddy fronts /api before Next.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${CONTROL_PLANE_URL}/v1/:path*` }];
  },
};

export default nextConfig;
