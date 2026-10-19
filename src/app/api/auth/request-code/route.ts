import { NextResponse } from 'next/server';
import { issueLoginCode } from '@/lib/auth/otp';
import { normalizePhone } from '@/lib/phone';

export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string };
  const phone = normalizePhone(body.phone ?? '');
  if (!phone) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  const { code, expiresAt } = await issueLoginCode(phone);
  // Демо-мок: код возвращается в ответе, чтобы показать его в интерфейсе.
  return NextResponse.json({ phone, code, expiresAt });
}
