import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';

const COOKIE_NAME = 'b2b_admin_session';
const SESSION_HOURS = 8;

/** Сессия администратора отдельная от кабинетов компаний (раздел 3.13 ТЗ). */
export async function createAdminSession(adminId: string) {
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const session = await prisma.adminSession.create({ data: { adminId, expiresAt } });

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

export async function getAdminSession() {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (!id) return null;

  const session = await prisma.adminSession.findUnique({
    where: { id },
    include: { admin: true },
  });
  if (!session || session.expiresAt < new Date() || !session.admin.isActive) return null;

  return session;
}

export async function destroyAdminSession() {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (id) await prisma.adminSession.deleteMany({ where: { id } });
  store.delete(COOKIE_NAME);
}

export type AdminGuard =
  { ok: true; adminId: string; role: string } | { ok: false; status: 401 | 403 };

/** Доступ администратора с проверкой роли. */
export async function requireAdmin(roles?: string[]): Promise<AdminGuard> {
  const session = await getAdminSession();
  if (!session) return { ok: false, status: 401 };
  if (roles && !roles.includes(session.admin.role)) return { ok: false, status: 403 };
  return { ok: true, adminId: session.adminId, role: session.admin.role };
}

/** Раздел 3.13 ТЗ: журнал аудита без возможности удаления записей. */
export async function writeAdminAudit(
  adminId: string,
  action: string,
  options: { entity?: string; entityId?: string; reason?: string } = {},
) {
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action,
      entity: options.entity ?? null,
      entityId: options.entityId ?? null,
      reason: options.reason ?? null,
    },
  });
}
