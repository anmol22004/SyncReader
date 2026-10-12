import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_READER_BUILD: process.env.COMMIT_REF?.slice(0, 12) || 'local',
    NEXT_PUBLIC_READER_BUILT_AT: new Date().toISOString(),
  },
  serverExternalPackages: ['xml-js', 'jszip', 'pdf-lib'],
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'" }
    ] }];
  }
};
export default nextConfig;
