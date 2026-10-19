import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getStoreContext } from '@/lib/auth/store-context';
import { getCartGroups } from '@/lib/cart/cart';
import { CartScreen } from './cart-screen';

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const store = await getStoreContext();
  if (!store) redirect({ href: '/login', locale });

  const groups = await getCartGroups(store!.locationId, store!.cityId);
  return <CartScreen locale={locale === 'kk' ? 'kk' : 'ru'} initialGroups={groups} />;
}
