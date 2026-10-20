import { NextResponse } from 'next/server';
import { issueLoginCode } from '@/lib/auth/otp';
import { normalizePhone } from '@/lib/phone';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { phone?: string; locale?: string };
  const phone = normalizePhone(body.phone ?? '');
  if (!phone) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  const issued = await issueLoginCode(phone, body.locale === 'kk' ? 'kk' : 'ru');
  if (!issued.ok) {
    return NextResponse.json(
      { error: issued.error },
      { status: issued.error === 'too_many_requests' ? 429 : 502 },
    );
  }
  // Код в ответе только у мока SMS: с настоящим провайдером он приходит лишь в SMS.
  return NextResponse.json({
    phone,
    expiresAt: issued.expiresAt,
    ...(issued.code ? { code: issued.code } : {}),
  });
}
