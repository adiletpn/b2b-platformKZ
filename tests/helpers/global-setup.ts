import { execSync } from 'node:child_process';
import {
  createTestPrisma,
  resetPlatformFlags,
  resetTransactionalData,
  testDatabaseUrl,
} from './test-db';

/** Готовит тестовую базу: миграции, справочники, пустые операционные таблицы. */
export async function prepareTestDatabase() {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'pipe' });

  const prisma = createTestPrisma();
  await resetTransactionalData(prisma);
  await resetPlatformFlags(prisma);
  await prisma.$disconnect();
}

export default prepareTestDatabase;
