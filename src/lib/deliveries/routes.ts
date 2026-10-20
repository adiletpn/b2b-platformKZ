import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';
import { membersWithPermission, type MemberOption } from '@/lib/employees/members';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { kzDayKey } from '@/lib/format';

/**
 * Маршруты водителей (этап 3 ТЗ): поставщик собирает рейс на день из заявок к отгрузке,
 * задаёт порядок точек вручную и назначает водителя-сотрудника. Водитель видит свой рейс
 * по порядку. Карты и автопостроения маршрута нет — это внешний провайдер (раздел 4.5 ТЗ).
 */
export const ROUTE_ORDER_STATUSES: OrderStatus[] = ['ACCEPTED', 'PICKING', 'SHIPPED'];
export const MAX_STOPS = 50;

export type RouteOrder = {
  orderId: string;
  number: string;
  storeName: string;
  address: string;
  status: OrderStatus;
  total: string;
};

export type RouteStopView = RouteOrder & { position: number; storePhone: string | null };

export type RouteView = {
  id: string;
  number: string;
  date: string;
  driverMembershipId: string | null;
  driver: string | null;
  stops: RouteStopView[];
};

const ORDER_INCLUDE = {
  store: { select: { name: true, contactPhone: true } },
  location: { include: { city: true } },
} as const;

function orderRow(order: {
  id: string;
  number: string;
  status: OrderStatus;
  totalWithVat: { toFixed(digits: number): string };
  store: { name: string };
  location: { address: string; city: { nameRu: string } };
}): RouteOrder {
  return {
    orderId: order.id,
    number: order.number,
    storeName: order.store.name,
    address: `${order.location.city.nameRu}, ${order.location.address}`,
    status: order.status,
    total: order.totalWithVat.toFixed(2),
  };
}

/** Водители — сотрудники с правом отмечать доставки (DELIVERIES → UPDATE). */
export function listDrivers(supplierId: string): Promise<MemberOption[]> {
  return membersWithPermission(supplierId, 'DELIVERIES', 'UPDATE');
}

/** Заявки к отгрузке, ещё не попавшие в рейс (или уже в этом рейсе при правке). */
export async function availableOrders(supplierId: string, routeId?: string): Promise<RouteOrder[]> {
  const orders = await prisma.order.findMany({
    where: {
      supplierId,
      status: { in: ROUTE_ORDER_STATUSES },
      OR: [{ routeStop: null }, ...(routeId ? [{ routeStop: { routeId } }] : [])],
    },
    include: ORDER_INCLUDE,
    orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });
  return orders.map(orderRow);
}

function toView(
  route: {
    id: string;
    number: string;
    date: Date;
    driverMembershipId: string | null;
    driver: { user: { name: string | null; phone: string } } | null;
    stops: {
      position: number;
      order: Parameters<typeof orderRow>[0] & {
        store: { name: string; contactPhone: string | null };
      };
    }[];
  },
  drivers: MemberOption[],
): RouteView {
  return {
    id: route.id,
    number: route.number,
    date: route.date.toISOString().slice(0, 10),
    driverMembershipId: route.driverMembershipId,
    driver: drivers.find((item) => item.membershipId === route.driverMembershipId)?.label ?? null,
    stops: route.stops
      .sort((left, right) => left.position - right.position)
      .map((stop) => ({
        ...orderRow(stop.order),
        position: stop.position,
        storePhone: stop.order.store.contactPhone,
      })),
  };
}

const ROUTE_INCLUDE = {
  driver: { include: { user: { select: { name: true, phone: true } } } },
  stops: { include: { order: { include: ORDER_INCLUDE } } },
} as const;

/**
 * Рейсы поставщика с сегодняшнего дня по Казахстану. `driverMembershipId` — только рейсы
 * этого водителя (правило 4 и раздел 3.12: водитель видит свой рейс).
 */
export async function listRoutes(
  supplierId: string,
  options: { driverMembershipId?: string; now?: Date } = {},
): Promise<RouteView[]> {
  const today = new Date(kzDayKey(options.now ?? new Date()));
  const [routes, drivers] = await Promise.all([
    prisma.deliveryRoute.findMany({
      where: {
        supplierId,
        date: { gte: today },
        ...(options.driverMembershipId ? { driverMembershipId: options.driverMembershipId } : {}),
      },
      include: ROUTE_INCLUDE,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 30,
    }),
    listDrivers(supplierId),
  ]);
  return routes.map((route) => toView(route, drivers));
}

/** Один рейс для маршрутного листа: свой поставщик, у водителя — только его рейс. */
export async function getRoute(
  supplierId: string,
  routeId: string,
  driverMembershipId?: string,
): Promise<RouteView | null> {
  const route = await prisma.deliveryRoute.findFirst({
    where: {
      id: routeId,
      supplierId,
      ...(driverMembershipId ? { driverMembershipId } : {}),
    },
    include: ROUTE_INCLUDE,
  });
  return route ? toView(route, await listDrivers(supplierId)) : null;
}

