import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { refund } from '@/lib/pos/sale';

export async function POST(request: Request) {
  // Возврат на кассе подтверждается правом на изменение (раздел 3.12 ТЗ).
  const guard = await requirePermission('POS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { receiptId?: string };
  const result = await refund(guard.access.companyId, guard.access.userId, body.receiptId ?? '');

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
