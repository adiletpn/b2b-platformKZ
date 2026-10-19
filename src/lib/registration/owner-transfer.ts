import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';
import { sendLoginCode } from '@/mocks/sms';
import { notify } from '@/mocks/notifications';

const CODE_TTL_MINUTES = 10;

export type TransferRequest =
  | { status: 'ok'; transferId: string; code: string }
  | { status: 'not_owner' }
  | { status: 'not_found' };

/**
 * Раздел 3.11 ТЗ: права Владельца передаются другому сотруднику с подтверждением кодом.
 * Код в демо показывается в интерфейсе, реальной отправки нет.
 */
export async function requestOwnerTransfer(
  companyId: string,
  actorId: string,
  membershipId: string,
): Promise<TransferRequest> {
  const owner = await prisma.membership.findFirst({
    where: { companyId, userId: actorId, role: 'OWNER', status: 'ACTIVE' },
    include: { user: true },
  });
  if (!owner) return { status: 'not_owner' };

  const target = await prisma.membership.findFirst({
    where: { id: membershipId, companyId, status: 'ACTIVE' },
  });
  if (!target || target.id === owner.id) return { status: 'not_found' };

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const transfer = await prisma.ownerTransfer.create({
    data: {
      companyId,
      fromMembership: owner.id,
      toMembership: target.id,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    },
  });

  sendLoginCode(owner.user.phone, code);
  await writeAudit(companyId, actorId, 'owner_transfer_requested', 'Membership', target.id);

  return { status: 'ok', transferId: transfer.id, code };
}

export type TransferResult =
  | { status: 'ok'; newOwnerMembershipId: string }
  | { status: 'invalid_code' }
  | { status: 'expired' }
  | { status: 'not_found' };

/** Подтверждение кодом: новый Владелец получает роль, прежний остаётся сотрудником. */
export async function confirmOwnerTransfer(
  companyId: string,
  actorId: string,
  transferId: string,
  code: string,
): Promise<TransferResult> {
  const transfer = await prisma.ownerTransfer.findFirst({
    where: { id: transferId, companyId, confirmedAt: null },
  });
  if (!transfer) return { status: 'not_found' };

  const owner = await prisma.membership.findFirst({
    where: { id: transfer.fromMembership, companyId, userId: actorId, role: 'OWNER' },
  });
  if (!owner) return { status: 'not_found' };
  if (transfer.expiresAt < new Date()) return { status: 'expired' };
  if (transfer.code !== code.trim()) return { status: 'invalid_code' };

  const target = await prisma.membership.findFirstOrThrow({
    where: { id: transfer.toMembership, companyId },
  });

  await prisma.$transaction(async (tx) => {
    // Прежний Владелец сохраняет место в компании с ролью нового Владельца.
    await tx.membership.update({
      where: { id: owner.id },
      data: { role: target.role, roleId: target.roleId },
    });
    await tx.membership.update({
      where: { id: target.id },
      data: { role: 'OWNER', roleId: null, orderLimit: null, maxDiscount: null },
    });
    await tx.ownerTransfer.update({
      where: { id: transfer.id },
      data: { confirmedAt: new Date() },
    });
  });

  await writeAudit(companyId, actorId, 'owner_transferred', 'Membership', target.id);
  await notify(companyId, 'owner_transferred', {});

  return { status: 'ok', newOwnerMembershipId: target.id };
}
