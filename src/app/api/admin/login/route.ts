import { NextResponse } from 'next/server';
import { issueLoginCode } from '@/lib/auth/otp';
import { normalizePhone } from '@/lib/phone';
import { prisma } from '@/lib/prisma';

/** Шаг 1 входа администратора: код как второй фактор (в демо — мок). */
export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string };
  const phone = normalizePhone(body.phone ?? '');
  if (!phone) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  const admin = await prisma.adminUser.findUnique({ where: { phone } });
  // Не раскрываем, существует ли такой администратор.
  if (!admin || !admin.isActive) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const issued = await issueLoginCode(phone);
  if (!issued.ok) {
    return NextResponse.json(
      { error: issued.error },
      { status: issued.error === 'too_many_requests' ? 429 : 502 },
    );
  }
  // Код в ответе только у мока SMS, как во входе компаний.
  return NextResponse.json({ phone, ...(issued.code ? { code: issued.code } : {}) });
}
