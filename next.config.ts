import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingIncludes: { '/*': ['./supabase-ca.crt'] },
};
export default config;
