import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { markRead } from '@/lib/chat/chat';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const result = await markRead(id, guard.access.companyId);
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
