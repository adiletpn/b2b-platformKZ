import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { listPendingApprovals } from '@/lib/orders/approval';
import { prisma } from '@/lib/prisma';
import type { OrderStatus } from '@/generated/prisma/client';
import { ChevronRight } from 'lucide-react';
import { formatShortDate, money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { NotificationList } from './notification-list';
import { ApprovalList } from './approval-list';

/** Завершённые заявки — во вкладке «Архив» (макет M07). */
const ARCHIVE: OrderStatus[] = ['CLOSED', 'CANCELLED', 'REJECTED'];

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const archive = (await searchParams).tab === 'archive';
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });
  // Раздел 3.12 ТЗ: без права на заявки (кассир, водитель, торговый представитель) списка нет.
  const viewer = await getAccess();
  if (!viewer || !(await hasPermission(viewer, 'SWIPE_ORDERS', 'VIEW'))) {
    redirect({ href: '/dashboard', locale });
  }

  const companyId = active!.companyId;
  // Черновик (согласование, пауза по кредитному лимиту) поставщику ещё не отправлен.
  const mine = {
    OR: [{ storeId: companyId }, { supplierId: companyId, status: { not: 'DRAFT' as const } }],
  };
  const [orders, notifications, activeCount] = await Promise.all([
    prisma.order.findMany({
      where: { AND: [mine, { status: archive ? { in: ARCHIVE } : { notIn: ARCHIVE } }] },
      include: {
        store: { select: { name: true } },
        supplier: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.notification.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.order.count({ where: { AND: [mine, { status: { notIn: ARCHIVE } }] } }),
  ]);

  // Раздел 3.12 ТЗ: список на согласовании виден только тем, кто может менять заявки.
  const access = await getAccess();
  const canApprove = access ? await hasPermission(access, 'SWIPE_ORDERS', 'UPDATE') : false;
  const approvals = canApprove ? await listPendingApprovals(companyId) : [];

  const t = await getTranslations('orders');

  /** Строка действия под карточкой: оранжевая, если от этой стороны ждут шага. */
  function nextAction(order: (typeof orders)[number]): { text: string; urgent: boolean } | null {
    const isStore = order.storeId === companyId;
    if (isStore && order.status === 'CHANGED_BY_SUPPLIER')
      return { text: t('action.confirmChanges'), urgent: true };
    if (isStore && (order.status === 'AWAITING_PAYMENT' || order.status === 'OVERDUE'))
      return {
        text: order.paymentDueDate
          ? t('action.payBy', { date: formatShortDate(order.paymentDueDate, locale) })
          : t('action.pay'),
        urgent: true,
      };
    if (isStore && order.status === 'DELIVERED') return { text: t('action.accept'), urgent: true };
    if (!isStore && order.status === 'SENT')
      return { text: t('action.confirmOrder'), urgent: true };
    if (order.status === 'SHIPPED') return { text: t('action.inTransit'), urgent: false };
    return null;
  }

  return (
    <Page width="lg">
      <PageHeader title={t('title')} />

      <ApprovalList approvals={approvals} />

      {/* Макет M07: сегмент «Активные / Архив». */}
      <nav
        className="bg-muted mb-3.5 flex rounded-full p-[3px] lg:max-w-sm"
        data-testid="orders-tabs"
      >
        {[
          {
            href: '/orders' as const,
            label: t('tabActive', { count: activeCount }),
            on: !archive,
            id: 'active',
          },
          {
            href: '/orders?tab=archive' as const,
            label: t('tabArchive'),
            on: archive,
            id: 'archive',
          },
        ].map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            data-testid={`orders-tab-${tab.id}`}
            className={cn(
              'flex h-[38px] flex-1 items-center justify-center rounded-full text-[13px] font-bold',
              tab.on
                ? 'bg-card shadow-[0_1px_4px_rgb(0_0_0/0.08)]'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {orders.length === 0 ? (
        <EmptyState>
          <span data-testid="orders-empty">{t('empty')}</span>
        </EmptyState>
      ) : (
        // На телефоне та же таблица складывается в карточки (макет M07): один DOM, без дублей.
        <Card className="overflow-hidden p-0 max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
          <div className="overflow-x-auto max-md:overflow-visible">
            <table className="w-full min-w-[640px] text-sm max-md:block max-md:min-w-0">
              <thead className="border-border border-b text-left max-md:hidden">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('number')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('counterparty')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('statusLabel')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('total')}</th>
                  <th className="px-4 py-2.5" />
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody
                className="divide-border divide-y max-md:block max-md:space-y-2.5 max-md:divide-y-0"
                data-testid="orders-table"
              >
                {orders.map((order) => {
                  const action = nextAction(order);
                  return (
                    <tr
                      key={order.id}
                      className="max-md:border-border max-md:bg-card max-md:shadow-card max-md:relative max-md:flex max-md:flex-wrap max-md:items-center max-md:gap-x-2 max-md:gap-y-1.5 max-md:rounded-[20px] max-md:border max-md:px-4 max-md:py-3.5"
                      data-testid={`order-row-${order.number}`}
                    >
                      <td className="px-4 py-3.5 text-[13px] font-extrabold whitespace-nowrap max-md:flex-1 max-md:p-0 max-md:font-sans max-md:text-[15px] max-md:font-extrabold">
                        {order.number}
                      </td>
                      <td className="px-4 py-3.5 font-semibold break-words max-md:order-3 max-md:w-full max-md:p-0">
                        {order.storeId === companyId ? order.supplier.name : order.store.name}
                        <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[13px] font-semibold">
                          <span className="text-muted-foreground">
                            {t('itemsCount', { count: order._count.items })}
                            {order.deliveryDate
                              ? ` · ${formatShortDate(order.deliveryDate, locale)}`
                              : ''}
                          </span>
                          <span className="text-foreground text-[15px] font-extrabold whitespace-nowrap md:hidden">
                            {money(order.totalWithVat.toFixed(2))} ₸
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3.5 max-md:order-2 max-md:p-0">
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
                      <td className="px-4 py-3.5 text-right font-extrabold whitespace-nowrap max-md:hidden">
                        {money(order.totalWithVat.toFixed(2))} ₸
                      </td>
                      {action ? (
                        <td
                          aria-hidden
                          className="max-md:border-border hidden max-md:order-5 max-md:mt-1 max-md:block max-md:w-full max-md:border-t"
                        />
                      ) : null}
                      <td className="px-4 py-3.5 max-md:order-5 max-md:flex-1 max-md:p-0 max-md:pt-1.5">
                        {action ? (
                          <span
                            className={cn(
                              'max-md:border-border text-[13px] font-extrabold max-md:block',
                              action.urgent ? 'text-primary-text' : 'text-muted-foreground',
                            )}
                          >
                            {action.text}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 text-right max-md:order-6 max-md:p-0">
                        {/* Ссылка растянута на всю карточку на телефоне: карточка нажимается целиком. */}
                        <Link
                          href={`/orders/${order.id}`}
                          aria-label={t('open')}
                          className={cn(
                            buttonVariants({ variant: 'outline', size: 'sm' }),
                            "max-md:size-auto max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none max-md:after:absolute max-md:after:inset-0 max-md:after:rounded-[20px] max-md:after:content-['']",
                          )}
                          data-testid={`order-open-${order.number}`}
                        >
                          <span className="max-md:hidden">{t('open')}</span>
                          <ChevronRight
                            aria-hidden
                            className="text-muted-foreground size-4 md:hidden"
                          />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
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
