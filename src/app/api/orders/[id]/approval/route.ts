import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { decideApproval } from '@/lib/orders/approval';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    approved?: boolean;
    reason?: string;
  };

  const result = await decideApproval(
    guard.access.companyId,
    guard.access.userId,
    id,
    body.approved !== false,
    body.reason,
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
