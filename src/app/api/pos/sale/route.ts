import { NextResponse } from 'next/server';
import type { ReceiptPaymentType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { sell, type SaleLine } from '@/lib/pos/sale';

export async function POST(request: Request) {
  const guard = await requirePermission('POS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const store = await getStoreContext();
  if (!store) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    clientId?: string;
    paymentType?: ReceiptPaymentType;
    lines?: SaleLine[];
  };
  // Офлайн-чек приходит со своим идентификатором: повтор не создаёт дубль.
  if (!body.clientId) return NextResponse.json({ status: 'empty_receipt' }, { status: 400 });

  const result = await sell(guard.access.companyId, guard.access.userId, store.locationId, {
    clientId: body.clientId,
    paymentType: body.paymentType ?? 'CASH',
    lines: body.lines ?? [],
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
