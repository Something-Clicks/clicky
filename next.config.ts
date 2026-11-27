import type { NextConfig } from 'next';

const config: NextConfig = {
  // undici is used by the SSRF-safe website fetcher (server only).
  serverExternalPackages: ['undici'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
export default config;
