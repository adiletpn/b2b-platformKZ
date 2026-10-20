import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { closeShift, getOpenShift, getZReport, openShift } from '@/lib/pos/shift';

export async function GET() {
  const guard = await requirePermission('POS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const shift = await getOpenShift(guard.access.companyId, store.locationId);
  if (!shift) return NextResponse.json({ shift: null, report: null });

  return NextResponse.json({
    shift: { id: shift.id, number: shift.number, openedAt: shift.openedAt.toISOString() },
    report: await getZReport(guard.access.companyId, shift.id),
  });
}

export async function POST(request: Request) {
  // Смену открывает и закрывает кассир (раздел 3.12 ТЗ).
  const guard = await requirePermission('POS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    action?: 'open' | 'close';
    shiftId?: string;
    cash?: string;
  };

  const result =
    body.action === 'close'
      ? await closeShift(
          guard.access.companyId,
          guard.access.userId,
          body.shiftId ?? '',
          body.cash ?? '0',
        )
      : await openShift(
          guard.access.companyId,
          guard.access.userId,
          store.locationId,
          body.cash ?? '0',
        );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
