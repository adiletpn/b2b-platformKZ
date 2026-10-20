'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OrderStatus } from '@/generated/prisma/enums';

/** Основной путь заявки (раздел 5.2 ТЗ): шаги, которые видят обе стороны. */
const PATH: OrderStatus[][] = [
  ['SENT'],
  ['ACCEPTED', 'CHANGED_BY_SUPPLIER'],
  ['PICKING'],
  ['SHIPPED'],
  ['DELIVERED'],
  ['ACCEPTED_BY_STORE', 'ACCEPTED_WITH_DISCREPANCY'],
  ['AWAITING_PAYMENT', 'OVERDUE'],
  ['PAID'],
  ['CLOSED'],
];
const LABELS: OrderStatus[] = [
  'SENT',
  'ACCEPTED',
  'PICKING',
  'SHIPPED',
  'DELIVERED',
  'ACCEPTED_BY_STORE',
  'AWAITING_PAYMENT',
  'PAID',
  'CLOSED',
];

/**
 * Шкала заявки: где она сейчас на пути от отправки до закрытия. Отклонённая,
 * отменённая и спорная заявки показывают последний пройденный шаг и красную метку.
 */
export function OrderProgress({
  status,
  history,
}: {
  status: OrderStatus;
  history: OrderStatus[];
}) {
  const t = useTranslations('orders');
  const off = status === 'REJECTED' || status === 'CANCELLED' || status === 'DISPUTE';
  const reached = (statuses: OrderStatus[]) => statuses.some((item) => history.includes(item));
  const current = off
    ? PATH.reduce((last, step, index) => (reached(step) ? index : last), -1)
    : PATH.findIndex((step) => step.includes(status));

  return (
    <ol
      className="border-border bg-card shadow-card mt-5 flex scrollbar-none gap-0 overflow-x-auto rounded-xl border p-3"
      data-testid="order-progress"
    >
      {LABELS.map((label, index) => {
        const done = index < current || (index === current && status === 'CLOSED');
        const active = index === current && !done;
        return (
          <li key={label} className="flex min-w-[5.5rem] flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  'h-0.5 flex-1',
                  index === 0 ? 'opacity-0' : done || active ? 'bg-primary' : 'bg-border',
                )}
              />
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold',
                  done && 'bg-primary border-primary text-primary-foreground',
                  active &&
                    !off &&
                    'border-primary bg-primary-soft text-primary ring-primary/15 ring-4',
                  active && off && 'border-danger bg-danger-soft text-danger',
                  !done && !active && 'border-border bg-card text-muted-foreground',
                )}
              >
                {done ? <Check aria-hidden className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1',
                  index === LABELS.length - 1 ? 'opacity-0' : done ? 'bg-primary' : 'bg-border',
                )}
              />
            </div>
            <span
              className={cn(
                'px-1 text-center text-[11px] leading-tight',
                active ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              {active && off ? t(`status.${status}`) : t(`status.${label}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
