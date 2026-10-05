import { readApiOrigin } from './lib/security/env.js';
import { getWebOrigin } from './features/catalog/catalog-seo.js';
const apiOrigin = readApiOrigin();
getWebOrigin();

const nextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: `${API_BASE_PATH}/:path*`,
        destination: `${apiOrigin}${API_BASE_PATH}/:path*`,
      },
    ];
  },
};
export default nextConfig;
import { API_BASE_PATH } from '@marthub/contracts';
