import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BOARD_COLUMNS, boardColumn, type BoardColumn } from '@/lib/orders/board';
import type { PaymentDiscipline } from '@/lib/ratings/criteria';
import type { OrderStatus } from '@/generated/prisma/client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type BoardOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  when: string;
  store: string;
  city: string;
  meta: string;
  total: string;
  discipline: PaymentDiscipline;
};

const DISCIPLINE_TONE = {
  on_time: 'success',
  delays_up_to_7: 'warning',
  frequent_delays: 'danger',
} as const;

/**
 * Канбан входящих заявок поставщика (макет D03): пять колонок по статусам, новые — с оранжевой
 * точкой и рамкой. Только на компьютере; на телефоне тот же список карточками (M12).
 */
export async function SupplierBoard({ orders }: { orders: BoardOrder[] }) {
  const t = await getTranslations('orders');
  const tDiscipline = await getTranslations('ratings.discipline');
  const columns = new Map<BoardColumn, BoardOrder[]>(BOARD_COLUMNS.map((id) => [id, []]));
  for (const order of orders) {
    const column = boardColumn(order.status);
    if (column) columns.get(column)!.push(order);
  }

  return (
    <div
      className="hidden gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-[repeat(5,minmax(11.5rem,1fr))]"
      data-testid="supplier-board"
    >
      {BOARD_COLUMNS.map((id) => {
        const items = columns.get(id)!;
        return (
          <section
            key={id}
            className="bg-muted min-h-64 rounded-[22px] p-3"
            data-testid={`board-${id}`}
          >
            <header className="flex items-center justify-between px-1.5 pt-1 pb-3">
              <h2 className="text-[15px] font-extrabold">{t(`board.${id}`)}</h2>
              <span className="bg-card grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-extrabold">
                {items.length}
              </span>
            </header>
            <ul className="space-y-2.5">
              {items.map((order) => (
                <li
                  key={order.id}
                  className={cn(
                    'bg-card relative rounded-[18px] border p-3.5',
                    id === 'new' ? 'border-primary/50' : 'border-transparent',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-extrabold whitespace-nowrap">
                      {id === 'new' ? (
                        <span aria-hidden className="bg-primary size-2 shrink-0 rounded-full" />
                      ) : null}
                      {order.number}
                    </p>
                    <span className="text-muted-foreground text-xs font-semibold">
                      {order.when}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-bold break-words">{order.store}</p>
                  <p className="text-muted-foreground text-xs font-semibold">{order.city}</p>
                  <Badge tone={DISCIPLINE_TONE[order.discipline]} className="mt-2">
                    {tDiscipline(order.discipline)}
                  </Badge>
                  <div className="border-border mt-3 flex items-baseline justify-between gap-2 border-t pt-2.5">
                    <span className="text-muted-foreground text-xs font-semibold">
                      {order.meta}
                    </span>
                    <span className="text-sm font-extrabold whitespace-nowrap">
                      {order.total} ₸
                    </span>
                  </div>
                  {/* Карточка нажимается целиком. */}
                  <Link
                    href={`/orders/${order.id}`}
                    aria-label={`${t('open')} ${order.number}`}
                    className="absolute inset-0 rounded-[18px]"
                    data-testid={`board-open-${order.number}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
