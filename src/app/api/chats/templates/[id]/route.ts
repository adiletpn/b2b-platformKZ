import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { deleteTemplate } from '@/lib/chat/extras';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const status = await deleteTemplate(id, guard.access.companyId);
  return NextResponse.json({ status }, { status: status === 'ok' ? 200 : 404 });
}
