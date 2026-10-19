import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { blockEmployee, unblockEmployee } from '@/lib/employees/invitations';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { blocked?: boolean };

  const result =
    body.blocked === false
      ? await unblockEmployee(guard.access.companyId, guard.access.userId, id)
      : await blockEmployee(guard.access.companyId, guard.access.userId, id);

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
