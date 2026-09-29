import { defineConfig } from 'prisma/config';
import { validateDatabaseUrl } from './src/config/env.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: validateDatabaseUrl(process.env.DATABASE_URL) },
});
