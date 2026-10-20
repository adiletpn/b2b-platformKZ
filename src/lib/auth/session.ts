import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';

const COOKIE_NAME = 'b2b_session';
const SESSION_DAYS = 30;

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.session.create({ data: { userId, expiresAt } });

  const store = await cookies();
  store.set(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });

  return session;
}

export async function getSession() {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (!id) return null;

  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { include: { memberships: { include: { company: true } } } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  // Раздел 3.13 ТЗ: заблокированный администратором пользователь теряет доступ сразу.
  if (session.user.blockedAt) return null;

  return session;
}

export async function setActiveCompany(sessionId: string, companyId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { activeCompanyId: companyId } });
}

export async function destroySession() {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (id) await prisma.session.deleteMany({ where: { id } });
  store.delete(COOKIE_NAME);
}
