import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { setMinimum } from '@/lib/stock/replenishment';

export async function PUT(request: Request) {
  const guard = await requirePermission('STOCK', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    productId?: string;
    minQuantity?: string | null;
  };

  const result = await setMinimum(
    guard.access.companyId,
    store.locationId,
    body.productId ?? '',
    body.minQuantity ?? null,
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
