import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getStoreContext } from '@/lib/auth/store-context';
import { checkout } from '@/lib/orders/checkout';
import { withIdempotency } from '@/lib/orders/idempotency';
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

  // Правило 4: видны только заявки, где компания — одна из сторон.
  const orders = await prisma.order.findMany({
    where: { OR: [{ storeId: active.companyId }, { supplierId: active.companyId }] },
    include: { store: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({
    companyId: active.companyId,
    orders: orders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      total: order.totalWithVat.toFixed(2),
      storeName: order.store.name,
      supplierName: order.supplier.name,
      side: order.storeId === active.companyId ? 'store' : 'supplier',
    })),
  });
}

export async function POST(request: Request) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('SWIPE_ORDERS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const active = await getActiveCompany();
  const body = (await request.json()) as {
    idempotencyKey?: string;
    deliveryDate?: string;
    comment?: string;
    paymentMethod?: 'PREPAY' | 'ON_DELIVERY' | 'DEFERRED';
  };

  const { result, replayed } = await withIdempotency(
    body.idempotencyKey,
    store.companyId,
    'checkout',
    () =>
      checkout({
        storeId: store.companyId,
        locationId: store.locationId,
        cityId: store.cityId,
        userId: active!.userId,
        deliveryDate: body.deliveryDate,
        comment: body.comment,
        paymentMethod: body.paymentMethod,
      }),
  );

  const httpStatus = result.status === 'created' ? (replayed ? 200 : 201) : 400;
  return NextResponse.json({ ...result, replayed }, { status: httpStatus });
}
