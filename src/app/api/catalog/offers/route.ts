import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('CATALOG', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const search = new URL(request.url).searchParams.get('search')?.trim() ?? '';

  // Правило 4: только предложения своей компании.
  const offers = await prisma.supplierOffer.findMany({
    where: {
      supplierId: active.companyId,
      ...(search
        ? {
            product: {
              OR: [
                { nameRu: { contains: search, mode: 'insensitive' } },
                { nameKk: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search } },
              ],
            },
          }
        : {}),
    },
    include: { product: { include: { unit: true } }, vatRate: true },
    orderBy: { product: { nameRu: 'asc' } },
    take: 100,
  });

  return NextResponse.json({
    total: await prisma.supplierOffer.count({ where: { supplierId: active.companyId } }),
    offers: offers.map((offer) => ({
      id: offer.id,
      barcode: offer.product.barcode,
      nameRu: offer.product.nameRu,
      nameKk: offer.product.nameKk,
      unitRu: offer.product.unit.nameRu,
      unitKk: offer.product.unit.nameKk,
      priceWithoutVat: offer.priceWithoutVat.toFixed(2),
      priceWithVat: offer.priceWithVat.toFixed(2),
      vatRate: offer.vatRate.rate.toFixed(2),
      stock: offer.stock.toFixed(3),
      minBatch: offer.minBatch.toFixed(3),
    })),
  });
}
