import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone';
import { writeAdminAudit } from './session';

export type UserRow = {
  id: string;
  phone: string;
  name: string | null;
  blocked: boolean;
  sessions: number;
  companies: { name: string; role: string; status: string }[];
};

/**
 * Раздел 3.13 ТЗ: поиск пользователя по телефону и ФИО, его компании и роли.
 * Телефон администратору виден полностью — он нужен поддержке; в логи он не пишется.
 */
export async function searchUsers(rawQuery: string): Promise<UserRow[]> {
  const query = rawQuery.trim();
  if (query.length < 3) return [];
  const phone = normalizePhone(query);
  const digits = query.replace(/\D/g, '');

  const users = await prisma.user.findMany({
    where: {
      OR: [
        ...(phone ? [{ phone }] : []),
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
        { name: { contains: query, mode: 'insensitive' as const } },
      ],
    },
    include: {
      memberships: { include: { company: { select: { name: true } }, customRole: true } },
      _count: { select: { sessions: true } },
    },
    take: 20,
    orderBy: { createdAt: 'desc' },
  });

  return users.map((user) => ({
    id: user.id,
    phone: user.phone,
    name: user.name,
    blocked: user.blockedAt !== null,
    sessions: user._count.sessions,
    companies: user.memberships.map((membership) => ({
      name: membership.company.name,
      role: membership.customRole?.nameRu ?? membership.role,
      status: membership.status,
    })),
  }));
}

/** Сброс всех сессий: пользователь войдёт заново по коду. */
export async function resetSessions(adminId: string, userId: string) {
  const deleted = await prisma.session.deleteMany({ where: { userId } });
  await writeAdminAudit(adminId, 'user_sessions_reset', { entity: 'User', entityId: userId });
  return { status: 'ok' as const, sessions: deleted.count };
}

/** Блокировка пользователя с причиной: сессии закрываются сразу, вход запрещён. */
export async function setUserBlocked(
  adminId: string,
  userId: string,
  blocked: boolean,
  rawReason: string,
) {
  const reason = rawReason.trim();
  if (blocked && reason.length < 3) return { status: 'reason_required' as const };
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { status: 'not_found' as const };

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { blockedAt: blocked ? new Date() : null } }),
    ...(blocked ? [prisma.session.deleteMany({ where: { userId } })] : []),
  ]);
  await writeAdminAudit(adminId, blocked ? 'user_blocked' : 'user_unblocked', {
    entity: 'User',
    entityId: userId,
    reason: reason || undefined,
  });
  return { status: 'ok' as const };
}
