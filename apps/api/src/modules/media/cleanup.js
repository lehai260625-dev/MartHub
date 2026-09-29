import { MEDIA_CLEANUP_MAX_ATTEMPTS } from '../../config/media.js';

function safeErrorCode(error) {
  const code =
    typeof error?.code === 'string' ? error.code : 'CLOUDINARY_ERROR';
  return /^[A-Z0-9_]{1,64}$/u.test(code) ? code : 'CLOUDINARY_ERROR';
}

export async function attemptMediaCleanup({
  prisma,
  media,
  cleanup,
  now = new Date(),
}) {
  const current = cleanup.id
    ? await prisma.mediaCleanup.findUnique({ where: { id: cleanup.id } })
    : cleanup;
  if (
    !current ||
    current.status === 'COMPLETED' ||
    current.attemptCount >= MEDIA_CLEANUP_MAX_ATTEMPTS
  )
    return current;
  try {
    await media.destroy(current.cloudinaryPublicId, now);
    return prisma.mediaCleanup.update({
      where: { id: current.id },
      data: {
        status: 'COMPLETED',
        attemptCount: current.attemptCount + 1,
        nextAttemptAt: null,
        lastErrorCode: null,
        completedAt: now,
      },
    });
  } catch (error) {
    const attempts = current.attemptCount + 1;
    const failed = attempts >= MEDIA_CLEANUP_MAX_ATTEMPTS;
    const delayMinutes = Math.min(2 ** (attempts - 1), 60);
    return prisma.mediaCleanup.update({
      where: { id: current.id },
      data: {
        status: failed ? 'FAILED' : 'PENDING',
        attemptCount: attempts,
        nextAttemptAt: failed
          ? null
          : new Date(now.getTime() + delayMinutes * 60_000),
        lastErrorCode: safeErrorCode(error),
        completedAt: null,
      },
    });
  }
}

export async function processDueMediaCleanup({
  prisma,
  media,
  now = new Date(),
  limit = 25,
  retryFailed = false,
}) {
  if (retryFailed)
    await prisma.mediaCleanup.updateMany({
      where: { status: 'FAILED' },
      data: {
        status: 'PENDING',
        attemptCount: 0,
        nextAttemptAt: now,
        lastErrorCode: null,
      },
    });
  const rows = await prisma.mediaCleanup.findMany({
    where: {
      status: 'PENDING',
      attemptCount: { lt: MEDIA_CLEANUP_MAX_ATTEMPTS },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  const results = [];
  for (const cleanup of rows)
    results.push(await attemptMediaCleanup({ prisma, media, cleanup, now }));
  return results;
}
