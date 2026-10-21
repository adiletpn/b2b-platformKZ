import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getStoreContext } from '@/lib/auth/store-context';
import { getFeed } from '@/lib/feed/query';
import { visibleSupplierWhere } from '@/lib/admin/settings';
import { prisma } from '@/lib/prisma';
import { FeedScreen } from './feed-screen';
import { getCartGroups } from '@/lib/cart/cart';

export default async function FeedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const store = await getStoreContext();
  if (!store) redirect({ href: '/login', locale });

  const { companyId, cityId, locationId } = store!;
  const visibleSuppliers = await visibleSupplierWhere();
  const [swipeOffers, listOffers, city, categories, zones, cart, cartGroups] = await Promise.all([
    getFeed(companyId, cityId, { forSwipe: true }),
    getFeed(companyId, cityId, { forSwipe: false }),
    prisma.city.findUniqueOrThrow({ where: { id: cityId } }),
    prisma.category.findMany({ orderBy: { nameRu: 'asc' } }),
    prisma.deliveryZone.findMany({
      where: { cityId, supplier: visibleSuppliers },
      include: { supplier: true },
    }),
    prisma.cart.findUnique({ where: { locationId }, include: { items: true } }),
    getCartGroups(locationId, cityId),
  ]);

  const brands = [...new Set(listOffers.map((offer) => offer.brand).filter(Boolean))] as string[];

  return (
    <FeedScreen
      locale={locale === 'kk' ? 'kk' : 'ru'}
      cityName={locale === 'kk' ? city.nameKk : city.nameRu}
      initialSwipeOffers={swipeOffers}
      initialListOffers={listOffers}
      categories={categories.map((category) => ({
        id: category.id,
        name: locale === 'kk' ? category.nameKk : category.nameRu,
      }))}
      suppliers={zones.map((zone) => ({ id: zone.supplierId, name: zone.supplier.name }))}
      brands={brands}
      initialCartGroups={cartGroups}
      cartQuantities={Object.fromEntries(
        (cart?.items ?? []).map((item) => [item.offerId, item.quantity.toFixed(3)]),
      )}
    />
  );
}
