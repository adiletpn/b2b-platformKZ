import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';

export async function GET() {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: { companyId: active.companyId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return NextResponse.json({
    notifications: notifications.map((item) => ({
      id: item.id,
      event: item.event,
      channels: item.channels,
      payload: item.payload,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}
