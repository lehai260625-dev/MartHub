import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';

test('identity and refresh schema enforce normalization, uniqueness, and lineage', async () => {
  const db = createDatabase(validateDatabaseUrl(process.env.DATABASE_URL));
  const id = randomUUID();
  const email = `schema-${id}@example.test`;
  const userData = {
    id,
    email,
    passwordHash: 'test-only-hash',
    firstName: 'Minh',
    lastName: 'Nguyen',
  };
  try {
    const user = await db.prisma.user.create({ data: userData });
    assert.equal(user.role, 'CUSTOMER');
    assert.equal(user.status, 'ACTIVE');
    await assert.rejects(
      db.prisma.user.create({ data: { ...userData, id: randomUUID() } }),
    );
    for (const invalidEmail of [
      email.toUpperCase(),
      ' ' + email,
      email + ' ',
    ]) {
      await assert.rejects(
        db.prisma.user.create({
          data: { ...userData, id: randomUUID(), email: invalidEmail },
        }),
      );
    }
    const familyId = randomUUID();
    const tokenHash = randomBytes(32).toString('hex');
    const root = await db.prisma.refreshSession.create({
      data: {
        userId: id,
        familyId,
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const child = await db.prisma.refreshSession.create({
      data: {
        userId: id,
        familyId,
        parentSessionId: root.id,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: root.expiresAt,
      },
    });
    assert.equal(child.parentSessionId, root.id);
    await assert.rejects(
      db.prisma.refreshSession.create({
        data: {
          userId: id,
          familyId,
          tokenHash,
          expiresAt: root.expiresAt,
        },
      }),
    );
    await assert.rejects(
      db.prisma.refreshSession.create({
        data: {
          userId: id,
          familyId,
          tokenHash: 'raw-opaque-token-is-not-a-hash',
          expiresAt: root.expiresAt,
        },
      }),
    );
    await assert.rejects(
      db.prisma.refreshSession.create({
        data: {
          userId: randomUUID(),
          familyId,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: root.expiresAt,
        },
      }),
    );
    await db.prisma.refreshSession.update({
      where: { id: root.id },
      data: {
        revokedAt: new Date(),
        revokeReason: 'ROTATED',
        lastUsedAt: new Date(),
      },
    });
    const revoked = await db.prisma.refreshSession.findUnique({
      where: { id: root.id },
    });
    assert.equal(revoked.revokeReason, 'ROTATED');
    assert.ok(revoked.revokedAt);
    const indexes = await db.prisma
      .$queryRaw`SELECT indexdef FROM pg_indexes WHERE tablename = 'refresh_sessions'`;
    const definitions = indexes.map((row) => row.indexdef).join('\n');
    for (const column of ['token_hash', 'user_id', 'family_id', 'expires_at'])
      assert.ok(definitions.includes(column), column);
    const dates = await db.prisma
      .$queryRaw`SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('users', 'refresh_sessions') AND column_name IN ('created_at', 'updated_at', 'expires_at', 'revoked_at')`;
    assert.ok(dates.length >= 5);
    assert.ok(
      dates.every((row) => row.data_type === 'timestamp with time zone'),
    );
  } finally {
    await db.prisma.refreshSession.deleteMany({ where: { userId: id } });
    await db.prisma.user.deleteMany({ where: { email: { contains: id } } });
    await db.close();
  }
});
