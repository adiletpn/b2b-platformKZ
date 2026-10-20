import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { chatEventStream } from '@/lib/chat/live';

export const dynamic = 'force-dynamic';

/**
 * Чат в реальном времени (разделы 3.7 и 5.3 ТЗ): Server-Sent Events без новых зависимостей.
 * Поток идёт только по перепискам активной компании сотрудника (правило 4).
 */
export async function GET(request: Request) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const stream = chatEventStream({
    companyId: guard.access.companyId,
    membershipId: guard.access.membershipId,
    signal: request.signal,
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
