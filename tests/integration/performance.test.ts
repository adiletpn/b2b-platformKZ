import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { getFeed } from '@/lib/feed/query';

/**
 * НФТ раздела 5.4 ТЗ: свайп-лента отдаёт карточку меньше чем за 300 мс,
 * поиск по каталогу — меньше секунды. Здесь 5 000 позиций, чтобы прогон был быстрым;
 * каталог на 100 000 проверяется отдельно командой `npm run perf:feed`.
 */
const OFFERS = 5000;
const PREFIX = 'нагрузка-';

const prisma = createTestPrisma();

let storeId = '';
let cityId = '';

function checkDigit(twelve: string) {
  const digits = twelve.split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * Медиана по прогонам без первого: он греет план запроса. Берём медиану, а не худший
 * прогон: тесты идут на общей машине вместе с остальным набором, и разовый выброс
 * ничего не говорит о запросе. Чистый замер с p50 и p95 — в `npm run perf:feed`.
 */
async function medianOf(runs: number, run: () => Promise<unknown>) {
  await run();
  const times: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
  }
  times.sort((left, right) => left - right);
  return times[Math.floor(times.length / 2)]!;
}

beforeAll(async () => {
  await resetTransactionalData(prisma);

  const city = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  cityId = city.id;
  const unit = await prisma.unit.findFirstOrThrow();
  const vat = await prisma.vatRate.findFirstOrThrow({ where: { isDefault: true } });

  const supplier = await prisma.company.create({
    data: {
      type: 'SUPPLIER',
      bin: `9${String(Date.now()).slice(-11)}`,
      name: 'ТОО «Нагрузочный поставщик»',
      legalForm: 'TOO',
      legalAddress: 'г. Алматы, ул. Нагрузочная, 1',
      verificationStatus: 'VERIFIED',
      deliveryZones: { create: { cityId: city.id, minOrderAmount: '0', leadTimeDays: 1 } },
    },
  });
  const store = await prisma.company.create({
    data: {
      type: 'STORE',
      bin: `8${String(Date.now()).slice(-11)}`,
      name: 'ТОО «Нагрузочный магазин»',
      legalForm: 'TOO',
      legalAddress: 'г. Тараз, ул. Нагрузочная, 2',
      verificationStatus: 'VERIFIED',
      locations: { create: { cityId: city.id, type: 'STORE', address: 'ул. Нагрузочная, 2' } },
    },
  });
  storeId = store.id;

  const products = Array.from({ length: OFFERS }, (_, index) => {
    const twelve = `778${String(index).padStart(9, '0')}`;
    return {
      barcode: `${twelve}${checkDigit(twelve)}`,
      nameRu: `${PREFIX}товар ${index}`,
      nameKk: `${PREFIX}тауар ${index}`,
      unitId: unit.id,
    };
  });
  await prisma.product.createMany({ data: products });

  const saved = await prisma.product.findMany({
    where: { nameRu: { startsWith: PREFIX } },
    select: { id: true },
  });
  const rate = new Decimal(vat.rate.toString()).div(100).plus(1);
  await prisma.supplierOffer.createMany({
    data: saved.map((product, index) => ({
      supplierId: supplier.id,
      productId: product.id,
      priceWithoutVat: new Decimal(100 + index).toFixed(2),
      priceWithVat: new Decimal(100 + index).times(rate).toDecimalPlaces(2).toFixed(2),
      vatRateId: vat.id,
      packSize: '1',
      minBatch: '1',
      stock: '100',
    })),
  });
  // После массовых удалений и вставок статистика планировщика устаревает,
  // и запрос идёт перебором: обновляем её, иначе замер меряет не запрос, а bloat.
  await prisma.$executeRawUnsafe('ANALYZE supplier_offers, products, delivery_zones');
}, 300_000);

afterAll(async () => {
  await resetTransactionalData(prisma);
  await prisma.$disconnect();
});

describe('производительность ленты и поиска', () => {
  it('swipe_card_is_served_under_300ms_on_large_catalog', async () => {
    const median = await medianOf(5, () => getFeed(storeId, cityId, { forSwipe: true, limit: 1 }));
    expect(median).toBeLessThan(300);
  }, 120_000);

  it('search_by_name_and_barcode_is_served_under_one_second', async () => {
    const byName = await medianOf(3, () =>
      getFeed(storeId, cityId, {
        forSwipe: false,
        limit: 50,
        filters: { search: `${PREFIX}товар ${OFFERS - 1}` },
      }),
    );
    const byBarcode = await medianOf(3, () =>
      getFeed(storeId, cityId, { forSwipe: false, limit: 50, filters: { search: '778000000100' } }),
    );

    expect(byName).toBeLessThan(1000);
    expect(byBarcode).toBeLessThan(1000);
  }, 120_000);

  it('feed_page_of_fifty_offers_is_served_under_one_second', async () => {
    const median = await medianOf(3, () =>
      getFeed(storeId, cityId, { forSwipe: false, limit: 50 }),
    );
    expect(median).toBeLessThan(1000);
  }, 120_000);
});
