import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';

// Prisma 7 больше не читает .env сам. Node читает файл нативно, без лишней зависимости.
try {
  loadEnvFile('.env');
} catch {
  // .env может отсутствовать в CI — тогда переменные приходят из окружения.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // На сборке переменной может не быть: `prisma generate` обязан отработать и без неё.
  datasource: { url: process.env.DATABASE_URL ?? '' },
  migrations: { seed: 'tsx --env-file-if-exists=.env prisma/seed.ts' },
});
