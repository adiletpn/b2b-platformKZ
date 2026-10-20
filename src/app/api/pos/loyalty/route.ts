import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { lookupCustomer } from '@/lib/pos/loyalty';

/** Бонусный баланс покупателя по телефону для кассира (этап 3 ТЗ). Только своя компания. */
export async function GET(request: Request) {
  const guard = await requirePermission('POS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const phone = new URL(request.url).searchParams.get('phone') ?? '';
  const result = await lookupCustomer(guard.access.companyId, phone);
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
