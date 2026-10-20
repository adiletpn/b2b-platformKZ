import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { catalogCsv } from '@/lib/exports/csv';

/** Каталог поставщика в CSV для обмена с другими системами (раздел 4.4 ТЗ). */
export async function GET() {
  const guard = await requirePermission('CATALOG', 'EXPORT');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const csv = await catalogCsv(guard.access.companyId);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="catalog.csv"',
    },
  });
}
