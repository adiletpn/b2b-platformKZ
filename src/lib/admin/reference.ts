import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { writeAdminAudit } from './session';

export type ReferenceRow = {
  id: string;
  code: string;
  nameRu: string;
  nameKk: string;
  extra?: string;
};

export type ReferenceData = {
  vatRates: ReferenceRow[];
  units: ReferenceRow[];
  categories: ReferenceRow[];
  cities: ReferenceRow[];
};

/** Справочники платформы: ставки НДС, единицы, категории и города (правило 5). */
export async function getReferenceData(): Promise<ReferenceData> {
  const [vatRates, units, categories, cities] = await Promise.all([
    prisma.vatRate.findMany({ orderBy: { rate: 'desc' } }),
    prisma.unit.findMany({ orderBy: { code: 'asc' } }),
    prisma.category.findMany({ orderBy: { code: 'asc' } }),
    prisma.city.findMany({ orderBy: { nameRu: 'asc' }, take: 100 }),
  ]);

  return {
    vatRates: vatRates.map((rate) => ({
      id: rate.id,
      code: rate.code,
      nameRu: rate.nameRu,
      nameKk: rate.nameKk,
      extra: `${rate.rate.toFixed(2)}%${rate.isDefault ? ' ·' : ''}`,
    })),
    units: units.map((unit) => ({
      id: unit.id,
      code: unit.code,
      nameRu: unit.nameRu,
      nameKk: unit.nameKk,
    })),
    categories: categories.map((category) => ({
      id: category.id,
      code: category.code,
      nameRu: category.nameRu,
      nameKk: category.nameKk,
    })),
    cities: cities.map((city) => ({
      id: city.id,
      code: city.code,
      nameRu: city.nameRu,
      nameKk: city.nameKk,
    })),
  };
}

export type ReferenceKind = 'vatRate' | 'unit' | 'category';

export type ReferenceInput = {
  kind: ReferenceKind;
  code: string;
  nameRu: string;
  nameKk: string;
  /** Для ставки НДС: процент и признак ставки по умолчанию. */
  rate?: string;
  isDefault?: boolean;
};

export type ReferenceResult = { status: 'ok'; id: string } | { status: 'invalid_entry' };

/**
 * Контент-менеджер правит справочники из админки. Ставка НДС хранится Decimal,
 * ставка по умолчанию в справочнике всегда одна (правила 1 и 5).
 */
export async function saveReferenceEntry(
  adminId: string,
  input: ReferenceInput,
): Promise<ReferenceResult> {
  // Код не приводим к верхнему регистру: в справочниках сида он строчный («vat-16»),
  // иначе правка существующей записи создавала бы дубль.
  const code = input.code.trim();
  if (!code || !input.nameRu.trim() || !input.nameKk.trim()) return { status: 'invalid_entry' };
  const names = { nameRu: input.nameRu.trim(), nameKk: input.nameKk.trim() };

  let id: string;
  if (input.kind === 'vatRate') {
    const rate = new Decimal((input.rate ?? '').replace(',', '.'));
    if (!rate.isFinite() || rate.isNegative() || rate.greaterThan(100))
      return { status: 'invalid_entry' };
    const value = rate.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

    const saved = await prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.vatRate.updateMany({ data: { isDefault: false } });
      return tx.vatRate.upsert({
        where: { code },
        update: { ...names, rate: value, isDefault: input.isDefault === true },
        create: {
          code,
          ...names,
          rate: value,
          validFrom: new Date(),
          isDefault: input.isDefault === true,
        },
      });
    });
    id = saved.id;
  } else if (input.kind === 'unit') {
    const saved = await prisma.unit.upsert({
      where: { code },
      update: names,
      create: { code, ...names },
    });
    id = saved.id;
  } else {
    const saved = await prisma.category.upsert({
      where: { code },
      update: names,
      create: { code, ...names },
    });
    id = saved.id;
  }

  await writeAdminAudit(adminId, 'reference_entry_saved', { entity: input.kind, entityId: id });
  return { status: 'ok', id };
}
