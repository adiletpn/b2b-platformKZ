import { randomUUID } from 'node:crypto';
import type { MembershipRole } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { normalizePhone, maskPhone } from '@/lib/phone';
import { writeAudit } from '@/lib/auth/permissions';

const MEMBERSHIP_ROLES: readonly MembershipRole[] = [
  'OWNER',
  'PURCHASING_MANAGER',
  'SALES_MANAGER',
  'STOREKEEPER',
  'ACCOUNTANT',
  'CASHIER',
  'DRIVER',
];

/**
 * Поле `Membership.role` из модели D1 знает только роли-шаблоны демо. Права берутся
 * из `roleId`, поэтому для новой системной роли (торговый представитель) и своих ролей
 * компании пишем нейтральную базовую роль: модель D1 не меняется.
 */
function baseMembershipRole(code: string): MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(code)
    ? (code as MembershipRole)
    : 'SALES_MANAGER';
}

/** Раздел 3.12 ТЗ: ссылка приглашения действует 7 дней. */
export const INVITATION_DAYS = 7;

export type InviteResult =
  | { status: 'ok'; invitationId: string; token: string }
  | { status: 'invalid_phone' }
  | { status: 'unknown_role' }
  | { status: 'already_member' };

export async function inviteEmployee(
  companyId: string,
  invitedBy: string,
  rawPhone: string,
  roleCode: string,
) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { status: 'invalid_phone' as const };

  const role = await prisma.role.findFirst({
    where: {
      OR: [
        { companyId, code: roleCode },
        { companyId: null, code: roleCode },
      ],
    },
  });
  if (!role) return { status: 'unknown_role' as const };

  const existingUser = await prisma.user.findUnique({ where: { phone } });
  if (existingUser) {
    const membership = await prisma.membership.findUnique({
      where: { userId_companyId: { userId: existingUser.id, companyId } },
    });
    if (membership) return { status: 'already_member' as const };
  }

  const invitation = await prisma.invitation.create({
    data: {
      companyId,
      phone,
      roleId: role.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  // Правило 11: номер в журнале и логе маскируется.
  await writeAudit(companyId, invitedBy, 'employee_invited', 'Invitation', invitation.id);
  console.info(`[sms-mock] приглашение отправлено на ${maskPhone(phone)}`);

  return { status: 'ok' as const, invitationId: invitation.id, token: invitation.token };
}

/**
 * Приглашённый входит по коду и сразу попадает в компанию с назначенной ролью.
 * Вызывается после успешной проверки кода входа.
 */
export async function acceptPendingInvitations(userId: string, phone: string) {
  const invitations = await prisma.invitation.findMany({
    where: { phone, status: 'PENDING' },
    include: { role: true },
  });

  const joined: string[] = [];
  for (const invitation of invitations) {
    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { userId_companyId: { userId, companyId: invitation.companyId } },
        update: { roleId: invitation.roleId, status: 'ACTIVE' },
        create: {
          userId,
          companyId: invitation.companyId,
          role: baseMembershipRole(invitation.role.code),
          roleId: invitation.roleId,
          status: 'ACTIVE',
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
    });

    await writeAudit(invitation.companyId, userId, 'employee_joined', 'Invitation', invitation.id);
    joined.push(invitation.companyId);
  }

  return joined;
}

/**
 * Блокировка сотрудника: доступ пропадает сразу, все его сессии завершаются,
 * документы и история остаются в компании (раздел 3.12 ТЗ).
 */
export async function blockEmployee(companyId: string, actorId: string, membershipId: string) {
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.companyId !== companyId) return { status: 'not_found' as const };
  if (membership.role === 'OWNER') return { status: 'cannot_block_owner' as const };

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: membershipId }, data: { status: 'BLOCKED' } });
    await tx.session.deleteMany({ where: { userId: membership.userId } });
  });

  await writeAudit(companyId, actorId, 'employee_blocked', 'Membership', membershipId);
  return { status: 'ok' as const };
}

export async function unblockEmployee(companyId: string, actorId: string, membershipId: string) {
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.companyId !== companyId) return { status: 'not_found' as const };

  await prisma.membership.update({ where: { id: membershipId }, data: { status: 'ACTIVE' } });
  await writeAudit(companyId, actorId, 'employee_unblocked', 'Membership', membershipId);
  return { status: 'ok' as const };
}
