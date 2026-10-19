import { prisma } from '@/lib/prisma';

/**
 * Правило 10: повторное нажатие с тем же ключом возвращает прежний результат
 * и не создаёт второй документ.
 */
export async function withIdempotency<T>(
  key: string | undefined,
  companyId: string,
  operation: string,
  run: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (!key) return { result: await run(), replayed: false };

  const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
  if (existing) return { result: existing.result as T, replayed: true };

  const result = await run();
  await prisma.idempotencyKey.create({
    data: { key, companyId, operation, result: result as never },
  });

  return { result, replayed: false };
}
