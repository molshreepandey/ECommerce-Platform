import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  // 'use cache: remote' entries live in Redis and fail open to PostgreSQL (docs/redis-design.md §5.1).
  cacheHandlers: {
    remote: path.join(process.cwd(), 'cache-handlers', 'redis-cache-handler.mjs'),
  },
  partialPrefetching: true,
  poweredByHeader: false,
  // Identical in every environment, so build-time is fine; runtime CSP and HSTS are set in src/proxy.ts.
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]);
  },
  outputFileTracingIncludes: {
    '/*': ['./config/*.json', './cache-handlers/*.mjs'],
    '/api/admin/docs/assets/[file]': ['./node_modules/swagger-ui-dist/swagger-ui-bundle.js'],
  },
  allowedDevOrigins: ['store.localhost', 'admin.localhost'],
  experimental: {
    globalNotFound: true,
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
