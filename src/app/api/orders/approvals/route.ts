import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { listPendingApprovals } from '@/lib/orders/approval';

export async function GET() {
  // Согласование — право на изменение заявок: у Владельца и старшего менеджера.
  const guard = await requirePermission('SWIPE_ORDERS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  return NextResponse.json({ approvals: await listPendingApprovals(guard.access.companyId) });
}
