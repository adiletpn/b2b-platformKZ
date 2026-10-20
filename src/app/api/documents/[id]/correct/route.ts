import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { correctDocument } from '@/lib/documents/versions';

/** Исправление документа новой версией (раздел 4.3 ТЗ). Право UPDATE в матрице. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    reason?: string;
    deliveryAddress?: string;
    idempotencyKey?: string;
  };
  const result = await correctDocument({
    documentId: id,
    companyId: guard.access.companyId,
    userId: guard.access.userId,
    reason: body.reason ?? '',
    deliveryAddress: body.deliveryAddress,
    idempotencyKey: body.idempotencyKey,
  });

  const status = result.status === 'ok' ? 200 : result.status === 'not_found' ? 404 : 400;
  return NextResponse.json(result, { status });
}
