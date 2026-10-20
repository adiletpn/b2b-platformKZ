import { NextResponse } from 'next/server';
import { hasPermission, requirePermission } from '@/lib/auth/permissions';
import {
  addVisit,
  assignStore,
  eligibleStores,
  listAssignments,
  listReps,
  repStores,
  unassignStore,
} from '@/lib/reps/reps';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Владельцу — закрепления, представителю — только свои магазины (этап 3 ТЗ). */
export async function GET() {
  const guard = await requirePermission('SALES_REPS', 'VIEW');
  if (!guard.ok) return denied(guard.status);
  const { companyId, membershipId } = guard.access;
  const manage = await hasPermission(guard.access, 'SALES_REPS', 'UPDATE');
  return NextResponse.json({
    stores: await repStores(companyId, membershipId),
    ...(manage
      ? {
          reps: await listReps(companyId),
          customers: await eligibleStores(companyId),
          assignments: await listAssignments(companyId),
        }
      : {}),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<Record<string, string>>;
  if (body.action === 'visit') {
    const guard = await requirePermission('SALES_REPS', 'CREATE');
    if (!guard.ok) return denied(guard.status);
    const result = await addVisit(
      guard.access.companyId,
      guard.access.membershipId,
      guard.access.userId,
      body.storeId ?? '',
      body.comment ?? '',
    );
    return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
  }

  // Закрепление магазинов — право на изменение раздела, у Владельца оно есть.
  const guard = await requirePermission('SALES_REPS', 'UPDATE');
  if (!guard.ok) return denied(guard.status);
  const { companyId, userId } = guard.access;
  const result =
    body.action === 'unassign'
      ? await unassignStore(companyId, userId, body.storeId ?? '')
      : await assignStore(companyId, userId, body.membershipId ?? '', body.storeId ?? '');
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
