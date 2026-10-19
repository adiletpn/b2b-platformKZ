import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { getOfferDetails } from '@/lib/feed/offer-details';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const details = await getOfferDetails(store.companyId, store.cityId, id);
  if (!details) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(details);
}
