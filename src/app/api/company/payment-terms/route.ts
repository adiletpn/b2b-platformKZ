import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { savePaymentTerms } from '@/lib/payments/terms';

/** Условия оплаты и кредитный лимит поставщика (раздел 3.6 ТЗ). */
export async function PUT(request: Request) {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const body = (await request.json().catch(() => ({}))) as Partial<Record<string, string>>;
  const result = await savePaymentTerms(guard.access.companyId, {
    paymentTerms: body.paymentTerms ?? '',
    deferralDays: body.deferralDays ?? '',
    creditLimit: body.creditLimit ?? '',
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
