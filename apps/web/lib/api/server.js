import 'server-only';
import { createApiClient } from './core';

// Credentials and request IDs are explicit per-call values, never shared mutable state.
export function serverApi(path, options) {
  return createApiClient({
    origin: process.env.API_INTERNAL_ORIGIN || 'http://127.0.0.1:4000',
  })(path, options);
}
