import { createHash } from 'node:crypto';
import { ApiError } from '../../middleware/platform.js';

export function throttleKey(operation, kind, value) {
  return createHash('sha256')
    .update(JSON.stringify([operation, kind, value]))
    .digest('hex');
}

export function createAuthThrottle({
  prisma,
  ipLimit = 100,
  accountLimit = 10,
  windowSeconds = 900,
}) {
  if (
    ![ipLimit, accountLimit, windowSeconds].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  ) {
    throw new Error('Auth throttle limits must be positive integers.');
  }
  return {
    async consume(operation, { ip, email }) {
      // All API instances use the database clock and the same atomic counters.
      const buckets = [
        { key: throttleKey(operation, 'ip', ip || 'unknown'), limit: ipLimit },
        { key: throttleKey(operation, 'email', email), limit: accountLimit },
      ];
      for (const bucket of buckets) {
        const [row] = await prisma.$queryRaw`
          INSERT INTO auth_throttles (key, attempts, expires_at)
          VALUES (${bucket.key}, 1, CURRENT_TIMESTAMP + ${windowSeconds} * INTERVAL '1 second')
          ON CONFLICT (key) DO UPDATE SET
            attempts = CASE WHEN auth_throttles.expires_at <= CURRENT_TIMESTAMP THEN 1
              ELSE LEAST(auth_throttles.attempts, 2147483646) + 1 END,
            expires_at = CASE WHEN auth_throttles.expires_at <= CURRENT_TIMESTAMP
              THEN CURRENT_TIMESTAMP + ${windowSeconds} * INTERVAL '1 second'
              ELSE auth_throttles.expires_at END
          RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - CURRENT_TIMESTAMP))))::integer AS retry_after
        `;
        if (row.attempts > bucket.limit) {
          const error = new ApiError(
            429,
            'RATE_LIMITED',
            'Too many authentication attempts. Try again later.',
          );
          error.retryAfter = row.retry_after;
          throw error;
        }
      }
      // Bounded maintenance never deletes a live bucket.
      await prisma.$executeRaw`
        DELETE FROM auth_throttles WHERE key IN (
          SELECT key FROM auth_throttles WHERE expires_at <= CURRENT_TIMESTAMP
          ORDER BY expires_at LIMIT 100
        ) AND expires_at <= CURRENT_TIMESTAMP
      `;
    },
  };
}
