import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { deliverCode, isSmsLive, type PhoneProof } from '@/lib/sms/sms';
import { verifyFirebasePhone } from '@/lib/sms/firebase';
import { acceptPendingInvitations } from '@/lib/employees/invitations';

const CODE_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(randomInt(100000, 1000000));
}

export type IssueResult =
  /**
   * via: 'firebase' — код отправит браузер через Firebase, сервер его не знает;
   * via: 'mock' — код есть в ответе, его показывает интерфейс демо.
   */
  | { ok: true; via: 'firebase'; code: null; expiresAt: Date }
  | { ok: true; via: 'mock'; code: string; expiresAt: Date }
  | { ok: false; error: 'sms_failed' | 'too_many_requests' };

export async function issueLoginCode(phone: string): Promise<IssueResult> {
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  // С Firebase код генерирует и ограничивает по частоте сам Firebase: в базе его нет.
  if (isSmsLive()) return { ok: true, via: 'firebase', code: null, expiresAt };

  const code = generateCode();
  deliverCode(phone, code);
  await prisma.otpCode.create({ data: { phone, code, expiresAt } });
  return { ok: true, via: 'mock', code, expiresAt };
}

export type VerifyResult =
  { ok: true; userId: string } | { ok: false; reason: 'invalid' | 'expired' };

/** Проверка и гашение кода мока без входа. */
async function consumeMockCode(
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

/**
 * Подтверждение номера без входа: им же старший подтверждает возврат на кассе.
 * С Firebase нужен ID-токен на этот номер, голый код не принимается — иначе
 * код можно было бы подобрать, минуя Firebase.
 */
export async function consumeCode(
  phone: string,
  proof: PhoneProof,
): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'expired' }> {
  if (isSmsLive()) {
    if (!proof.idToken) return { ok: false, reason: 'invalid' };
    return (await verifyFirebasePhone(proof.idToken, phone))
      ? { ok: true }
      : { ok: false, reason: 'invalid' };
  }
  if (!proof.code) return { ok: false, reason: 'invalid' };
  return consumeMockCode(phone, proof.code.trim());
}

export async function verifyLoginCode(phone: string, proof: PhoneProof): Promise<VerifyResult> {
  const consumed = await consumeCode(phone, proof);
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
