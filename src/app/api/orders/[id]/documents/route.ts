import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { createWaybillAndInvoice } from '@/lib/documents/create';
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
  const body = (await request.json().catch(() => ({}))) as { idempotencyKey?: string };

  // Правило 10: защита от двойного нажатия при создании документов.
  const { result } = await withIdempotency(
    body.idempotencyKey,
    active.companyId,
    'create_documents',
    () => createWaybillAndInvoice(id, active.companyId),
  );

  const ok = result.status === 'created' || result.status === 'already_exists';
  return NextResponse.json(result, { status: ok ? 200 : 400 });
}
