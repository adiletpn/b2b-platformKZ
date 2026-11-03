import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { readProof, hasProof } from '@/lib/sms/sms';
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
    idToken?: string;
  };
  const proof = readProof(body);

  const result =
    body.transferId && hasProof(proof)
      ? await confirmOwnerTransfer(
          guard.access.companyId,
          guard.access.userId,
          body.transferId,
          proof,
        )
      : await requestOwnerTransfer(
          guard.access.companyId,
          guard.access.userId,
          body.membershipId ?? '',
        );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
