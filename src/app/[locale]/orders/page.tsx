import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect, Link } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';
import { buttonVariants } from '@/components/ui/button';
import { NotificationList } from './notification-list';

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const companyId = active!.companyId;
  const [orders, notifications] = await Promise.all([
    prisma.order.findMany({
      where: { OR: [{ storeId: companyId }, { supplierId: companyId }] },
      include: { store: { select: { name: true } }, supplier: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.notification.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const t = await getTranslations('orders');

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('back')}
        </Link>
      </header>

      {orders.length === 0 ? (
        <p className="text-muted-foreground mt-6 text-sm" data-testid="orders-empty">
          {t('empty')}
        </p>
      ) : (
        <div className="border-border bg-card mt-5 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t('number')}</th>
                <th className="px-3 py-2 font-medium">{t('counterparty')}</th>
                <th className="px-3 py-2 font-medium">{t('statusLabel')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('total')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y" data-testid="orders-table">
              {orders.map((order) => (
                <tr key={order.id} data-testid={`order-row-${order.number}`}>
                  <td className="px-3 py-2 font-mono text-xs">{order.number}</td>
                  <td className="px-3 py-2">
                    {order.storeId === companyId ? order.supplier.name : order.store.name}
                  </td>
                  <td className="px-3 py-2" data-testid={`order-status-${order.number}`}>
                    {t(`status.${order.status}`)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {order.totalWithVat.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/orders/${order.id}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      data-testid={`order-open-${order.number}`}
                    >
                      {t('open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NotificationList
        notifications={notifications.map((item) => ({
          id: item.id,
          event: item.event,
          channels: item.channels,
          payload: item.payload as Record<string, string>,
        }))}
      />
    </main>
  );
}
