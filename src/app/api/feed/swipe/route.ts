import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { recordSwipe } from '@/lib/feed/swipe';

export async function POST(request: Request) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('SWIPE_ORDERS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json()) as { offerId?: string; action?: 'LIKE' | 'SKIP' | 'FAV' };
  if (!body.offerId || !body.action) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await recordSwipe(store.companyId, store.locationId, body.offerId, body.action);
  return NextResponse.json(result);
}
