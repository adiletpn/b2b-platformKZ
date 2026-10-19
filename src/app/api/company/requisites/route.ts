import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { saveRequisites } from '@/lib/payments/requisites';

export async function PUT(request: Request) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json()) as { iik?: string; bik?: string; bankName?: string };
  const result = await saveRequisites(active.companyId, {
    iik: body.iik ?? '',
    bik: body.bik ?? '',
    bankName: body.bankName ?? '',
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
