import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { rateOrder } from '@/lib/ratings/rate';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json()) as {
    criteria?: Record<string, number>;
    comment?: string;
  };

  const result = await rateOrder({
    orderId: id,
    authorCompanyId: guard.access.companyId,
    criteria: body.criteria ?? {},
    comment: body.comment,
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
