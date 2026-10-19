import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { recordPayment } from '@/lib/payments/record';
import { withIdempotency } from '@/lib/orders/idempotency';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'CREATE');
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
    amount?: string;
    method?: 'PREPAY' | 'ON_DELIVERY' | 'DEFERRED';
    paidAt?: string;
    reference?: string;
  };

  const { result } = await withIdempotency(body.idempotencyKey, active.companyId, 'payment', () =>
    recordPayment({
      orderId: id,
      storeId: active.companyId,
      userId: active.userId,
      amount: body.amount ?? '0',
      method: body.method ?? 'ON_DELIVERY',
      paidAt: body.paidAt ?? new Date().toISOString().slice(0, 10),
      reference: body.reference,
    }),
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
