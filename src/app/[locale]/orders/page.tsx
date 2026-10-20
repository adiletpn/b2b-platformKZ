import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { listPendingApprovals } from '@/lib/orders/approval';
import { prisma } from '@/lib/prisma';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { NotificationList } from './notification-list';
import { ApprovalList } from './approval-list';

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });
  // Раздел 3.12 ТЗ: без права на заявки (кассир, водитель, торговый представитель) списка нет.
  const viewer = await getAccess();
  if (!viewer || !(await hasPermission(viewer, 'SWIPE_ORDERS', 'VIEW'))) {
    redirect({ href: '/dashboard', locale });
  }

  const companyId = active!.companyId;
  const [orders, notifications] = await Promise.all([
    prisma.order.findMany({
      // Черновик (согласование, пауза по кредитному лимиту) поставщику ещё не отправлен.
      where: {
        OR: [{ storeId: companyId }, { supplierId: companyId, status: { not: 'DRAFT' } }],
      },
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

  // Раздел 3.12 ТЗ: список на согласовании виден только тем, кто может менять заявки.
  const access = await getAccess();
  const canApprove = access ? await hasPermission(access, 'SWIPE_ORDERS', 'UPDATE') : false;
  const approvals = canApprove ? await listPendingApprovals(companyId) : [];

  const t = await getTranslations('orders');

  return (
    <Page width="lg">
      <PageHeader title={t('title')} />

      <ApprovalList approvals={approvals} />

      {orders.length === 0 ? (
        <EmptyState>
          <span data-testid="orders-empty">{t('empty')}</span>
        </EmptyState>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-muted-foreground border-border bg-muted/50 border-b text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('number')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('counterparty')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('statusLabel')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('total')}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y" data-testid="orders-table">
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="hover:bg-muted/40"
                    data-testid={`order-row-${order.number}`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                      {order.number}
                    </td>
                    <td className="px-4 py-2.5 break-words">
                      {order.storeId === companyId ? order.supplier.name : order.store.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <OrderStatusBadge
                        status={order.status}
                        testId={`order-status-${order.number}`}
                      />
                      {order.creditHold && order.status === 'DRAFT' ? (
                        <Badge tone="warning" className="ml-1.5" data-testid="order-credit-hold">
                          {t('creditHoldBadge')}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {order.totalWithVat.toFixed(2)} ₸
                    </td>
                    <td className="px-4 py-2.5 text-right">
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
        </Card>
      )}

      <NotificationList
        notifications={notifications.map((item) => ({
          id: item.id,
          event: item.event,
          channels: item.channels,
          payload: item.payload as Record<string, string>,
        }))}
      />
    </Page>
  );
}
