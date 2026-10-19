import { prisma } from '@/lib/prisma';

/**
 * Правило 4: любой запрос к данным компании проверяет, что пользователь в неё входит.
 * Возвращает membership или null — вызывающий отдаёт 404, чтобы не раскрывать существование компании.
 */
export async function requireMembership(userId: string, companyId: string) {
  return prisma.membership.findFirst({
    where: { userId, companyId, status: 'ACTIVE' },
  });
}
