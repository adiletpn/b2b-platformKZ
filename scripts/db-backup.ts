/**
 * Резервная копия базы (НФТ раздела 5.4 ТЗ: ежедневно, хранение 30 дней).
 * Копии складываются в каталог из BACKUP_DIR (по умолчанию ./backups),
 * файлы старше 30 дней удаляются.
 *
 * Запуск: npm run db:backup            — копия базы из DATABASE_URL
 *         npm run db:backup -- --test  — копия тестовой базы
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile('.env');
} catch {
  // В CI переменные приходят из окружения.
}

const KEEP_DAYS = 30;
const useTest = process.argv.includes('--test');
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(useTest ? 'TEST_DATABASE_URL не задан' : 'DATABASE_URL не задан');

const directory = process.env.BACKUP_DIR ?? 'backups';
if (!existsSync(directory)) mkdirSync(directory, { recursive: true });

/** pg_dump не понимает параметры Prisma вроде ?schema=public — убираем их. */
function toPostgresUrl(value: string) {
  const parsed = new URL(value);
  for (const key of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer']) {
    parsed.searchParams.delete(key);
  }
  return parsed.toString();
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = join(directory, `b2b-${stamp}.dump`);

// Формат custom: восстанавливается pg_restore и сжимается на стороне pg_dump.
execFileSync('pg_dump', ['--format=custom', '--no-owner', '--file', file, toPostgresUrl(url)], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

const size = statSync(file).size;
console.log(`Копия готова: ${file}, ${(size / 1024 / 1024).toFixed(1)} МБ`);

// Правило 11: в лог не попадают строки подключения, только имена файлов.
const edge = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
let removed = 0;
for (const name of readdirSync(directory)) {
  if (!name.startsWith('b2b-') || !name.endsWith('.dump')) continue;
  const path = join(directory, name);
  if (statSync(path).mtimeMs >= edge) continue;
  unlinkSync(path);
  removed += 1;
}
console.log(`Удалено копий старше ${KEEP_DAYS} дней: ${removed}`);
