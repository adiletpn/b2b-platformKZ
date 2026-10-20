import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { searchMessages } from '@/lib/chat/extras';

/** Поиск по сообщениям своих переписок (раздел 3.7 ТЗ). */
export async function GET(request: Request) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const query = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json({ hits: await searchMessages(guard.access.companyId, query) });
}
