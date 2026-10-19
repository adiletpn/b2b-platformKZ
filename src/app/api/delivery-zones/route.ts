import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';

export async function PUT(request: Request) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('CATALOG', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json()) as {
    zones?: { cityId: string; minOrderAmount?: string; leadTimeDays?: number }[];
  };
  const zones = body.zones ?? [];

  await prisma.$transaction(async (tx) => {
    await tx.deliveryZone.deleteMany({ where: { supplierId: active.companyId } });
    if (zones.length === 0) return;
    await tx.deliveryZone.createMany({
      data: zones.map((zone) => ({
        supplierId: active.companyId,
        cityId: zone.cityId,
        minOrderAmount: zone.minOrderAmount ?? '0',
        leadTimeDays: zone.leadTimeDays ?? 1,
      })),
    });
  });

  return NextResponse.json({ saved: zones.length });
}
