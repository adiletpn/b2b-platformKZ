import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getLabels, repriceAll, setMarkup, setPieceSale } from '@/lib/stock/pricing';

export async function GET() {
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  return NextResponse.json({ prices: await getLabels(guard.access.companyId) });
}

export async function POST(request: Request) {
  // Наценка и переоценка — право на изменение остатков (раздел 3.12 ТЗ).
  const guard = await requirePermission('STOCK', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: 'markup' | 'reprice' | 'pieces';
    categoryId?: string | null;
    percent?: string;
    productId?: string;
    piecesPerPack?: string | null;
    piecePrice?: string | null;
  };

  if (body.action === 'pieces') {
    const result = await setPieceSale(
      guard.access.companyId,
      guard.access.userId,
      body.productId ?? '',
      { piecesPerPack: body.piecesPerPack ?? null, piecePrice: body.piecePrice ?? null },
    );
    return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
  }

  const result =
    body.action === 'reprice'
      ? await repriceAll(guard.access.companyId, guard.access.userId)
      : await setMarkup(guard.access.companyId, body.categoryId ?? null, body.percent ?? '');

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
