
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  // Next 16 blocks dev-mode hydration/RSC requests from origins it doesn't
  // recognize, which renders guest pages as a BLANK BODY when opened via the
  // LAN IP or a tunnel (HTML 200s, but the page never hydrates). Allowlist the
  // origins guests actually use in dev. Update the IP if the PC's LAN address
  // changes; harmless in production builds.
  allowedDevOrigins: ['172.20.10.2', '*.trycloudflare.com'],
  // Same-origin proxy to the backend for PUBLIC guest pages (/order, /queue,
  // /reserve, /cfd, /feedback). Guest phones can't reach "localhost:3001", and
  // through a tunnel the backend isn't on the page's host at all — so when the
  // configured backend is localhost, guest pages call /backend-api/* instead
  // (see src/lib/guest-backend.ts) and this rewrite forwards it server-side.
  // Works unchanged through any LAN IP or Cloudflare tunnel URL.
  async rewrites() {
    return [
      {
        source: '/backend-api/:path*',
        destination: `${process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001'}/:path*`,
      },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
