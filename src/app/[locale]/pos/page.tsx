import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { prisma } from '@/lib/prisma';
import { getOpenShift, getZReport } from '@/lib/pos/shift';
import { PosScreen } from './pos-screen';

export default async function PosPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await getAccess();
  if (!access) redirect({ href: '/login', locale });
  // Раздел 3.12 ТЗ: касса открыта тем, у кого есть право на неё.
  if (!(await hasPermission(access!, 'POS', 'VIEW'))) redirect({ href: '/dashboard', locale });

  const store = await getStoreContext();
  if (!store) redirect({ href: '/dashboard', locale });

  const [balances, prices, shift] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { locationId: store!.locationId, quantity: { gt: 0 } },
      include: { product: true },
      orderBy: { product: { nameRu: 'asc' } },
    }),
    prisma.retailPrice.findMany({ where: { companyId: access!.companyId } }),
    getOpenShift(access!.companyId, store!.locationId),
  ]);

  const priceByProduct = new Map(prices.map((price) => [price.productId, price.price]));
  const report = shift ? await getZReport(access!.companyId, shift.id) : null;

  return (
    <PosScreen
      products={balances
        .filter((balance) => priceByProduct.has(balance.productId))
        .map((balance) => ({
          productId: balance.productId,
          name: locale === 'kk' ? balance.product.nameKk : balance.product.nameRu,
          barcode: balance.product.barcode,
          price: priceByProduct.get(balance.productId)!.toFixed(2),
          stock: balance.quantity.toFixed(3),
        }))}
      initialShift={
        shift
          ? { id: shift.id, number: shift.number, openedAt: shift.openedAt.toISOString() }
          : null
      }
      initialReport={report}
      maxDiscount={
        (
          await prisma.membership.findUnique({
            where: { id: access!.membershipId },
            select: { maxDiscount: true },
          })
        )?.maxDiscount?.toFixed(2) ?? null
      }
    />
  );
}
