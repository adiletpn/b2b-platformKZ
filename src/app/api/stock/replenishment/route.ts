import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { buildReplenishmentDraft, getReplenishment } from '@/lib/stock/replenishment';

export async function GET() {
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({
    rows: await getReplenishment(guard.access.companyId, store.locationId),
  });
}

export async function POST() {
  // Черновик заявки создаёт тот, кто может создавать заявки (раздел 3.12 ТЗ).
  const guard = await requirePermission('SWIPE_ORDERS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const result = await buildReplenishmentDraft(
    guard.access.companyId,
    guard.access.userId,
    store.locationId,
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
