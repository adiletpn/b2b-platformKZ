import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { createReturn, type ReturnLine } from '@/lib/documents/returns';
import { withIdempotency } from '@/lib/orders/idempotency';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('ACCEPTANCE', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json()) as { idempotencyKey?: string; lines?: ReturnLine[] };

  // Правило 10: возврат — это документ, защищаем от двойного нажатия.
  const { result } = await withIdempotency(
    body.idempotencyKey,
    guard.access.companyId,
    'return',
    () => createReturn(id, guard.access.companyId, guard.access.userId, body.lines ?? []),
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
