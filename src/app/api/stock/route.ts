import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { prisma } from '@/lib/prisma';

export async function GET() {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const balances = await prisma.stockBalance.findMany({
    where: { locationId: store.locationId },
    include: { product: { include: { unit: true } } },
    orderBy: { product: { nameRu: 'asc' } },
  });

  return NextResponse.json({
    balances: balances.map((balance) => ({
      productId: balance.productId,
      nameRu: balance.product.nameRu,
      nameKk: balance.product.nameKk,
      unitRu: balance.product.unit.nameRu,
      unitKk: balance.product.unit.nameKk,
      quantity: balance.quantity.toFixed(3),
      averageCost: balance.averageCost.toFixed(2),
    })),
  });
}
