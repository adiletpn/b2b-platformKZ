import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { replyToRating } from '@/lib/ratings/rate';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json()) as { reply?: string };
  const result = await replyToRating(id, guard.access.companyId, body.reply ?? '');

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
