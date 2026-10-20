import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { confirmOrder, type ConfirmationLine } from '@/lib/orders/workflow';
import { withIdempotency } from '@/lib/orders/idempotency';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('SWIPE_ORDERS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as {
    idempotencyKey?: string;
    lines?: ConfirmationLine[];
  };

  const { result } = await withIdempotency(body.idempotencyKey, active.companyId, 'confirm', () =>
    confirmOrder(id, active.companyId, active.userId, body.lines ?? []),
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
