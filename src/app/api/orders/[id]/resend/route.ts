import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { resendHeldOrder } from '@/lib/orders/credit';

/** Повторная отправка заявки, стоявшей на паузе из-за кредитного лимита (раздел 3.6 ТЗ). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const result = await resendHeldOrder(id, guard.access.companyId, guard.access.userId);
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
