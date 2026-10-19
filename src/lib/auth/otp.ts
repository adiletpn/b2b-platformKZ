import { prisma } from '@/lib/prisma';
import { sendLoginCode } from '@/mocks/sms';
import { acceptPendingInvitations } from '@/lib/employees/invitations';

const CODE_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Код показывается в интерфейсе демо — реальной отправки SMS нет. */
export async function issueLoginCode(phone: string) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  await prisma.otpCode.create({ data: { phone, code, expiresAt } });
  sendLoginCode(phone, code);
  return { code, expiresAt };
}

export type VerifyResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'expired' };

export async function verifyLoginCode(phone: string, code: string): Promise<VerifyResult> {
  const otp = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp || otp.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'invalid' };
  if (otp.expiresAt < new Date()) return { ok: false, reason: 'expired' };

  if (otp.code !== code) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: otp.attempts + 1 } });
    return { ok: false, reason: 'invalid' };
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  // Раздел 3.12 ТЗ: приглашённый входит по коду и сразу попадает в компанию.
  await acceptPendingInvitations(user.id, phone);

  return { ok: true, userId: user.id };
}
