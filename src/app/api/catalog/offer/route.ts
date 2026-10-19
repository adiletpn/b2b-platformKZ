import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { createOfferManually, type ManualOfferInput } from '@/lib/catalog/manual';

export async function POST(request: Request) {
  const guard = await requirePermission('CATALOG', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<ManualOfferInput>;
  const result = await createOfferManually(guard.access.companyId, {
    barcode: body.barcode ?? '',
    nameRu: body.nameRu ?? '',
    nameKk: body.nameKk ?? '',
    unitCode: body.unitCode ?? '',
    vatCode: body.vatCode ?? '',
    priceWithoutVat: body.priceWithoutVat ?? '0',
    packSize: body.packSize ?? '1',
    minBatch: body.minBatch ?? '1',
    stock: body.stock ?? '0',
    sku: body.sku,
    brand: body.brand,
    manufacturer: body.manufacturer,
    country: body.country,
    categoryCode: body.categoryCode,
    tnvedCode: body.tnvedCode,
    expiresAt: body.expiresAt,
    isMarked: body.isMarked,
    isExcise: body.isExcise,
    requiresSnt: body.requiresSnt,
    isLicensed: body.isLicensed,
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
