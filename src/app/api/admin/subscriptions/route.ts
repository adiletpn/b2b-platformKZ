import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { assignPlan, listSubscriptions } from '@/lib/admin/tariffs';

export async function GET() {
  const guard = await requireAdmin(['SUPERADMIN', 'FINANCE']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  return NextResponse.json({ subscriptions: await listSubscriptions() });
}

export async function POST(request: Request) {
  // Подписки и счёта платформы ведут финансы и суперадмин (раздел 3.13 ТЗ).
  const guard = await requireAdmin(['SUPERADMIN', 'FINANCE']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    companyId?: string;
    planCode?: string;
    months?: number;
  };

  const result = await assignPlan(
    guard.adminId,
    body.companyId ?? '',
    body.planCode ?? '',
    body.months ?? 0,
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
