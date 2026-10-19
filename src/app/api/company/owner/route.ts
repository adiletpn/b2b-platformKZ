import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { confirmOwnerTransfer, requestOwnerTransfer } from '@/lib/registration/owner-transfer';

/** Шаг 1: запрос кода. Шаг 2: подтверждение кодом (раздел 3.11 ТЗ). */
export async function POST(request: Request) {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    membershipId?: string;
    transferId?: string;
    code?: string;
  };

  const result =
    body.transferId && body.code !== undefined
      ? await confirmOwnerTransfer(
          guard.access.companyId,
          guard.access.userId,
          body.transferId,
          body.code,
        )
      : await requestOwnerTransfer(
          guard.access.companyId,
          guard.access.userId,
          body.membershipId ?? '',
        );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
