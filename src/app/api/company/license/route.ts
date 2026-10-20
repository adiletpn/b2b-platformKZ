import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { saveLicense } from '@/lib/licenses/licenses';

/** Лицензия компании на лицензируемые товары (раздел 2 ТЗ). */
export async function PUT(request: Request) {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const body = (await request.json().catch(() => ({}))) as Partial<Record<string, string>>;
  const result = await saveLicense(guard.access.companyId, {
    number: body.number ?? '',
    validUntil: body.validUntil ?? '',
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
