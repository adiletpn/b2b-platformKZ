import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';
import { CatalogScreen } from './catalog-screen';

export default async function CatalogPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const supplierId = active!.companyId;
  const [cities, zones, offers, total, units, categories, vatRates] = await Promise.all([
    prisma.city.findMany({ orderBy: { nameRu: 'asc' } }),
    prisma.deliveryZone.findMany({ where: { supplierId } }),
    prisma.supplierOffer.findMany({
      where: { supplierId },
      include: { product: { include: { unit: true } }, vatRate: true },
      orderBy: { product: { nameRu: 'asc' } },
      take: 100,
    }),
    prisma.supplierOffer.count({ where: { supplierId } }),
    prisma.unit.findMany({ orderBy: { code: 'asc' } }),
    prisma.category.findMany({ orderBy: { code: 'asc' } }),
    prisma.vatRate.findMany({ orderBy: { rate: 'desc' } }),
  ]);

  return (
    <CatalogScreen
      locale={locale === 'kk' ? 'kk' : 'ru'}
      cities={cities.map((city) => ({
        id: city.id,
        name: locale === 'kk' ? city.nameKk : city.nameRu,
      }))}
      units={units.map((unit) => ({
        code: unit.code,
        name: locale === 'kk' ? unit.nameKk : unit.nameRu,
      }))}
      categories={categories.map((category) => ({
        code: category.code,
        name: locale === 'kk' ? category.nameKk : category.nameRu,
      }))}
      vatRates={vatRates.map((rate) => ({
        code: rate.code,
        name: `${locale === 'kk' ? rate.nameKk : rate.nameRu} (${rate.rate.toFixed(2)}%)`,
      }))}
      defaultVatCode={(vatRates.find((rate) => rate.isDefault) ?? vatRates[0])?.code ?? ''}
      selectedZones={zones.map((zone) => ({
        cityId: zone.cityId,
        minOrderAmount: zone.minOrderAmount.toFixed(2),
        leadTimeDays: String(zone.leadTimeDays),
        deliveryDays: zone.deliveryDays,
      }))}
      initialTotal={total}
      initialOffers={offers.map((offer) => ({
        id: offer.id,
        barcode: offer.product.barcode,
        nameRu: offer.product.nameRu,
        nameKk: offer.product.nameKk,
        unitRu: offer.product.unit.nameRu,
        unitKk: offer.product.unit.nameKk,
        priceWithoutVat: offer.priceWithoutVat.toFixed(2),
        priceWithVat: offer.priceWithVat.toFixed(2),
        vatRate: offer.vatRate.rate.toFixed(2),
        stock: offer.stock.toFixed(3),
        minBatch: offer.minBatch.toFixed(3),
      }))}
    />
  );
}
