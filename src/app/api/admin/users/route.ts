import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { resetSessions, searchUsers, setUserBlocked } from '@/lib/admin/users';

const ROLES = ['SUPERADMIN', 'SUPPORT'];
function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Пользователи платформы: поиск по телефону и ФИО (раздел 3.13 ТЗ). */
export async function GET(request: Request) {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) return denied(guard.status);
  const query = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json({ users: await searchUsers(query) });
}

/** Сброс сессий, блокировка и разблокировка — с записью в журнал аудита. */
export async function POST(request: Request) {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) return denied(guard.status);
  const body = (await request.json().catch(() => ({}))) as {
    userId?: string;
    action?: string;
    reason?: string;
  };
  const userId = body.userId ?? '';
  const result =
    body.action === 'reset'
      ? await resetSessions(guard.adminId, userId)
      : body.action === 'block' || body.action === 'unblock'
        ? await setUserBlocked(guard.adminId, userId, body.action === 'block', body.reason ?? '')
        : { status: 'invalid_action' as const };
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
