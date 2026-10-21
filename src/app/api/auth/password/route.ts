import { NextResponse } from 'next/server';
import {
  isPasswordLoginEnabled,
  loginWithPassword,
  registerWithPassword,
} from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { normalizePhone } from '@/lib/phone';
import { prisma } from '@/lib/prisma';

/** Временный вход и регистрация по номеру и паролю. */
export async function POST(request: Request) {
  if (!(await isPasswordLoginEnabled())) {
    return NextResponse.json({ error: 'password_disabled' }, { status: 403 });
  }
  const body = (await request.json()) as {
    phone?: string;
    password?: string;
    mode?: 'login' | 'register';
  };
  const phone = normalizePhone(body.phone ?? '');
  if (!phone) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  const password = body.password ?? '';

  const result =
    body.mode === 'register'
      ? await registerWithPassword(phone, password)
      : await loginWithPassword(phone, password);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === 'user_blocked' ? 403 : 400 },
    );
  }

  await createSession(result.userId);
  const memberships = await prisma.membership.count({
    where: { userId: result.userId, status: 'ACTIVE' },
  });
  return NextResponse.json({ hasCompany: memberships > 0 });
}
