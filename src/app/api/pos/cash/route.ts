import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { cashOperation } from '@/lib/pos/shift';

/** Внесение и изъятие наличных в открытой смене (раздел 4.2 ТЗ). */
export async function POST(request: Request) {
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
    type?: string;
    amount?: string;
    reason?: string;
  };
  if (body.type !== 'CASH_IN' && body.type !== 'CASH_OUT') {
    return NextResponse.json({ status: 'invalid_amount' }, { status: 400 });
  }
  const result = await cashOperation(
    guard.access.companyId,
    guard.access.userId,
    store.locationId,
    {
      type: body.type,
      amount: body.amount ?? '',
      reason: body.reason ?? '',
    },
  );
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
