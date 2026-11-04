/**
 * Фото и товары макета в уже заполненной базе: `npm run db:seed:photos`. Перезапускать демо-сид
 * нельзя (он заново создаёт заявки), а этот скрипт трогает только демо-штрихкоды: заявки, документы
 * и остатки складов не меняет, повторный запуск ничего не дублирует. Поставщик определяется
 * по его товару, поэтому компании вне демо-каталога не затрагиваются.
 */
import { prisma } from '../src/lib/prisma';
import { MOCKUP_DAIRY, MOCKUP_GROCERY, PHOTO_BY_BARCODE, type DemoProduct } from './demo-products';
import Decimal from 'decimal.js';

async function addProducts(sampleBarcode: string, items: DemoProduct[]) {
  const sample = await prisma.supplierOffer.findFirst({
    where: { product: { barcode: sampleBarcode } },
    include: { vatRate: true, product: true },
  });
  if (!sample) return 0;
  for (const item of items) {
    const unit = await prisma.unit.findUniqueOrThrow({ where: { code: item.unit } });
    const category = await prisma.category.findUnique({ where: { code: item.category } });
    const product = await prisma.product.upsert({
      where: { barcode: item.barcode },
      update: {},
      create: {
        barcode: item.barcode,
        nameRu: item.nameRu,
        nameKk: item.nameKk,
        brand: sample.product.brand,
        manufacturer: sample.product.manufacturer,
        country: sample.product.country,
        categoryId: category?.id ?? null,
        unitId: unit.id,
      },
    });
    const price = new Decimal(item.priceWithoutVat);
    await prisma.supplierOffer.upsert({
      where: { supplierId_productId: { supplierId: sample.supplierId, productId: product.id } },
      update: {},
      create: {
        supplierId: sample.supplierId,
        productId: product.id,
        sku: item.barcode.slice(-6),
        priceWithoutVat: price.toFixed(2),
        priceWithVat: price
          .times(new Decimal(sample.vatRate.rate.toString()).div(100).plus(1))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toFixed(2),
        vatRateId: sample.vatRateId,
        packSize: item.packSize,
        minBatch: item.minBatch,
        stock: item.stock,
      },
    });
  }
  return items.length;
}

async function main() {
  // Гречка и айран есть только у основных демо-поставщиков бакалеи и молочного.
  const added =
    (await addProducts('4870001000087', MOCKUP_GROCERY)) +
    (await addProducts('4870002000062', MOCKUP_DAIRY));
  let photos = 0;
  for (const [barcode, url] of Object.entries(PHOTO_BY_BARCODE)) {
    const result = await prisma.product.updateMany({
      where: { barcode },
      data: { photoUrls: [url] },
    });
    photos += result.count;
  }
  console.log(`Товаров макета: ${added}, фото обновлено: ${photos}`);
}

main().finally(() => prisma.$disconnect());
