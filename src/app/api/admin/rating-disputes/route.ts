import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { listDisputedRatings, resolveRatingDispute } from '@/lib/ratings/rate';

const ROLES = ['SUPERADMIN', 'MODERATOR'];

/** Разбор оспоренных отзывов модератором (разделы 3.8 и 3.13 ТЗ). */
export async function GET() {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  return NextResponse.json({ disputes: await listDisputedRatings() });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(ROLES);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    decision?: string;
    resolution?: string;
  };
  const decision = body.decision === 'hide' ? 'hide' : 'keep';
  const result = await resolveRatingDispute(
    guard.adminId,
    body.id ?? '',
    decision,
    body.resolution ?? '',
  );
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
