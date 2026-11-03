import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';
import { catalogRow, catalogRowInclude } from '@/lib/catalog/offer-row';

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
    include: catalogRowInclude,
    orderBy: { product: { nameRu: 'asc' } },
    take: 100,
  });

  return NextResponse.json({
    total: await prisma.supplierOffer.count({ where: { supplierId: active.companyId } }),
    offers: offers.map(catalogRow),
  });
}
