import 'server-only';
import { createApiClient } from './core';
import { readApiOrigin } from '../security/env';

// Credentials and request IDs are explicit per-call values, never shared mutable state.
export function serverApi(path, options) {
  return createApiClient({
    origin: readApiOrigin(),
  })(path, options);
}