export type RouteInput = {
  routeId?: string;
  date: string;
  driverMembershipId: string;
  orderIds: string[];
};

export type RouteResult =
  | { status: 'ok'; routeId: string; number: string }
  | { status: 'invalid_date' }
  | { status: 'not_driver' }
  | { status: 'no_stops' }
  | { status: 'order_unavailable'; orderId: string }
  | { status: 'not_found' };

/** Сохранить рейс: порядок точек — порядок `orderIds`. Точки пересоздаются целиком. */
export async function saveRoute(
  supplierId: string,
  userId: string,
  input: RouteInput,
): Promise<RouteResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { status: 'invalid_date' };
  const orderIds = [...new Set(input.orderIds)];
  if (orderIds.length === 0 || orderIds.length > MAX_STOPS) return { status: 'no_stops' };

  const drivers = await listDrivers(supplierId);
  if (!drivers.some((driver) => driver.membershipId === input.driverMembershipId)) {
    return { status: 'not_driver' };
  }
  if (input.routeId) {
    const existing = await prisma.deliveryRoute.findFirst({
      where: { id: input.routeId, supplierId },
    });
    if (!existing) return { status: 'not_found' };
  }
  // Правило 4: в рейс попадают только свои заявки к отгрузке, не занятые другим рейсом.
  const available = new Set(
    (await availableOrders(supplierId, input.routeId)).map((order) => order.orderId),
  );
  const missing = orderIds.find((orderId) => !available.has(orderId));
  if (missing) return { status: 'order_unavailable', orderId: missing };

  const route = await prisma.$transaction(async (tx) => {
    const data = { date: new Date(input.date), driverMembershipId: input.driverMembershipId };
    const saved = input.routeId
      ? await tx.deliveryRoute.update({ where: { id: input.routeId }, data })
      : await tx.deliveryRoute.create({
          data: {
            ...data,
            supplierId,
            createdById: userId,
            number: await nextDocumentNumber(tx, supplierId, 'route'),
          },
        });
    await tx.deliveryRouteStop.deleteMany({ where: { routeId: saved.id } });
    await tx.deliveryRouteStop.createMany({
      data: orderIds.map((orderId, index) => ({ routeId: saved.id, orderId, position: index + 1 })),
    });
    return saved;
  });

  await writeAudit(supplierId, userId, 'route_saved', 'DeliveryRoute', route.id);
  return { status: 'ok', routeId: route.id, number: route.number };
}

export async function deleteRoute(supplierId: string, userId: string, routeId: string) {
  const deleted = await prisma.deliveryRoute.deleteMany({ where: { id: routeId, supplierId } });
  if (deleted.count === 0) return { status: 'not_found' as const };
  await writeAudit(supplierId, userId, 'route_deleted', 'DeliveryRoute', routeId);
  return { status: 'ok' as const };
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Печатный маршрутный лист: HTML для того же рендера PDF, что и у документов
 * (`renderPdf`, без JavaScript и сети). Данные компаний экранируются.
 */
export function routeSheetHtml(
  route: RouteView,
  supplierName: string,
  locale: 'ru' | 'kk',
  labels: Record<string, string>,
) {
  const label = (key: string) => escapeHtml(labels[key] ?? key);
  const rows = route.stops
    .map(
      (stop) => `<tr>
        <td>${stop.position}</td>
        <td>${escapeHtml(stop.number)}</td>
        <td>${escapeHtml(stop.storeName)}<br><small>${escapeHtml(stop.storePhone ?? '')}</small></td>
        <td>${escapeHtml(stop.address)}</td>
        <td class="num">${stop.total}</td>
        <td class="sign"></td>
      </tr>`,
    )
    .join('');
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; font-size: 10pt; }
      h1 { font-size: 14pt; margin: 0 0 4mm; }
      table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
      th, td { border: 1px solid #555; padding: 2mm; vertical-align: top; text-align: left; }
      .num { text-align: right; white-space: nowrap; }
      .sign { width: 30mm; }
    </style></head><body>
    <h1>${label('sheetTitle')} № ${escapeHtml(route.number)}</h1>
    <p>${escapeHtml(supplierName)}</p>
    <p>${label('date')}: ${route.date.split('-').reverse().join('.')} · ${label('driver')}: ${escapeHtml(route.driver ?? '—')}</p>
    <table><thead><tr>
      <th>№</th><th>${label('order')}</th><th>${label('store')}</th><th>${label('address')}</th>
      <th>${label('total')}</th><th>${label('signature')}</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}
