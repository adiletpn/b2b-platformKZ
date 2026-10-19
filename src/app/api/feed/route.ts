import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { getFeed } from '@/lib/feed/query';

export async function GET(request: Request) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const offers = await getFeed(store.companyId, store.cityId, {
    forSwipe: params.get('mode') === 'swipe',
    filters: {
      categoryId: params.get('categoryId') ?? undefined,
      supplierId: params.get('supplierId') ?? undefined,
      brand: params.get('brand') ?? undefined,
      priceMax: params.get('priceMax') ?? undefined,
      search: params.get('search')?.trim() || undefined,
      onlyPromo: params.get('onlyPromo') === 'true',
      onlyNew: params.get('onlyNew') === 'true',
      onlyTomorrow: params.get('onlyTomorrow') === 'true',
      minRating: params.get('minRating') ?? undefined,
    },
  });

  return NextResponse.json({ offers });
}
