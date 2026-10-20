import { NextResponse } from 'next/server';
import type { ReceiptPaymentType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { getStoreContext } from '@/lib/auth/store-context';
import { prisma } from '@/lib/prisma';
import { sell, type SaleInput } from '@/lib/pos/sale';

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

  const body = (await request.json().catch(() => ({}))) as Partial<SaleInput> & {
    paymentType?: ReceiptPaymentType;
  };
  // Офлайн-чек приходит со своим идентификатором: повтор не создаёт дубль.
  if (!body.clientId) return NextResponse.json({ status: 'empty_receipt' }, { status: 400 });

  // Раздел 3.12 ТЗ: максимальная скидка на кассе задаётся сотруднику.
  const membership = await prisma.membership.findUnique({
    where: { id: guard.access.membershipId },
    select: { maxDiscount: true },
  });
  const result = await sell(
    guard.access.companyId,
    guard.access.userId,
    store.locationId,
    {
      clientId: body.clientId,
      paymentType: body.paymentType ?? 'CASH',
      lines: body.lines ?? [],
      receiptDiscountPercent: body.receiptDiscountPercent,
      cashAmount: body.cashAmount,
      cardAmount: body.cardAmount,
      cashReceived: body.cashReceived,
      ageConfirmed: body.ageConfirmed === true,
    },
    { maxDiscount: membership?.maxDiscount?.toFixed(2) ?? null },
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
