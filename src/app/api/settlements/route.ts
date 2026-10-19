import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getReceivables, getSettlement, markOverdueOrders } from '@/lib/settlements/receivables';

export async function GET(request: Request) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const params = new URL(request.url).searchParams;
  // Просрочки пересчитываются при открытии отчёта: фоновых задач в демо нет.
  await markOverdueOrders();

  const storeId = params.get('storeId');
  if (storeId) {
    const from = new Date(params.get('from') ?? '2020-01-01');
    const to = new Date(params.get('to') ?? new Date().toISOString().slice(0, 10));
    return NextResponse.json(await getSettlement(guard.access.companyId, storeId, from, to));
  }

  return NextResponse.json(await getReceivables(guard.access.companyId));
}
