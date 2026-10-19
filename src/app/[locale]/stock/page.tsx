import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getStoreContext } from '@/lib/auth/store-context';
import { prisma } from '@/lib/prisma';
import { buttonVariants } from '@/components/ui/button';

export default async function StockPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const store = await getStoreContext();
  if (!store) redirect({ href: '/login', locale });

  const balances = await prisma.stockBalance.findMany({
    where: { locationId: store!.locationId },
    include: { product: { include: { unit: true } } },
    orderBy: { product: { nameRu: 'asc' } },
  });

  const t = await getTranslations('stock');
  const tDashboard = await getTranslations('dashboard');

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
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
        <div className="border-border bg-card mt-5 overflow-x-auto rounded-lg border">
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
    </main>
  );
}
