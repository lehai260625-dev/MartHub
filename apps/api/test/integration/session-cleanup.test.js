import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../../src/db/client.js';
import {
  cleanupRefreshSessionBatch,
  cleanupRefreshSessions,
} from '../../src/modules/auth/cleanup.js';

async function fixture(t) {
  const database = createDatabase(process.env.DATABASE_URL);
  const user = await database.prisma.user.create({
    data: {
      email: `cleanup-${randomUUID()}@example.test`,
      passwordHash: 'test-only-unused',
      firstName: 'Cleanup',
      lastName: 'Test',
    },
  });
  const [{ now }] = await database.prisma
    .$queryRaw`SELECT CURRENT_TIMESTAMP AS now`;
  const days = (n) => new Date(now.getTime() + n * 86400000);
  const row = (familyId, expiresAt, extra = {}) => ({
    id: randomUUID(),
    userId: user.id,
    tokenHash: randomBytes(32).toString('hex'),
    familyId,
    expiresAt,
    ...extra,
  });
  t.after(async () => {
    await database.prisma.user.delete({ where: { id: user.id } });
    await database.close();
  });
  return { ...database, user, row, days };
}

test('cleanup preserves active/future/rotated/replay lineage and grace; deletes only old terminal families leaf-first', async (t) => {
  const { prisma, row, days, user } = await fixture(t);
  const active = randomUUID(),
    rotated = randomUUID(),
    grace = randomUUID(),
    revoked = randomUUID(),
    old = randomUUID();
  const parent = row(rotated, days(-90), {
    revokedAt: days(-89),
    revokeReason: 'ROTATED',
  });
  const oldParent = row(old, days(-61), {
    revokedAt: days(-60),
    revokeReason: 'ROTATED',
  });
  await prisma.refreshSession.createMany({
    data: [
      row(active, days(1)),
      parent,
      row(rotated, days(1), { parentSessionId: parent.id }),
      row(grace, days(-29)),
      row(revoked, days(-80), {
        revokedAt: days(-29),
        revokeReason: 'REUSE_DETECTED',
      }),
      row(randomUUID(), days(1), {
        revokedAt: days(-31),
        revokeReason: 'LOGOUT',
      }),
      row(randomUUID(), days(-30)),
      oldParent,
      row(old, days(-61), {
        parentSessionId: oldParent.id,
        revokedAt: days(-60),
        revokeReason: 'LOGOUT',
      }),
    ],
  });
  const summary = await cleanupRefreshSessions(prisma);
  assert.equal(summary.deletedRows, 3);
  assert.equal(
    await prisma.refreshSession.count({ where: { familyId: old } }),
    0,
  );
  assert.equal(
    await prisma.refreshSession.count({ where: { userId: user.id } }),
    6,
  );
  assert.equal(
    await prisma.refreshSession.count({ where: { familyId: rotated } }),
    2,
  );
  assert.equal((await cleanupRefreshSessions(prisma)).deletedRows, 0);
});

test('cleanup skips a locked session owner, then safely resumes after the auth lock releases', async (t) => {
  const { prisma, row, days, user } = await fixture(t);
  await prisma.refreshSession.create({ data: row(randomUUID(), days(-31)) });
  let entered, release;
  const locked = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const transaction = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
    entered();
    await gate;
  });
  await locked;
  try {
    assert.equal(await cleanupRefreshSessionBatch(prisma), 0);
    assert.equal(
      await prisma.refreshSession.count({ where: { userId: user.id } }),
      1,
    );
  } finally {
    release();
    await transaction;
  }
  assert.equal(await cleanupRefreshSessionBatch(prisma), 1);
});

test('500-row batches, bounded invocation, idempotence and concurrent cleanup retain exactly-once deletes', async (t) => {
  const { prisma, row, days, user } = await fixture(t);
  const familyId = randomUUID();
  await prisma.refreshSession.createMany({
    data: Array.from({ length: 501 }, () => row(familyId, days(-31))),
  });
  const first = await cleanupRefreshSessions(prisma, { maxBatches: 1 });
  assert.equal(first.deletedRows, 500);
  assert.equal(first.batchLimitReached, true);
  assert.equal(
    await prisma.refreshSession.count({ where: { userId: user.id } }),
    1,
  );
  const totals = await Promise.all([
    cleanupRefreshSessionBatch(prisma),
    cleanupRefreshSessionBatch(prisma),
  ]);
  assert.equal(
    totals.reduce((a, b) => a + b, 0),
    1,
  );
  assert.equal((await cleanupRefreshSessions(prisma)).deletedRows, 0);
  await assert.rejects(cleanupRefreshSessionBatch(prisma, 501));
});
