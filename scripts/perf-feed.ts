/**
 * Проверка НФТ раздела 5.4 ТЗ: свайп-лента отдаёт карточку быстрее 300 мс,
 * поиск по каталогу — быстрее секунды. Работает на тестовой базе и чистит за собой.
 *
 * Запуск: npm run perf:feed -- 20000
 */
import { loadEnvFile } from 'node:process';
import Decimal from 'decimal.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

try {
  loadEnvFile('.env');
} catch {
  // В CI переменные приходят из окружения.
}

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL не задан');
process.env.DATABASE_URL = url;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const OFFERS = Number(process.argv[2] ?? 20000);
const PREFIX = 'perf-';

function checkDigit(twelve: string) {
  const digits = twelve.split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

async function measure(name: string, runs: number, run: () => Promise<unknown>) {
  const times: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
  }
  times.sort((left, right) => left - right);
  const p50 = times[Math.floor(times.length * 0.5)]!;
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]!;
  console.log(`${name}: p50 ${p50.toFixed(0)} мс, p95 ${p95.toFixed(0)} мс (прогонов ${runs})`);
  return { p50, p95 };
}

async function main() {
  const { getFeed } = await import('../src/lib/feed/query');

  const city = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
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

  console.log(`Готовим каталог: ${OFFERS} позиций…`);
  const started = performance.now();
  const BATCH = 2000;
  for (let from = 0; from < OFFERS; from += BATCH) {
    const size = Math.min(BATCH, OFFERS - from);
    const products = Array.from({ length: size }, (_, index) => {
      const number = from + index;
      const twelve = `777${String(number).padStart(9, '0')}`;
      return {
        barcode: `${twelve}${checkDigit(twelve)}`,
        nameRu: `${PREFIX}товар ${number}`,
        nameKk: `${PREFIX}тауар ${number}`,
        brand: `${PREFIX}бренд ${number % 50}`,
        unitId: unit.id,
      };
    });
    await prisma.product.createMany({ data: products });

    const saved = await prisma.product.findMany({
      where: { barcode: { in: products.map((product) => product.barcode) } },
      select: { id: true },
    });
    await prisma.supplierOffer.createMany({
      data: saved.map((product, index) => ({
        supplierId: supplier.id,
        productId: product.id,
        priceWithoutVat: new Decimal(100 + index).toFixed(2),
        priceWithVat: new Decimal(100 + index)
          .times(new Decimal(vat.rate.toString()).div(100).plus(1))
          .toDecimalPlaces(2)
          .toFixed(2),
        vatRateId: vat.id,
        packSize: '1',
        minBatch: '1',
        stock: '100',
      })),
    });
  }
  console.log(`Каталог готов за ${((performance.now() - started) / 1000).toFixed(1)} с`);

  const results = {
    swipe: await measure('свайп-лента (первая карточка)', 20, () =>
      getFeed(store.id, city.id, { forSwipe: true, limit: 1 }),
    ),
    page: await measure('лента списком, 50 позиций', 10, () =>
      getFeed(store.id, city.id, { forSwipe: false, limit: 50 }),
    ),
    searchName: await measure('поиск по названию', 10, () =>
      getFeed(store.id, city.id, {
        forSwipe: false,
        limit: 50,
        filters: { search: `${PREFIX}товар ${Math.floor(OFFERS / 2)}` },
      }),
    ),
    searchBarcode: await measure('поиск по штрихкоду', 10, () =>
      getFeed(store.id, city.id, {
        forSwipe: false,
        limit: 50,
        filters: { search: '777000000500' },
      }),
    ),
  };

  await prisma.supplierOffer.deleteMany({ where: { supplierId: supplier.id } });
  await prisma.product.deleteMany({ where: { nameRu: { startsWith: PREFIX } } });
  await prisma.company.deleteMany({ where: { id: { in: [supplier.id, store.id] } } });

  const budgets = { swipe: 300, page: 1000, searchName: 1000, searchBarcode: 1000 };
  let failed = false;
  for (const [key, budget] of Object.entries(budgets)) {
    const value = results[key as keyof typeof results].p95;
    const verdict = value <= budget ? 'ок' : 'ВЫШЕ БЮДЖЕТА';
    if (value > budget) failed = true;
    console.log(`${key}: бюджет ${budget} мс — ${verdict}`);
  }

  await prisma.$disconnect();
  if (failed) process.exitCode = 1;
}

await main();
