import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import {
  checkPassword,
  hashPassword,
  isPasswordLoginEnabled,
  loginWithPassword,
  registerWithPassword,
} from '@/lib/auth/password';

const prisma = createTestPrisma();
const PHONE = '+77019990001';

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await resetTransactionalData(prisma);
  await prisma.$disconnect();
});

describe('временный вход по паролю', () => {
  it('password_hash_is_salted_and_checks', async () => {
    const first = await hashPassword('secret1');
    const second = await hashPassword('secret1');
    expect(first).not.toBe(second);
    expect(await checkPassword('secret1', first)).toBe(true);
    expect(await checkPassword('secret2', first)).toBe(false);
  });

  it('register_then_login_with_same_password', async () => {
    const registered = await registerWithPassword(PHONE, 'secret1');
    expect(registered.ok).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: PHONE } });
    expect(user.passwordHash).not.toContain('secret1');

    expect(await loginWithPassword(PHONE, 'secret1')).toEqual({ ok: true, userId: user.id });
    expect(await loginWithPassword(PHONE, 'wrong11')).toEqual({
      ok: false,
      reason: 'wrong_password',
    });
  });

  it('unknown_phone_looks_like_wrong_password', async () => {
    expect(await loginWithPassword(PHONE, 'secret1')).toEqual({
      ok: false,
      reason: 'wrong_password',
    });
  });

  it('short_password_and_taken_phone_are_rejected', async () => {
    expect(await registerWithPassword(PHONE, '123')).toEqual({
      ok: false,
      reason: 'weak_password',
    });
    await registerWithPassword(PHONE, 'secret1');
    expect(await registerWithPassword(PHONE, 'secret2')).toEqual({
      ok: false,
      reason: 'phone_taken',
    });
  });

  it('user_from_code_login_cannot_get_password_without_code', async () => {
    await prisma.user.create({ data: { phone: PHONE } });
    expect(await registerWithPassword(PHONE, 'secret1')).toEqual({
      ok: false,
      reason: 'phone_taken',
    });
    expect(await loginWithPassword(PHONE, 'secret1')).toEqual({
      ok: false,
      reason: 'password_not_set',
    });
  });

  it('blocked_user_cannot_login', async () => {
    await registerWithPassword(PHONE, 'secret1');
    await prisma.user.update({ where: { phone: PHONE }, data: { blockedAt: new Date() } });
    expect(await loginWithPassword(PHONE, 'secret1')).toEqual({
      ok: false,
      reason: 'user_blocked',
    });
  });

  it('flag_turns_password_login_off', async () => {
    expect(await isPasswordLoginEnabled()).toBe(true);
    await prisma.platformSetting.create({ data: { key: 'disable_password_login', value: 'true' } });
    expect(await isPasswordLoginEnabled()).toBe(false);
  });
});
