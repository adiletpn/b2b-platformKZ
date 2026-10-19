import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getProductLedger } from '@/lib/stock/documents';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { productId } = await params;
  const locationId = new URL(request.url).searchParams.get('locationId') ?? undefined;

  return NextResponse.json({
    entries: await getProductLedger(guard.access.companyId, productId, locationId),
  });
}
