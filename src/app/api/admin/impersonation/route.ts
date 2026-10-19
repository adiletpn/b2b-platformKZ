import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { startImpersonation, stopImpersonation } from '@/lib/admin/moderation';

export async function POST(request: Request) {
  // Вход от имени — только Поддержка и Суперадмин (раздел 3.13 ТЗ).
  const guard = await requireAdmin(['SUPERADMIN', 'SUPPORT']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json()) as {
    companyId?: string;
    reason?: string;
    stopId?: string;
  };

  const result = body.stopId
    ? await stopImpersonation(guard.adminId, body.stopId)
    : await startImpersonation(guard.adminId, body.companyId ?? '', body.reason ?? '');

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
