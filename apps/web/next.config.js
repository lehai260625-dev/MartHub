const apiOrigin = process.env.API_INTERNAL_ORIGIN || 'http://127.0.0.1:4000';
const parsed = new URL(apiOrigin);
if (
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.username ||
  parsed.password ||
  parsed.pathname !== '/' ||
  parsed.search ||
  parsed.hash
) {
  throw new Error(
    'API_INTERNAL_ORIGIN must be an HTTP(S) origin without credentials or a path.',
  );
}

const nextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: `${API_BASE_PATH}/:path*`,
        destination: `${parsed.origin}${API_BASE_PATH}/:path*`,
      },
    ];
  },
};
export default nextConfig;
import { API_BASE_PATH } from '@marthub/contracts';
