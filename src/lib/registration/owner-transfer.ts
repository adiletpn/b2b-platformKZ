import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';
import { deliverCode, isSmsLive, type PhoneProof } from '@/lib/sms/sms';
import { verifyFirebasePhone } from '@/lib/sms/firebase';
import { notify } from '@/mocks/notifications';

const CODE_TTL_MINUTES = 10;

export type TransferRequest =
  /**
   * code есть только у мока SMS: тогда его показывает интерфейс демо. С Firebase
   * (via: 'firebase') код на phone Владельца отправляет браузер.
   */
  | { status: 'ok'; transferId: string; via: 'firebase' | 'mock'; phone: string; code?: string }
  | { status: 'sms_failed' }
  | { status: 'not_owner' }
  | { status: 'not_found' };

/**
 * Раздел 3.11 ТЗ: права Владельца передаются другому сотруднику с подтверждением кодом.
 * Код уходит Владельцу по SMS (через Firebase); у мока SMS он показывается в интерфейсе.
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

  // С Firebase код знает только Firebase: в базе остаётся случайное значение,
  // подтверждение идёт ID-токеном на номер Владельца.
  const code = String(randomInt(100000, 1000000));
  const sent = deliverCode(owner.user.phone, code);

  const transfer = await prisma.ownerTransfer.create({
    data: {
      companyId,
      fromMembership: owner.id,
      toMembership: target.id,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    },
  });

  await writeAudit(companyId, actorId, 'owner_transfer_requested', 'Membership', target.id);

  return {
    status: 'ok',
    transferId: transfer.id,
    via: sent.via,
    phone: owner.user.phone,
    ...(sent.via === 'mock' ? { code } : {}),
  };
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
  proof: PhoneProof,
): Promise<TransferResult> {
  const transfer = await prisma.ownerTransfer.findFirst({
    where: { id: transferId, companyId, confirmedAt: null },
  });
  if (!transfer) return { status: 'not_found' };

  const owner = await prisma.membership.findFirst({
    where: { id: transfer.fromMembership, companyId, userId: actorId, role: 'OWNER' },
    include: { user: { select: { phone: true } } },
  });
  if (!owner) return { status: 'not_found' };
  if (transfer.expiresAt < new Date()) return { status: 'expired' };
  const confirmed = isSmsLive()
    ? proof.idToken !== undefined && (await verifyFirebasePhone(proof.idToken, owner.user.phone))
    : proof.code !== undefined && transfer.code === proof.code.trim();
  if (!confirmed) return { status: 'invalid_code' };

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
