import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { sideOf } from '@/lib/orders/workflow';
import { prisma } from '@/lib/prisma';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      store: { select: { name: true } },
      supplier: { select: { name: true } },
      items: { include: { offer: { include: { product: { include: { unit: true } } } } } },
      statusLogs: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Правило 4: чужая заявка не отдаётся и её существование не раскрывается.
  const side = sideOf(order, active.companyId);
  if (!side) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (side === 'supplier' && order.status === 'DRAFT') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({
    id: order.id,
    number: order.number,
    status: order.status,
    side,
    total: order.totalWithVat.toFixed(2),
    storeName: order.store.name,
    supplierName: order.supplier.name,
    rejectionReason: order.rejectionReason,
    items: order.items.map((item) => ({
      id: item.id,
      nameRu: item.offer.product.nameRu,
      nameKk: item.offer.product.nameKk,
      unitRu: item.offer.product.unit.nameRu,
      unitKk: item.offer.product.unit.nameKk,
      quantityOrdered: item.quantityOrdered.toFixed(3),
      quantityConfirmed: item.quantityConfirmed?.toFixed(3) ?? null,
      priceWithVat: item.priceWithVat.toFixed(2),
    })),
    statusLogs: order.statusLogs.map((log) => ({
      toStatus: log.toStatus,
      createdAt: log.createdAt.toISOString(),
    })),
  });
}
