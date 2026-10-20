import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { listOpenComplaints, resolveComplaint } from '@/lib/chat/extras';

const ROLES = ['SUPERADMIN', 'MODERATOR'];

/** Модерация жалоб на сообщения чата (раздел 3.13 ТЗ). */
export async function GET() {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  return NextResponse.json({ complaints: await listOpenComplaints() });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { id?: string; resolution?: string };
  const result = await resolveComplaint(guard.adminId, body.id ?? '', body.resolution ?? '');
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
