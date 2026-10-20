import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import Decimal from 'decimal.js';
import { getStoreContext } from '@/lib/auth/store-context';
import { getCartGroups, setCartItem } from '@/lib/cart/cart';

export async function PUT(request: Request) {
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

  const body = (await request.json()) as { offerId?: string; quantity?: string };
  if (!body.offerId || body.quantity === undefined) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Decimal бросает исключение на «abc»: проверяем формат до разбора.
  const raw = String(body.quantity).replace(/\s/g, '').replace(',', '.') || '0';
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    return NextResponse.json({ error: 'invalid_quantity' }, { status: 400 });
  }
  const quantity = new Decimal(raw);

  const result = await setCartItem(store.locationId, body.offerId, quantity);
  return NextResponse.json({
    ...result,
    groups: await getCartGroups(store.locationId, store.cityId),
  });
}
