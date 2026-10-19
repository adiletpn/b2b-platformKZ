import { afterAll, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../helpers/test-db';

const prisma = createTestPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('справочники', () => {
  it('vat_rate_is_read_from_database_not_code', async () => {
    const current = await prisma.vatRate.findFirstOrThrow({ where: { isDefault: true } });
    // Правило 5: ставка лежит в справочнике. Раздел 2 ТЗ: с 01.01.2026 — 16%.
    expect(current.rate.toFixed(2)).toBe('16.00');
    expect(current.validFrom.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(current.validTo).toBeNull();
  });

  it('vat_rates_keep_history_of_previous_rate', async () => {
    const previous = await prisma.vatRate.findUniqueOrThrow({ where: { code: 'vat-12' } });
    expect(previous.rate.toFixed(2)).toBe('12.00');
    expect(previous.validTo).not.toBeNull();
  });

  it('city_reference_has_both_languages_for_demo_cities', async () => {
    const cities = await prisma.city.findMany({ where: { code: { in: ['almaty', 'taraz'] } } });
    expect(cities).toHaveLength(2);
    for (const city of cities) {
      expect(city.nameRu.length).toBeGreaterThan(0);
      expect(city.nameKk.length).toBeGreaterThan(0);
    }
  });
});
