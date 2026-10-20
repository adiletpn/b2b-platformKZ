import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { writeAdminAudit } from './session';

export type ModerationResult =
  | { status: 'ok'; verification: 'APPROVED' | 'REJECTED' }
  | { status: 'not_found' }
  | { status: 'already_decided' }
  | { status: 'reason_required' };

/** Компания при регистрации встаёт в очередь на проверку (раздел 3.11 ТЗ). */
export async function createVerificationRequest(companyId: string) {
  return prisma.verificationRequest.create({ data: { companyId } });
}

/**
 * Модератор подтверждает или отклоняет компанию с причиной,
 * компания получает уведомление (критерий приёмки этапа 1 ТЗ).
 */
export async function decideVerification(
  adminId: string,
  requestId: string,
  approve: boolean,
  reason?: string,
): Promise<ModerationResult> {
  const request = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
  if (!request) return { status: 'not_found' };
  // Реквизиты не из реестра администратор сверяет и после автопроверки.
  const awaitsReview =
    request.status === 'PENDING' || (!request.fromRegistry && !request.decidedById);
  if (!awaitsReview) return { status: 'already_decided' };
  if (!approve && !reason?.trim()) return { status: 'reason_required' };

  const decision = approve ? 'APPROVED' : 'REJECTED';

  await prisma.$transaction(async (tx) => {
    await tx.verificationRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        reason: reason?.trim() || null,
        decidedById: adminId,
        decidedAt: new Date(),
      },
    });
    await tx.company.update({
      where: { id: request.companyId },
      data: { verificationStatus: approve ? 'VERIFIED' : 'NOT_VERIFIED' },
    });
  });

  await writeAdminAudit(adminId, approve ? 'company_approved' : 'company_rejected', {
    entity: 'Company',
    entityId: request.companyId,
    reason: reason?.trim(),
  });

  await notify(request.companyId, approve ? 'company_approved' : 'company_rejected', {
    reason: reason?.trim() ?? '',
  });

  return { status: 'ok', verification: decision };
}

/** Вход от имени компании: только с причиной и записью в журнал (раздел 3.13 ТЗ). */
export async function startImpersonation(adminId: string, companyId: string, reason: string) {
  if (!reason.trim()) return { status: 'reason_required' as const };

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { status: 'not_found' as const };

  const log = await prisma.impersonationLog.create({
    data: { adminId, companyId, reason: reason.trim() },
  });
  await writeAdminAudit(adminId, 'impersonation_started', {
    entity: 'Company',
    entityId: companyId,
    reason: reason.trim(),
  });

  return { status: 'ok' as const, impersonationId: log.id };
}

export async function stopImpersonation(adminId: string, impersonationId: string) {
  const log = await prisma.impersonationLog.findUnique({ where: { id: impersonationId } });
  if (!log || log.adminId !== adminId) return { status: 'not_found' as const };

  await prisma.impersonationLog.update({
    where: { id: impersonationId },
    data: { endedAt: new Date() },
  });
  await writeAdminAudit(adminId, 'impersonation_stopped', {
    entity: 'Company',
    entityId: log.companyId,
  });

  return { status: 'ok' as const };
}
