import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { isSmsLive, sendCodeSms } from '@/lib/sms/sms';
import { acceptPendingInvitations } from '@/lib/employees/invitations';

const CODE_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
/** Настоящее SMS стоит денег: повторный код на тот же номер не чаще раза в минуту. */
const RESEND_SECONDS = 60;

function generateCode(): string {
  // Код уходит в настоящих SMS: генератор должен быть криптостойким, а не Math.random.
  return String(randomInt(100000, 1000000));
}

export type IssueResult =
  /** code есть только у мока SMS: тогда его показывает интерфейс демо. */
  | { ok: true; code: string | null; expiresAt: Date }
  | { ok: false; error: 'sms_failed' | 'too_many_requests' };

export async function issueLoginCode(
  phone: string,
  locale: 'ru' | 'kk' = 'ru',
): Promise<IssueResult> {
  if (isSmsLive()) {
    const recent = await prisma.otpCode.findFirst({
      where: { phone, createdAt: { gt: new Date(Date.now() - RESEND_SECONDS * 1000) } },
    });
    if (recent) return { ok: false, error: 'too_many_requests' };
  }

  const code = generateCode();
  const sent = await sendCodeSms(phone, code, locale);
  if (!sent.ok) return { ok: false, error: sent.error };

  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  await prisma.otpCode.create({ data: { phone, code, expiresAt } });
  return { ok: true, code: sent.showCodeInUi ? code : null, expiresAt };
}

export type VerifyResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'expired' };

/** Проверка и гашение кода без входа: им же старший подтверждает возврат на кассе. */
export async function consumeCode(
  phone: string,
  code: string,
): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'expired' }> {
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
  return { ok: true };
}

export async function verifyLoginCode(phone: string, code: string): Promise<VerifyResult> {
  const consumed = await consumeCode(phone, code);
  if (!consumed.ok) return consumed;

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  // Раздел 3.12 ТЗ: приглашённый входит по коду и сразу попадает в компанию.
  await acceptPendingInvitations(user.id, phone);

  return { ok: true, userId: user.id };
}
