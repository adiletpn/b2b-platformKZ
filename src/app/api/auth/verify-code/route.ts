import { NextResponse } from 'next/server';
import { verifyLoginCode } from '@/lib/auth/otp';
import { createSession } from '@/lib/auth/session';
import { normalizePhone } from '@/lib/phone';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string; code?: string };
  const phone = normalizePhone(body.phone ?? '');
  if (!phone || !body.code) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  const result = await verifyLoginCode(phone, body.code);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { blockedAt: true },
  });
  if (user?.blockedAt) return NextResponse.json({ error: 'user_blocked' }, { status: 403 });

  await createSession(result.userId);

  const memberships = await prisma.membership.findMany({
    where: { userId: result.userId, status: 'ACTIVE' },
  });

  return NextResponse.json({ hasCompany: memberships.length > 0 });
}
