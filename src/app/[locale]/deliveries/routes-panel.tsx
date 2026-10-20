'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, FileText, Plus, Route, Trash2, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { RouteOrder, RouteView } from '@/lib/deliveries/routes';
import type { MemberOption } from '@/lib/employees/members';

async function post(body: unknown) {
  const response = await fetch('/api/deliveries/routes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as { status?: string; error?: string };
}

/**
 * Рейсы водителей (этап 3 ТЗ): поставщик собирает рейс на день из заявок к отгрузке,
 * ставит точки по порядку и назначает водителя; водитель видит свой рейс по порядку.
 */
export function RoutesPanel({
  locale,
  today,
  canPlan,
  orders,
  drivers,
  routes,
  myRoutes,
}: {
  locale: 'ru' | 'kk';
  today: string;
  canPlan: boolean;
  orders: RouteOrder[];
  drivers: MemberOption[];
  routes: RouteView[];
  myRoutes: RouteView[];
}) {
  const t = useTranslations('deliveries.routes');
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [driverId, setDriverId] = useState(drivers[0]?.membershipId ?? '');
  const [selected, setSelected] = useState<RouteOrder[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const free = orders.filter((order) => !selected.some((item) => item.orderId === order.orderId));

  function move(index: number, delta: number) {
    setSelected((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function save() {
    setPending(true);
    const data = await post({
      date,
      driverMembershipId: driverId,
      orderIds: selected.map((order) => order.orderId),
    });
    setPending(false);
    if (data.status !== 'ok') {
      setMessage(t(`errors.${data.status ?? data.error ?? 'unknown'}` as 'errors.unknown'));
      return;
    }
    setMessage(t('saved'));
    setSelected([]);
    router.refresh();
  }

  async function remove(routeId: string) {
    await post({ action: 'delete', routeId });
    router.refresh();
  }

  const select = 'border-border bg-card h-11 w-full rounded-lg border px-3';
  return (
    <div className="mb-4 space-y-4">
      {myRoutes.map((route) => (
        <Card key={route.id} className="space-y-3" data-testid="my-route">
          <div className="flex flex-wrap items-start gap-3">
            <IconBadge icon={Route} />
            <div className="min-w-0 flex-1">
              <CardTitle>{t('myRoute', { number: route.number })}</CardTitle>
              <CardHint>{route.date.split('-').reverse().join('.')}</CardHint>
            </div>
            <a
              href={`/api/deliveries/routes/${route.id}/pdf?locale=${locale}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              data-testid="my-route-pdf"
            >
              <FileText aria-hidden />
              {t('sheet')}
            </a>
          </div>
          <ol className="space-y-2" data-testid="my-route-stops">
            {route.stops.map((stop) => (
              <li
                key={stop.orderId}
                className="flex items-start gap-3 text-sm"
                data-testid="route-stop"
              >
                <span className="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold">
                  {stop.position}
                </span>
                <span className="min-w-0 break-words">
                  <span className="font-medium">{stop.storeName}</span>
                  <span className="text-muted-foreground block">{stop.address}</span>
                  <span className="text-muted-foreground block font-mono text-xs">
                    {stop.number}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ))}

      {canPlan ? (
        <Card data-testid="route-planner">
          <div className="flex items-start gap-3">
            <IconBadge icon={Route} />
            <div>
              <CardTitle>{t('plannerTitle')}</CardTitle>
              <CardHint>{t('plannerHint')}</CardHint>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('date')}>
              <Input
                type="date"
                value={date}
                data-testid="route-date"
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Field label={t('driver')}>
              <select
                className={select}
                value={driverId}
                data-testid="route-driver"
                onChange={(event) => setDriverId(event.target.value)}
              >
                {drivers.map((driver) => (
                  <option key={driver.membershipId} value={driver.membershipId}>
                    {driver.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <p className="text-muted-foreground mt-3 text-xs">{t('available')}</p>
          {free.length === 0 ? (
            <p className="text-sm">{t('noOrders')}</p>
          ) : (
            <ul className="divide-border divide-y text-sm" data-testid="route-available">
              {free.map((order) => (
                <li key={order.orderId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 break-words">
                    {order.storeName}
                    <span className="text-muted-foreground block text-xs">
                      {order.number} · {order.address}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="route-add"
                    onClick={() => setSelected((current) => [...current, order])}
                  >
                    <Plus aria-hidden />
                    {t('add')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {selected.length > 0 ? (
            <>
              <p className="text-muted-foreground mt-3 text-xs">{t('order')}</p>
              <ol className="space-y-1 text-sm" data-testid="route-selected">
                {selected.map((order, index) => (
                  <li
                    key={order.orderId}
                    className="flex items-center gap-2"
                    data-testid="route-selected-stop"
                  >
                    <Badge tone="info">{index + 1}</Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {order.storeName} · {order.number}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('up')}
                      data-testid="route-up"
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('down')}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('remove')}
                      onClick={() =>
                        setSelected((current) =>
                          current.filter((item) => item.orderId !== order.orderId),
                        )
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              disabled={pending || selected.length === 0 || !driverId}
              data-testid="route-save"
              onClick={() => void save()}
            >
              {t('save')}
            </Button>
            {message ? (
              <span className="text-sm" role="status" data-testid="route-message">
                {message}
              </span>
            ) : null}
          </div>

          {routes.length > 0 ? (
            <ul className="divide-border mt-4 divide-y border-t text-sm" data-testid="route-list">
              {routes.map((route) => (
                <li key={route.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-mono text-xs">{route.number}</span> ·{' '}
                    {route.date.split('-').reverse().join('.')} · {route.driver ?? '—'}
                    <span className="text-muted-foreground block text-xs">
                      {route.stops.map((stop) => stop.storeName).join(' → ')}
                    </span>
                  </span>
                  <a
                    href={`/api/deliveries/routes/${route.id}/pdf?locale=${locale}`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    data-testid="route-pdf"
                  >
                    <FileText aria-hidden />
                    {t('sheet')}
                  </a>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={t('delete')}
                    onClick={() => void remove(route.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
