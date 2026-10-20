import { NextResponse } from 'next/server';
import type { TicketStatus } from '@/generated/prisma/enums';
import { requireAdmin } from '@/lib/admin/session';
import { adminTicketAction, listTickets } from '@/lib/support/tickets';

const ROLES = ['SUPERADMIN', 'SUPPORT'];
const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'CLOSED'];
function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Очередь обращений в поддержку (раздел 3.13 ТЗ). */
export async function GET(request: Request) {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) return denied(guard.status);
  const status = STATUSES.find((item) => item === new URL(request.url).searchParams.get('status'));
  return NextResponse.json({ tickets: await listTickets(status) });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) return denied(guard.status);
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    reply?: string;
    assignToMe?: boolean;
    status?: string;
  };
  const status = STATUSES.find((item) => item === body.status);
  const result = await adminTicketAction(guard.adminId, body.id ?? '', {
    reply: body.reply,
    assignToMe: body.assignToMe,
    status,
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
