import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/admin/settings';

/**
 * Временный вход по номеру и паролю (просьба заказчика 21.10.2026), пока SMS не подключены.
 * Основной вход — по коду. Пароль ставится только при регистрации нового номера: чужому номеру,
 * который уже входил по коду, пароль без кода не назначить.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>;

export const MIN_PASSWORD_LENGTH = 6;
const KEY_LENGTH = 64;

export async function isPasswordLoginEnabled(): Promise<boolean> {
  return (await getSetting('disable_password_login', 'false')) !== 'true';
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export type PasswordResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason:
        'wrong_password' | 'password_not_set' | 'phone_taken' | 'weak_password' | 'user_blocked';
    };

export async function loginWithPassword(phone: string, password: string): Promise<PasswordResult> {
  const user = await prisma.user.findUnique({ where: { phone } });
  // Неизвестный номер и неверный пароль неразличимы: перебором номера не проверить.
  if (!user) return { ok: false, reason: 'wrong_password' };
  if (!user.passwordHash) return { ok: false, reason: 'password_not_set' };
  if (!(await checkPassword(password, user.passwordHash))) {
    return { ok: false, reason: 'wrong_password' };
  }
  if (user.blockedAt) return { ok: false, reason: 'user_blocked' };
  return { ok: true, userId: user.id };
}

export async function registerWithPassword(
  phone: string,
  password: string,
): Promise<PasswordResult> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'weak_password' };
  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (existing) return { ok: false, reason: 'phone_taken' };
  const user = await prisma.user.create({
    data: { phone, passwordHash: await hashPassword(password) },
  });
  return { ok: true, userId: user.id };
}
