import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getStoreContext } from '@/lib/auth/store-context';
import { prisma } from '@/lib/prisma';
import { buttonVariants } from '@/components/ui/button';
import { Page } from '@/components/ui/page';
import { getAccess } from '@/lib/auth/permissions';
import { StockDocuments } from './stock-documents';
import { ReplenishmentPanel } from './replenishment-panel';
import { getReplenishment } from '@/lib/stock/replenishment';

export default async function StockPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const store = await getStoreContext();
  if (!store) redirect({ href: '/login', locale });

  const access = await getAccess();
  const [balances, locations, documents] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { locationId: store!.locationId },
      include: { product: { include: { unit: true } } },
      orderBy: { product: { nameRu: 'asc' } },
    }),
    // Правило 4: только точки своей компании.
    prisma.location.findMany({
      where: { companyId: access!.companyId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.stockDocument.findMany({
      where: { companyId: access!.companyId },
      include: { targetLocation: { select: { address: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const replenishment = await getReplenishment(access!.companyId, store!.locationId);

  // В опись можно внести и то, чего сейчас нет на остатке: товары из принятых заявок.
  const ordered = await prisma.orderItem.findMany({
    where: { order: { storeId: access!.companyId } },
    select: {
      offer: { select: { product: { select: { id: true, nameRu: true, nameKk: true } } } },
    },
    distinct: ['offerId'],
    take: 200,
  });

  const products = new Map<string, { productId: string; name: string; quantity: string }>();
  for (const balance of balances) {
    products.set(balance.productId, {
      productId: balance.productId,
      name: locale === 'kk' ? balance.product.nameKk : balance.product.nameRu,
      quantity: balance.quantity.toFixed(3),
    });
  }
  for (const item of ordered) {
    const product = item.offer.product;
    if (products.has(product.id)) continue;
    products.set(product.id, {
      productId: product.id,
      name: locale === 'kk' ? product.nameKk : product.nameRu,
      quantity: '0.000',
    });
  }

  const t = await getTranslations('stock');
  const tDashboard = await getTranslations('dashboard');

  return (
    <Page width="md">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {tDashboard('title')}
        </Link>
      </header>
      <p className="text-muted-foreground mt-1 text-xs">{t('hint')}</p>

      {balances.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm" data-testid="stock-empty">
          {t('empty')}
        </p>
      ) : (
        <div className="border-border bg-card shadow-card mt-5 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t('product')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('quantity')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('averageCost')}</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y" data-testid="stock-table">
              {balances.map((balance) => (
                <tr key={balance.id} data-testid={`stock-row-${balance.productId}`}>
                  <td className="px-3 py-2 break-words">
                    {locale === 'kk' ? balance.product.nameKk : balance.product.nameRu}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums" data-testid="stock-quantity">
                    {balance.quantity.toFixed(3)}{' '}
                    {locale === 'kk' ? balance.product.unit.nameKk : balance.product.unit.nameRu}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {balance.averageCost.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReplenishmentPanel
        rows={replenishment.map((row) => ({
          productId: row.productId,
          name: locale === 'kk' ? row.nameKk : row.nameRu,
          quantity: row.quantity,
          minQuantity: row.minQuantity,
          suggested: row.suggested,
          supplierName: row.supplierName,
        }))}
        minimums={balances.map((balance) => ({
          productId: balance.productId,
          name: locale === 'kk' ? balance.product.nameKk : balance.product.nameRu,
          minQuantity: balance.minQuantity?.toFixed(3) ?? '',
        }))}
      />

      <StockDocuments
        locations={locations.map((location) => ({
          id: location.id,
          address: location.address,
        }))}
        balances={[...products.values()]}
        documents={documents.map((document) => ({
          id: document.id,
          type: document.type,
          number: document.number,
          createdAt: document.createdAt.toLocaleString('ru-RU'),
          locationAddress: '',
          targetAddress: document.targetLocation?.address ?? null,
          reason: document.reason,
          lineCount: 0,
        }))}
      />
    </Page>
  );
}
