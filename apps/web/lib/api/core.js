import { API_BASE_PATH, errorSchema } from '@marthub/contracts';

export class ApiClientError extends Error {
  constructor(
    message,
    { status = 0, code = 'NETWORK_ERROR', requestId, details } = {},
  ) {
    super(message);
    Object.assign(this, { status, code, requestId, details });
  }
}

export function createApiClient({
  origin = '',
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return async function api(
    path,
    { method = 'GET', body, token, requestId, signal, schema } = {},
  ) {
    // Keep all callers inside the Express boundary, including encoded path traversal.
    if (
      typeof path !== 'string' ||
      !/^\/[a-zA-Z0-9]/.test(path) ||
      /[\\#]/.test(path)
    )
      throw new Error('API path must be a relative endpoint path.');
    const target = new URL(
      API_BASE_PATH + path,
      origin || 'http://marthub.invalid',
    );
    let decoded;
    try {
      decoded = decodeURIComponent(target.pathname);
    } catch {
      throw new Error('API path is invalid.');
    }
    if (
      !decoded.startsWith(API_BASE_PATH + '/') ||
      decoded.split('/').some((part) => part === '..' || part === '.') ||
      decoded.includes('\\')
    )
      throw new Error('API path must remain under the versioned API.');
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (requestId) headers.set('X-Request-Id', requestId);
    let response;
    try {
      response = await fetchImpl(
        origin ? target.href : target.pathname + target.search,
        {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        },
      );
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiClientError('Unable to connect. Please try again.');
    }
    if (response.status === 204) return undefined;
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ApiClientError('The service returned an unreadable response.', {
        status: response.status,
        code: 'INVALID_RESPONSE',
        requestId: response.headers.get('x-request-id'),
      });
    }
    if (!response.ok) {
      const parsed = errorSchema.safeParse(payload);
      const data = parsed.success
        ? parsed.data.error
        : {
            code: 'HTTP_ERROR',
            message: 'The request could not be completed.',
          };
      throw new ApiClientError(data.message, {
        ...data,
        status: response.status,
        requestId: data.requestId || response.headers.get('x-request-id'),
      });
    }
    if (schema) {
      const parsed = schema.safeParse(payload);
      if (!parsed.success)
        throw new ApiClientError(
          'The service returned an unexpected response.',
          { status: response.status, code: 'INVALID_RESPONSE' },
        );
      return parsed.data;
    }
    return payload;
  };
}
