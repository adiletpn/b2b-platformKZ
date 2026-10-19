import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { updateEmployeeAccess } from '@/lib/employees/roles';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    roleId?: string | null;
    allowedLocationIds?: string[];
    orderLimit?: string | null;
    maxDiscount?: string | null;
  };

  const result = await updateEmployeeAccess(guard.access.companyId, guard.access.userId, id, body);
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
