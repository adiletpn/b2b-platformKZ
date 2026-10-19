import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { decideVerification, startImpersonation, stopImpersonation } from '@/lib/admin/moderation';
import { writeAdminAudit } from '@/lib/admin/session';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function moderator() {
  return prisma.adminUser.findFirstOrThrow({ where: { role: 'MODERATOR' } });
}

async function createCompany(index: number) {
  const user = await prisma.user.create({
    data: { phone: `+7730${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(280 + index),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);
  return result.companyId;
}

/** Выключаем автопроверку, чтобы компания вставала в очередь к модератору. */
async function withManualVerification<T>(run: () => Promise<T>): Promise<T> {
  await prisma.platformSetting.update({
    where: { key: 'auto_verify_companies' },
    data: { value: 'false' },
  });
  try {
    return await run();
  } finally {
    await prisma.platformSetting.update({
      where: { key: 'auto_verify_companies' },
      data: { value: 'true' },
    });
  }
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.adminAuditLog.deleteMany();
  await prisma.impersonationLog.deleteMany();
  await prisma.verificationRequest.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('проверка компаний модератором', () => {
  it('company_waits_for_review_when_auto_verify_is_off', async () => {
    const companyId = await withManualVerification(() => createCompany(1));

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.verificationStatus).toBe('PENDING_REVIEW');

    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { companyId } });
    expect(request.status).toBe('PENDING');
  });

  it('moderator_approves_company_and_it_gets_notification', async () => {
    const companyId = await withManualVerification(() => createCompany(2));
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { companyId } });
    const admin = await moderator();

    const result = await decideVerification(admin.id, request.id, true);

    expect(result).toEqual({ status: 'ok', verification: 'APPROVED' });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.verificationStatus).toBe('VERIFIED');

    // Критерий этапа 1: компания получает уведомление.
    const notification = await prisma.notification.findFirstOrThrow({ where: { companyId } });
    expect(notification.event).toBe('company_approved');
  });

  it('moderator_rejects_company_with_reason', async () => {
    const companyId = await withManualVerification(() => createCompany(3));
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { companyId } });
    const admin = await moderator();

    const result = await decideVerification(admin.id, request.id, false, 'нет документов');

    expect(result).toEqual({ status: 'ok', verification: 'REJECTED' });
    const saved = await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(saved.reason).toBe('нет документов');
    expect(saved.decidedById).toBe(admin.id);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.verificationStatus).toBe('NOT_VERIFIED');

    const notification = await prisma.notification.findFirstOrThrow({ where: { companyId } });
    expect(notification.event).toBe('company_rejected');
  });

  it('rejection_without_reason_is_refused', async () => {
    const companyId = await withManualVerification(() => createCompany(4));
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { companyId } });
    const admin = await moderator();

    expect(await decideVerification(admin.id, request.id, false, '   ')).toEqual({
      status: 'reason_required',
    });
  });

  it('decision_cannot_be_made_twice', async () => {
    const companyId = await withManualVerification(() => createCompany(5));
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { companyId } });
    const admin = await moderator();

    await decideVerification(admin.id, request.id, true);
    expect(await decideVerification(admin.id, request.id, false, 'передумали')).toEqual({
      status: 'already_decided',
    });
  });
});

describe('журнал аудита администраторов', () => {
  it('every_admin_decision_is_written_to_audit_log', async () => {
    const companyId = await withManualVerification(() => createCompany(6));
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { companyId } });
    const admin = await moderator();

    await writeAdminAudit(admin.id, 'admin_signed_in');
    await decideVerification(admin.id, request.id, false, 'нет лицензии');

    const log = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(log.map((entry) => entry.action)).toEqual(['admin_signed_in', 'company_rejected']);
    expect(log[1]!.reason).toBe('нет лицензии');
    expect(log[1]!.entityId).toBe(companyId);
  });

  it('impersonation_requires_reason_and_is_logged', async () => {
    const companyId = await withManualVerification(() => createCompany(7));
    const admin = await prisma.adminUser.findFirstOrThrow({ where: { role: 'SUPERADMIN' } });

    expect(await startImpersonation(admin.id, companyId, '  ')).toEqual({
      status: 'reason_required',
    });

    const started = await startImpersonation(admin.id, companyId, 'обращение в поддержку №12');
    expect(started.status).toBe('ok');
    if (started.status !== 'ok') return;

    const active = await prisma.impersonationLog.findUniqueOrThrow({
      where: { id: started.impersonationId },
    });
    expect(active.reason).toBe('обращение в поддержку №12');
    expect(active.endedAt).toBeNull();

    await stopImpersonation(admin.id, started.impersonationId);
    const finished = await prisma.impersonationLog.findUniqueOrThrow({
      where: { id: started.impersonationId },
    });
    expect(finished.endedAt).not.toBeNull();

    // Критерий этапа 1: вход от имени компании есть в журнале аудита.
    const log = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(log.map((entry) => entry.action)).toEqual([
      'impersonation_started',
      'impersonation_stopped',
    ]);
    expect(log[0]!.reason).toBe('обращение в поддержку №12');
  });

  it('impersonation_of_unknown_company_is_refused', async () => {
    const admin = await prisma.adminUser.findFirstOrThrow({ where: { role: 'SUPERADMIN' } });
    expect(await startImpersonation(admin.id, 'no-such-company', 'причина')).toEqual({
      status: 'not_found',
    });
  });
});
