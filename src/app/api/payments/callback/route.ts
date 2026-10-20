import { NextResponse } from 'next/server';
import { confirmOnlinePayment } from '@/lib/payments/online';

/**
 * Колбэк платёжного шлюза. Сессии у него нет: подтверждение опознаётся по
 * идентификатору платежа, который знает только шлюз. Повтор не создаёт второй платёж.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    externalId?: string;
    paid?: boolean;
  };
  if (!body.externalId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const result = await confirmOnlinePayment(body.externalId, body.paid !== false);
  const status = result.status === 'ok' ? 200 : result.status === 'not_found' ? 404 : 400;

  return NextResponse.json(result, { status });
}
