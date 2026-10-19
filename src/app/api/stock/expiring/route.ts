import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getExpiring } from '@/lib/stock/batches';

export async function GET(request: Request) {
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const days = Number(new URL(request.url).searchParams.get('days') ?? '14');
  return NextResponse.json({
    rows: await getExpiring(guard.access.companyId, Number.isFinite(days) ? days : 14),
  });
}
