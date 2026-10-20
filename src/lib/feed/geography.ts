import { visibleSupplierWhere } from '@/lib/admin/settings';
import { prisma } from '@/lib/prisma';

export type CityPoint = {
  companyId: string;
  companyName: string;
  type: 'STORE' | 'WAREHOUSE';
  address: string;
  deliversToCity: boolean;
};

export type NearbySupplier = {
  companyId: string;
  companyName: string;
  cityNameRu: string;
  cityNameKk: string;
  /** Доставка в город магазина не указана — договариваются в чате (раздел 3.9 ТЗ). */
  deliversToYourCity: false;
};

export type Geography = { points: CityPoint[]; nearby: NearbySupplier[] };

/**
 * Раздел 3.9 ТЗ: точки и склады поставщиков в городе для карты и поиск
 * поставщиков в соседних городах — тех, что в той же области.
 */
export async function getGeography(cityId: string): Promise<Geography> {
  const city = await prisma.city.findUnique({ where: { id: cityId } });
  if (!city) return { points: [], nearby: [] };
  // Флаг hide_demo_companies прячет тестовые компании и с карты.
  const visible = await visibleSupplierWhere();

  const deliveringIds = new Set(
    (await prisma.deliveryZone.findMany({ where: { cityId }, select: { supplierId: true } })).map(
      (zone) => zone.supplierId,
    ),
  );

  const locations = await prisma.location.findMany({
    where: { cityId, company: { type: { not: 'STORE' }, ...visible } },
    include: { company: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  const points = locations.map<CityPoint>((location) => ({
    companyId: location.company.id,
    companyName: location.company.name,
    type: location.type === 'WAREHOUSE' ? 'WAREHOUSE' : 'STORE',
    address: location.address,
    deliversToCity: deliveringIds.has(location.company.id),
  }));

  // Соседние города — города той же области; у городов республиканского значения области нет.
  const neighbourCities = city.regionId
    ? await prisma.city.findMany({ where: { regionId: city.regionId, id: { not: cityId } } })
    : [];

  const nearbyZones = neighbourCities.length
    ? await prisma.deliveryZone.findMany({
        where: {
          cityId: { in: neighbourCities.map((item) => item.id) },
          supplierId: { notIn: [...deliveringIds] },
          supplier: visible,
        },
        include: {
          supplier: { select: { id: true, name: true } },
          city: { select: { nameRu: true, nameKk: true } },
        },
        take: 50,
      })
    : [];

  const seen = new Set<string>();
  const nearby: NearbySupplier[] = [];
  for (const zone of nearbyZones) {
    if (seen.has(zone.supplier.id)) continue;
    seen.add(zone.supplier.id);
    nearby.push({
      companyId: zone.supplier.id,
      companyName: zone.supplier.name,
      cityNameRu: zone.city.nameRu,
      cityNameKk: zone.city.nameKk,
      deliversToYourCity: false,
    });
  }

  return { points, nearby };
}
