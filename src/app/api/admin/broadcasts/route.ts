import { NextResponse } from 'next/server';
import type { CompanyType } from '@/generated/prisma/enums';
import { requireAdmin } from '@/lib/admin/session';
import { sendBroadcast } from '@/lib/admin/broadcasts';
function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

const TYPES: CompanyType[] = ['STORE', 'SUPPLIER', 'BOTH'];

/** Массовая рассылка по сегменту (раздел 3.13 ТЗ). */
export async function POST(request: Request) {
  const guard = await requireAdmin(['SUPERADMIN', 'CONTENT_MANAGER']);
  if (!guard.ok) return denied(guard.status);
  const body = (await request.json().catch(() => ({}))) as Partial<Record<string, string>>;
  const result = await sendBroadcast(guard.adminId, {
    text: body.text ?? '',
    cityId: body.cityId || undefined,
    type: TYPES.find((item) => item === body.type),
    planCode: body.planCode || undefined,
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
