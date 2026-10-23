'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Store, UserCheck, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { formatDate, formatDateTime, money } from '@/lib/format';
import type { AssignmentRow, RepRow, RepStoreView, StoreOption } from '@/lib/reps/reps';

async function post(body: unknown) {
  const response = await fetch('/api/reps', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as { status?: string; error?: string };
}

/**
 * Торговые представители (этап 3 ТЗ): Владелец закрепляет магазины за представителем,
 * представитель видит свои магазины — заявки у поставщика, долг и визиты.
 */
export function RepsScreen({
  manage,
  canVisit,
  stores,
  reps,
  customers,
  assignments,
}: {
  manage: boolean;
  canVisit: boolean;
  stores: RepStoreView[];
  reps: RepRow[];
  customers: StoreOption[];
  assignments: AssignmentRow[];
}) {
  const t = useTranslations('reps');
  const router = useRouter();
  const [repId, setRepId] = useState(reps[0]?.membershipId ?? '');
  const [storeId, setStoreId] = useState(customers[0]?.storeId ?? '');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function act(body: unknown, done: string) {
    const data = await post(body);
    setMessage(
      data.status === 'ok'
        ? t(`done.${done}`)
        : t(`errors.${data.status ?? data.error ?? 'unknown'}` as 'errors.unknown'),
    );
    if (data.status === 'ok') router.refresh();
    return data.status === 'ok';
  }

  const select =
    'border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium';
  return (
    <Page width="lg">
      <PageHeader title={t('title')} description={manage ? t('subtitleOwner') : t('subtitleRep')} />

      {manage ? (
        <Card className="mb-4" data-testid="reps-manage">
          <div className="flex items-start gap-3">
            <IconBadge icon={UserCheck} />
            <div>
              <CardTitle>{t('assignTitle')}</CardTitle>
              <CardHint>{t('assignHint')}</CardHint>
            </div>
          </div>
          {reps.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm" data-testid="reps-none">
              {t('noReps')}
            </p>
          ) : customers.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">{t('noCustomers')}</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <Field label={t('rep')}>
                <select
                  className={select}
                  value={repId}
                  data-testid="reps-rep"
                  onChange={(event) => setRepId(event.target.value)}
                >
                  {reps.map((rep) => (
                    <option key={rep.membershipId} value={rep.membershipId}>
                      {rep.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('store')}>
                <select
                  className={select}
                  value={storeId}
                  data-testid="reps-store"
                  onChange={(event) => setStoreId(event.target.value)}
                >
                  {customers.map((store) => (
                    <option key={store.storeId} value={store.storeId}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Button
                data-testid="reps-assign"
                onClick={() =>
                  void act({ action: 'assign', membershipId: repId, storeId }, 'assigned')
                }
              >
                {t('assign')}
              </Button>
            </div>
          )}
          {assignments.length > 0 ? (
            <ul className="divide-border mt-3 divide-y text-sm" data-testid="reps-assignments">
              {assignments.map((row) => (
                <li key={row.storeId} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 break-words">{row.storeName}</span>
                  <Badge tone="info">{row.rep}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('unassign')}
                    onClick={() =>
                      void act({ action: 'unassign', storeId: row.storeId }, 'unassigned')
                    }
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {message ? (
        <p className="mb-3 text-sm" role="status" data-testid="reps-message">
          {message}
        </p>
      ) : null}

      {stores.length === 0 ? (
        manage ? null : (
          <EmptyState>
            <span data-testid="reps-empty">{t('empty')}</span>
          </EmptyState>
        )
      ) : (
        <ul className="space-y-3" data-testid="reps-stores">
          {stores.map((store) => (
            <li key={store.storeId}>
              <Card className="space-y-3" data-testid="reps-store-card">
                <div className="flex flex-wrap items-start gap-3">
                  <IconBadge icon={Store} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold break-words">{store.name}</p>
                    {store.contactPhone ? (
                      <a href={`tel:${store.contactPhone}`} className="text-primary text-sm">
                        {store.contactPhone}
                      </a>
                    ) : null}
                  </div>
                  <Badge
                    tone={store.overdue !== '0.00' ? 'danger' : 'neutral'}
                    data-testid="reps-debt"
                  >
                    {t('debt', { debt: money(store.debt) })}
                  </Badge>
                </div>

                <div>
                  <p className="text-muted-foreground text-xs font-semibold">{t('orders')}</p>
                  {store.orders.length === 0 ? (
                    <p className="text-sm">—</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm" data-testid="reps-orders">
                      {store.orders.map((order) => (
                        <li key={order.id} className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-bold tabular-nums">{order.number}</span>
                          <span className="text-muted-foreground text-xs font-semibold">
                            {formatDate(new Date(order.createdAt))}
                          </span>
                          <OrderStatusBadge status={order.status} />
                          <span className="ml-auto tabular-nums">{money(order.total)} ₸</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-muted-foreground text-xs font-semibold">{t('visits')}</p>
                  <ul className="mt-1 space-y-1 text-sm" data-testid="reps-visits">
                    {store.visits.map((visit) => (
                      <li key={visit.id} className="flex items-start gap-2">
                        <MapPin
                          aria-hidden
                          className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
                        />
                        <span className="min-w-0 break-words">
                          <span className="text-muted-foreground text-xs font-semibold">
                            {formatDateTime(new Date(visit.visitedAt))}
                          </span>{' '}
                          {visit.comment}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {canVisit ? (
                    <div className="mt-2 flex gap-2">
                      <Input
                        className="h-10 min-w-0 flex-1"
                        placeholder={t('visitComment')}
                        aria-label={t('visitComment')}
                        value={comments[store.storeId] ?? ''}
                        data-testid="reps-visit-comment"
                        onChange={(event) =>
                          setComments({ ...comments, [store.storeId]: event.target.value })
                        }
                      />
                      <Button
                        data-testid="reps-visit"
                        onClick={async () => {
                          const ok = await act(
                            {
                              action: 'visit',
                              storeId: store.storeId,
                              comment: comments[store.storeId] ?? '',
                            },
                            'visit',
                          );
                          if (ok) setComments({ ...comments, [store.storeId]: '' });
                        }}
                      >
                        {t('markVisit')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground mt-4 text-xs">{t('onBehalfNote')}</p>
    </Page>
  );
}
