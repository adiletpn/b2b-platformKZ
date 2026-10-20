import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { markDelivered } from '@/lib/deliveries/deliveries';

/** Водитель отмечает доставку (раздел 5.2 ТЗ, шаг 6). Право DELIVERIES/UPDATE. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DELIVERIES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const result = await markDelivered(id, guard.access.companyId, guard.access.userId);
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
