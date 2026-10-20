import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { startOnlinePayment } from '@/lib/payments/online';
import { PAYMENT_PROVIDERS, type PaymentProvider } from '@/mocks/payment-gateway';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { provider?: string };
  const provider = body.provider ?? 'kaspi';
  if (!PAYMENT_PROVIDERS.includes(provider as PaymentProvider)) {
    return NextResponse.json({ status: 'invalid_provider' }, { status: 400 });
  }
  const result = await startOnlinePayment(id, guard.access.companyId, provider);

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
