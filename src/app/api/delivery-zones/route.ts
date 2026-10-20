import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const MAX_LEAD_DAYS = 60;

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

  const body = (await request.json().catch(() => ({}))) as {
    zones?: {
      cityId: string;
      minOrderAmount?: string;
      leadTimeDays?: number;
      deliveryDays?: number[];
    }[];
  };
  const zones = body.zones ?? [];

  // Сумма — деньги: до 2 знаков, без float (правило 1). Срок — целые дни.
  const cityIds = new Set(
    (
      await prisma.city.findMany({
        where: { id: { in: zones.map((zone) => zone.cityId) } },
        select: { id: true },
      })
    ).map((city) => city.id),
  );
  for (const zone of zones) {
    if (!cityIds.has(zone.cityId)) {
      return NextResponse.json({ error: 'unknown_city' }, { status: 400 });
    }
    if (!MONEY.test(zone.minOrderAmount ?? '0')) {
      return NextResponse.json(
        { error: 'invalid_min_order', cityId: zone.cityId },
        { status: 400 },
      );
    }
    const lead = zone.leadTimeDays ?? 1;
    if (!Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_DAYS) {
      return NextResponse.json(
        { error: 'invalid_lead_time', cityId: zone.cityId },
        { status: 400 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.deliveryZone.deleteMany({ where: { supplierId: active.companyId } });
    if (zones.length === 0) return;
    await tx.deliveryZone.createMany({
      data: zones.map((zone) => ({
        supplierId: active.companyId,
        cityId: zone.cityId,
        minOrderAmount: zone.minOrderAmount ?? '0',
        leadTimeDays: zone.leadTimeDays ?? 1,
        // Дни доставки: 1 — понедельник, 7 — воскресенье (раздел 3.1 ТЗ).
        deliveryDays: (zone.deliveryDays ?? []).filter((day) => day >= 1 && day <= 7),
      })),
    });
  });

  return NextResponse.json({ saved: zones.length });
}
