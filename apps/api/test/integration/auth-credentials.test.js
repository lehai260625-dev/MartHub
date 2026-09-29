import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createDatabase } from '../../src/db/client.js';
import { validateDatabaseUrl } from '../../src/config/env.js';
import { createCredentials } from '../../src/modules/auth/credentials.js';
import {
  createAuthThrottle,
  throttleKey,
} from '../../src/modules/auth/throttle.js';

test('credentials normalize email, reject privilege injection, hash secrets and reject invalid/disabled login', async () => {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const prisma = database.prisma;
  const marker = randomUUID();
  const email = `auth-${marker}@example.test`;
  const missingEmail = `missing-${marker}@example.test`;
  const ip = marker;
  const credentials = createCredentials({ prisma });
  const input = {
    email: `  ${email.toUpperCase()}  `,
    password: 'Correct horse battery staple',
    firstName: 'Account',
    lastName: 'Test',
  };
  try {
    await assert.rejects(
      credentials.register({ ...input, role: 'ADMIN' }, { ip }),
      { status: 422 },
    );
    const user = await credentials.register(input, { ip });
    assert.equal(user.email, email);
    assert.equal(user.role, 'CUSTOMER');
    assert.equal(user.status, 'ACTIVE');
    assert.equal(Object.hasOwn(user, 'passwordHash'), false);
    const stored = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    assert.match(stored.passwordHash, /^\$argon2id\$/);
    assert.notEqual(stored.passwordHash, input.password);
    await assert.rejects(credentials.register(input, { ip }), {
      status: 409,
      code: 'EMAIL_IN_USE',
    });
    assert.equal(
      (
        await credentials.login(
          { email: input.email, password: input.password },
          { ip },
        )
      ).id,
      user.id,
    );
    assert.ok(
      (await prisma.user.findUnique({ where: { id: user.id } }))
        .lastLoginAt instanceof Date,
    );
    const failures = [];
    for (const attempt of [
      { email, password: 'Incorrect password goes here' },
      { email: missingEmail, password: input.password },
    ]) {
      try {
        await credentials.login(attempt, { ip });
      } catch (error) {
        failures.push([error.status, error.code, error.message]);
      }
    }
    for (const status of ['SUSPENDED', 'ARCHIVED']) {
      await prisma.user.update({ where: { id: user.id }, data: { status } });
      try {
        await credentials.login({ email, password: input.password }, { ip });
      } catch (error) {
        failures.push([error.status, error.code, error.message]);
      }
    }
    assert.equal(failures.length, 4);
    assert.ok(
      failures.every(
        (failure) => JSON.stringify(failure) === JSON.stringify(failures[0]),
      ),
    );
    assert.equal(failures[0][0], 401);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', archivedAt: new Date() },
    });
    await assert.rejects(
      credentials.login({ email, password: input.password }, { ip }),
      { status: 401, code: 'INVALID_CREDENTIALS' },
    );
    await assert.rejects(
      credentials.register({ ...input, password: 'short' }, { ip }),
      { status: 422 },
    );
  } finally {
    await prisma.user.deleteMany({ where: { email } });
    const keys = ['register', 'login'].flatMap((operation) => [
      throttleKey(operation, 'ip', ip),
      throttleKey(operation, 'email', email),
      throttleKey(operation, 'email', missingEmail),
    ]);
    await prisma.authThrottle.deleteMany({ where: { key: { in: keys } } });
    await database.close();
  }
});

test('PostgreSQL throttle caps concurrent requests across API instances and resets expired buckets', async () => {
  const database = createDatabase(
    validateDatabaseUrl(process.env.DATABASE_URL),
  );
  const other = createDatabase(validateDatabaseUrl(process.env.DATABASE_URL));
  const prisma = database.prisma;
  const marker = randomUUID();
  const input = { ip: marker, email: `${marker}@example.test` };
  const keys = [
    throttleKey(marker, 'ip', input.ip),
    throttleKey(marker, 'email', input.email),
  ];
  try {
    const first = createAuthThrottle({ prisma, ipLimit: 100, accountLimit: 3 });
    const second = createAuthThrottle({
      prisma: other.prisma,
      ipLimit: 100,
      accountLimit: 3,
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        (i % 2 ? first : second).consume(marker, input),
      ),
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      3,
    );
    for (const outcome of outcomes.filter(
      (value) => value.status === 'rejected',
    )) {
      assert.equal(outcome.reason.status, 429);
      assert.ok(
        outcome.reason.retryAfter > 0 && outcome.reason.retryAfter <= 900,
      );
    }
    const rows = await prisma.authThrottle.findMany({
      where: { key: { in: keys } },
    });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key)));
    await prisma.authThrottle.updateMany({
      where: { key: { in: keys } },
      data: { expiresAt: new Date(0) },
    });
    await first.consume(marker, input);
    assert.ok(
      (
        await prisma.authThrottle.findMany({ where: { key: { in: keys } } })
      ).every((row) => row.attempts === 1),
    );
    const ipLimited = createAuthThrottle({
      prisma,
      ipLimit: 1,
      accountLimit: 100,
    });
    await assert.rejects(ipLimited.consume(marker, input), { status: 429 });
    await prisma.authThrottle.updateMany({
      where: { key: { in: keys } },
      data: { attempts: 2147483647 },
    });
    await assert.rejects(ipLimited.consume(marker, input), { status: 429 });
  } finally {
    await prisma.authThrottle.deleteMany({ where: { key: { in: keys } } });
    await Promise.all([database.close(), other.close()]);
  }
});
