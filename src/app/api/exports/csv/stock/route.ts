import { NextResponse } from 'next/server';
import { hasPermission, requirePermission } from '@/lib/auth/permissions';
import { stockCsv } from '@/lib/exports/csv';

/** Остатки по точкам в CSV (раздел 4.4 ТЗ). Себестоимость — только с правом на закупочные цены. */
export async function GET() {
  const guard = await requirePermission('STOCK', 'EXPORT');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const csv = await stockCsv(guard.access.companyId, {
    allowedLocationIds: guard.access.allowedLocationIds,
    withCost: await hasPermission(guard.access, 'PURCHASE_PRICES', 'VIEW'),
  });
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="stock.csv"',
    },
  });
}
