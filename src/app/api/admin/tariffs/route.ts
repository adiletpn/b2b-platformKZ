import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { listPlans, savePlan, type PlanInput } from '@/lib/admin/tariffs';

export async function GET() {
  const guard = await requireAdmin(['SUPERADMIN', 'FINANCE']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  return NextResponse.json({ plans: await listPlans() });
}

export async function POST(request: Request) {
  // Тарифами и настройками платформы управляет только суперадмин (раздел 3.13 ТЗ).
  const guard = await requireAdmin(['SUPERADMIN']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<PlanInput>;
  const result = await savePlan(guard.adminId, {
    code: body.code ?? '',
    nameRu: body.nameRu ?? '',
    nameKk: body.nameKk ?? '',
    priceMonthly: body.priceMonthly ?? '0',
    maxLocations: body.maxLocations,
    maxEmployees: body.maxEmployees,
    maxProducts: body.maxProducts,
    trialDays: body.trialDays,
    isActive: body.isActive,
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
