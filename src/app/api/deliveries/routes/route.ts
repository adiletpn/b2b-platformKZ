import { NextResponse } from 'next/server';
import { hasPermission, requirePermission } from '@/lib/auth/permissions';
import { deleteRoute, listRoutes, saveRoute } from '@/lib/deliveries/routes';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Рейсы: собирающий видит все рейсы компании, водитель — только свои (этап 3 ТЗ). */
export async function GET() {
  const guard = await requirePermission('DELIVERIES', 'VIEW');
  if (!guard.ok) return denied(guard.status);
  const planner = await hasPermission(guard.access, 'DELIVERIES', 'CREATE');
  return NextResponse.json({
    routes: await listRoutes(guard.access.companyId, {
      driverMembershipId: planner ? undefined : guard.access.membershipId,
    }),
  });
}

/** Собрать или изменить рейс, `action: 'delete'` — удалить. Нужно право на создание доставок. */
export async function POST(request: Request) {
  const guard = await requirePermission('DELIVERIES', 'CREATE');
  if (!guard.ok) return denied(guard.status);
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    routeId?: string;
    date?: string;
    driverMembershipId?: string;
    orderIds?: string[];
  };
  const { companyId, userId } = guard.access;
  if (body.action === 'delete') {
    const result = await deleteRoute(companyId, userId, body.routeId ?? '');
    return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 404 });
  }
  const result = await saveRoute(companyId, userId, {
    routeId: body.routeId || undefined,
    date: body.date ?? '',
    driverMembershipId: body.driverMembershipId ?? '',
    orderIds: Array.isArray(body.orderIds) ? body.orderIds.map(String) : [],
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
