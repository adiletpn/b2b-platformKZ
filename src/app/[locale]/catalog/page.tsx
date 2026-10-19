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
  const [cities, zones, offers, total] = await Promise.all([
    prisma.city.findMany({ orderBy: { nameRu: 'asc' } }),
    prisma.deliveryZone.findMany({ where: { supplierId } }),
    prisma.supplierOffer.findMany({
      where: { supplierId },
      include: { product: { include: { unit: true } }, vatRate: true },
      orderBy: { product: { nameRu: 'asc' } },
      take: 100,
    }),
    prisma.supplierOffer.count({ where: { supplierId } }),
  ]);

  return (
    <CatalogScreen
      locale={locale === 'kk' ? 'kk' : 'ru'}
      cities={cities.map((city) => ({
        id: city.id,
        name: locale === 'kk' ? city.nameKk : city.nameRu,
      }))}
      selectedZones={zones.map((zone) => ({
        cityId: zone.cityId,
        minOrderAmount: zone.minOrderAmount.toFixed(2),
        leadTimeDays: zone.leadTimeDays,
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
