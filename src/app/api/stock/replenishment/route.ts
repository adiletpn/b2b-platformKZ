import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import {
  buildRecommendationDraft,
  buildReplenishmentDraft,
  getRecommendations,
  getReplenishment,
} from '@/lib/stock/replenishment';

/** `?kind=recommendations` — рекомендации по скорости продаж вместо минимального остатка. */
function wantsRecommendations(request: Request) {
  return new URL(request.url).searchParams.get('kind') === 'recommendations';
}

export async function GET(request: Request) {
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  return NextResponse.json({
    rows: wantsRecommendations(request)
      ? await getRecommendations(guard.access.companyId, store.locationId)
      : await getReplenishment(guard.access.companyId, store.locationId),
  });
}

export async function POST(request: Request) {
  // Черновик заявки создаёт тот, кто может создавать заявки (раздел 3.12 ТЗ).
  const guard = await requirePermission('SWIPE_ORDERS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const build = wantsRecommendations(request) ? buildRecommendationDraft : buildReplenishmentDraft;
  const result = await build(
    guard.access.companyId,
    guard.access.userId,
    store.locationId,
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
