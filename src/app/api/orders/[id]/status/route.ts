import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import type { OrderStatus } from '@/generated/prisma/enums';
import { getActiveCompany } from '@/lib/auth/active-company';
import { changeStatus } from '@/lib/orders/workflow';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('SWIPE_ORDERS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = (await request.json()) as { status?: OrderStatus; comment?: string };
  if (!body.status) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const result = await changeStatus(id, active.companyId, active.userId, body.status, body.comment);
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
