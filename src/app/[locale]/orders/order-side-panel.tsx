import Decimal from 'decimal.js';
import { getTranslations } from 'next-intl/server';
import { Check, Download, FileText } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/lib/prisma';
import { formatDateTime, formatShortDate, money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { Avatar } from '@/components/ui/controls';
import { OrderStatusBadge } from '@/components/order-status-badge';

/**
 * Правая панель списка заявок (макет D02, 440 px): выбранная заявка, изменения поставщика
 * с «Было / Стало», история статусов с автором и временем, документы. Действия по заявке
 * остаются в её карточке — панель ведёт туда кнопкой.
 */
export async function OrderSidePanel({
  orderId,
  companyId,
  locale,
}: {
  orderId: string;
  companyId: string;
  locale: string;
}) {
  // Правило 4: только своя заявка; черновик магазина поставщику не виден (раздел 3.4 ТЗ).
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      OR: [{ storeId: companyId }, { supplierId: companyId, status: { not: 'DRAFT' } }],
    },
    include: {
      store: { select: { name: true } },
      supplier: { select: { name: true } },
      items: { select: { priceWithVat: true, quantityOrdered: true } },
      statusLogs: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } },
      documents: { orderBy: { issuedAt: 'asc' }, select: { id: true, type: true, number: true } },
    },
  });
  if (!order) return null;

  const t = await getTranslations('orders');
  const tDoc = await getTranslations('documents.types');
  const isStore = order.storeId === companyId;
  const counterparty = isStore ? order.supplier.name : order.store.name;
  const total = order.totalWithVat.toFixed(2);
  const originalTotal = order.items
    .reduce((sum, item) => sum.add(item.priceWithVat.mul(item.quantityOrdered)), new Decimal(0))
    .toFixed(2);
  const changed = order.status === 'CHANGED_BY_SUPPLIER';

  return (
    <aside
      className="border-border bg-card sticky top-0 -mt-6 -mr-8 -mb-8 hidden h-[calc(100vh-8rem)] w-[440px] shrink-0 flex-col gap-4 overflow-y-auto border-l p-6 min-[1400px]:flex"
      data-testid="order-side-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[22px] font-black">{order.number}</span>
        <OrderStatusBadge status={order.status} />
      </div>

      <div className="flex items-center gap-2.5">
        <Avatar name={counterparty} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold">{counterparty}</p>
          <p className="text-muted-foreground text-xs font-semibold">
            {[
              t('itemsCount', { count: order.items.length }),
              order.deliveryDate ? formatShortDate(order.deliveryDate, locale) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>

      {changed ? (
        <div className="bg-primary-soft rounded-[18px] px-4 py-3.5">
          <p className="text-sm font-extrabold">{t('panel.changedTitle')}</p>
          <div className="mt-2.5 flex justify-between text-[13px] font-bold">
            <span className="text-[#8a5a25]">
              {t('was')} {money(originalTotal)} ₸
            </span>
            <span>
              {t('became')} {money(total)} ₸
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-muted flex items-baseline justify-between rounded-[18px] px-4 py-3">
          <span className="text-muted-foreground text-[13px] font-semibold">{t('total')}</span>
          <span className="text-lg font-black">{money(total)} ₸</span>
        </div>
      )}

      <Link
        href={`/orders/${order.id}`}
        className={cn(buttonVariants({ variant: changed && isStore ? 'default' : 'outline' }))}
        data-testid="order-panel-open"
      >
        {changed && isStore ? t('panel.confirm') : t('panel.open')}
      </Link>

      <p className="mt-1 text-[15px] font-extrabold">{t('panel.history')}</p>
      <ol>
        {order.statusLogs.map((log, index) => {
          const last = index === order.statusLogs.length - 1;
          return (
            <li key={log.id} className="relative flex gap-3 pb-3 last:pb-0">
              {last ? null : (
                <span aria-hidden className="bg-primary absolute top-5 bottom-0 left-[9px] w-0.5" />
              )}
              <span
                aria-hidden
                className={cn(
                  'relative grid size-5 shrink-0 place-items-center rounded-full',
                  last ? 'border-primary bg-card border-[3px]' : 'bg-primary',
                )}
              >
                {last ? null : <Check className="size-[11px] text-white" strokeWidth={3.4} />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-extrabold">{t(`status.${log.toStatus}`)}</p>
                <p className="text-muted-foreground text-xs font-semibold">
                  {formatDateTime(log.createdAt)}
                  {log.user?.name ? ` · ${log.user.name}` : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {order.documents.length > 0 ? (
        <>
          <p className="text-[15px] font-extrabold">{t('panel.documents')}</p>
          <ul className="space-y-2">
            {order.documents.map((document) => (
              <li key={document.id}>
                <a
                  href={`/api/documents/${document.id}/pdf`}
                  className="bg-muted hover:bg-muted/70 flex items-center gap-2.5 rounded-[14px] p-3"
                >
                  <FileText aria-hidden className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold">
                    {tDoc(document.type)} {document.number}.pdf
                  </span>
                  <Download aria-hidden className="text-muted-foreground size-[18px]" />
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}
