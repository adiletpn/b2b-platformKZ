'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OrderStatus } from '@/generated/prisma/enums';

/**
 * Основной путь заявки (раздел 5.2 ТЗ) шестью шагами, как в макете M08:
 * доставка и приёмка — «Приемка», ожидание оплаты, оплата и закрытие — «Оплата».
 */
const STEPS: { key: string; statuses: OrderStatus[] }[] = [
  { key: 'sent', statuses: ['SENT'] },
  { key: 'accepted', statuses: ['ACCEPTED', 'CHANGED_BY_SUPPLIER'] },
  { key: 'picking', statuses: ['PICKING'] },
  { key: 'shipped', statuses: ['SHIPPED'] },
  {
    key: 'acceptance',
    statuses: ['DELIVERED', 'ACCEPTED_BY_STORE', 'ACCEPTED_WITH_DISCREPANCY'],
  },
  { key: 'payment', statuses: ['AWAITING_PAYMENT', 'OVERDUE', 'PAID', 'CLOSED'] },
];
/** На этих статусах текущий шаг уже пройден, а не в работе. */
const COMPLETES: OrderStatus[] = [
  'ACCEPTED_BY_STORE',
  'ACCEPTED_WITH_DISCREPANCY',
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
    ? STEPS.reduce((last, step, index) => (reached(step.statuses) ? index : last), -1)
    : STEPS.findIndex((step) => step.statuses.includes(status));

  return (
    <ol className="mt-4 flex pb-1" data-testid="order-progress">
      {STEPS.map((step, index) => {
        const done = index < current || (index === current && COMPLETES.includes(status));
        const active = index === current && !done;
        return (
          <li key={step.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-center">
              <span
                className={cn(
                  'h-[3px] flex-1',
                  index === 0 ? 'opacity-0' : done || active ? 'bg-primary' : 'bg-track',
                )}
              />
              <span
                className={cn(
                  'grid size-[22px] shrink-0 place-items-center rounded-full border-[3px] text-[11px] font-black',
                  done && 'bg-primary border-primary text-white',
                  active && !off && 'border-primary bg-card text-transparent',
                  active && off && 'border-danger bg-danger-soft text-danger',
                  !done && !active && 'border-track bg-card text-transparent',
                )}
              >
                {done ? <Check aria-hidden className="size-3" strokeWidth={3.4} /> : null}
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1',
                  index === STEPS.length - 1 ? 'opacity-0' : done ? 'bg-primary' : 'bg-track',
                )}
              />
            </div>
            <span
              className={cn(
                'text-center text-[10px] leading-tight font-bold',
                active || done ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {active && off
                ? t(`status.${status}`)
                : index === 1 && history.includes('CHANGED_BY_SUPPLIER')
                  ? t('progressChanged')
                  : t(`progress.${step.key}` as 'progress.sent')}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
