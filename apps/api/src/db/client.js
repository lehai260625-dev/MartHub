import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createDatabase(databaseUrl) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3000,
    max: 10,
    // Prisma's PostgreSQL adapter serializes Date values without an offset.
    // Keep application timestamps independent of the server's default timezone.
    options: '-c timezone=UTC',
  });
  const prisma = new PrismaClient({
    adapter,
    omit: { user: { passwordHash: true }, refreshSession: { tokenHash: true } },
  });
  return {
    prisma,
    async ready() {
      await prisma.$queryRaw`SELECT 1`;
    },
    async close() {
      await prisma.$disconnect();
    },
  };
}
