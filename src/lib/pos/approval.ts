import { prisma } from '@/lib/prisma';
import { normalizePhone } from '@/lib/phone';
import { consumeCode, issueLoginCode } from '@/lib/auth/otp';
import { hasPermission } from '@/lib/auth/permissions';

/**
 * Возврат чека с подтверждением старшего (разделы 4.2 и 3.12 ТЗ). Кассир без права
 * «Касса → изменение» просит старшего: тот получает код входа и называет его кассиру.
 * Способ подтверждения (код, PIN, второй вход) выбран по умолчанию — TODO(open-question).
 */
export type ApprovalResult =
  | { status: 'ok'; approverId: string }
  | { status: 'invalid_phone' }
  | { status: 'not_senior' }
  | { status: 'invalid_code' }
  | { status: 'sms_failed' }
  | { status: 'too_many_requests' };

/** Старший — активный сотрудник этой же компании с правом на изменение в кассе. */
async function findSenior(companyId: string, rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { status: 'invalid_phone' as const };
  const membership = await prisma.membership.findFirst({
    where: { companyId, status: 'ACTIVE', user: { phone } },
  });
  if (!membership) return { status: 'not_senior' as const };
  const allowed = await hasPermission(
    {
      userId: membership.userId,
      companyId,
      membershipId: membership.id,
      roleCode: membership.role,
      allowedLocationIds: membership.allowedLocationIds,
      orderLimit: null,
    },
    'POS',
    'UPDATE',
  );
  if (!allowed) return { status: 'not_senior' as const };
  return { status: 'ok' as const, phone, userId: membership.userId };
}

/** Код старшему. У мока SMS он возвращается в ответе, как код входа. */
export async function requestApprovalCode(companyId: string, rawPhone: string) {
  const senior = await findSenior(companyId, rawPhone);
  if (senior.status !== 'ok') return senior;
  const issued = await issueLoginCode(senior.phone);
  if (!issued.ok) return { status: issued.error };
  return { status: 'ok' as const, ...(issued.code ? { code: issued.code } : {}) };
}

export async function checkApproval(
  companyId: string,
  rawPhone: string,
  code: string,
): Promise<ApprovalResult> {
  const senior = await findSenior(companyId, rawPhone);
  if (senior.status !== 'ok') return senior;
  const consumed = await consumeCode(senior.phone, code.trim());
  if (!consumed.ok) return { status: 'invalid_code' };
  return { status: 'ok', approverId: senior.userId };
}
