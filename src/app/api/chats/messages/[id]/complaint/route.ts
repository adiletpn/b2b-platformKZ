import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { complain } from '@/lib/chat/extras';

/** Жалоба на сообщение собеседника — уходит модератору платформы (раздел 3.7 ТЗ). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const result = await complain(id, guard.access.companyId, body.reason ?? '');
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
