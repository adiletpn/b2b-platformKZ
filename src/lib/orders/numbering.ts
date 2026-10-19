import type { Prisma } from '@/generated/prisma/client';

const PREFIXES: Record<string, string> = {
  order: 'ЗАК',
  waybill: 'З-2',
  invoice: 'СЧТ',
  discrepancy: 'АКТ',
  return: 'ВОЗВ',
  settlement: 'СВЕР',
  transfer: 'ПЕРЕМ',
  writeoff: 'СПИС',
  stocktake: 'ИНВ',
};

/** Нумерация отдельная у каждой компании и года (раздел 3.5 ТЗ). */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
  kind: keyof typeof PREFIXES | string,
  now = new Date(),
) {
  const year = now.getFullYear();
  const sequence = await tx.numberSequence.upsert({
    where: { companyId_kind_year: { companyId, kind, year } },
    update: { lastNumber: { increment: 1 } },
    create: { companyId, kind, year, lastNumber: 1 },
  });

  const prefix = PREFIXES[kind] ?? kind.toUpperCase();
  return `${prefix}-${year}-${String(sequence.lastNumber).padStart(6, '0')}`;
}
