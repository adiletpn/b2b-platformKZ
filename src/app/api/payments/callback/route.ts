import { NextResponse } from 'next/server';
import { confirmOnlinePayment } from '@/lib/payments/online';
import { verifyGatewayCallback } from '@/mocks/payment-gateway';

/**
 * Колбэк платёжного шлюза. Сессии у него нет: подтверждение опознаётся по
 * идентификатору платежа и подписи шлюза в заголовке `x-signature`.
 * Повтор не создаёт второй платёж.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    externalId?: string;
    paid?: boolean;
  };
  if (!body.externalId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const paid = body.paid !== false;
  if (!verifyGatewayCallback(body.externalId, paid, request.headers.get('x-signature'))) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  const result = await confirmOnlinePayment(body.externalId, paid);
  const status = result.status === 'ok' ? 200 : result.status === 'not_found' ? 404 : 400;

  return NextResponse.json(result, { status });
}
