import { expect, test } from '@playwright/test';
import { open } from '../helpers/open';

/** Временный вход по номеру и паролю: регистрация, выход и вход тем же паролем. */
const PHONES: Record<string, string> = {
  'phone-375': '+77049990001',
  'desktop-1280': '+77049990002',
};

test('register_and_login_with_password', async ({ page }, testInfo) => {
  const phone = PHONES[testInfo.project.name]!;
  await open(page, '/ru/login');
  await page.getByTestId('mode-password').click();
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('password-toggle').click();
  await page.getByTestId('password-input').fill('secret1');
  await page.getByTestId('password-confirm').fill('secret2');
  await page.getByTestId('password-submit').click();
  await expect(page.getByTestId('auth-error')).toHaveText('Пароли не совпадают');

  await page.getByTestId('password-confirm').fill('secret1');
  await page.getByTestId('password-submit').click();
  await page.waitForURL(/\/onboarding$/);

  await page.context().clearCookies();
  await open(page, '/ru/login');
  await page.getByTestId('mode-password').click();
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('password-input').fill('wrong11');
  await page.getByTestId('password-submit').click();
  await expect(page.getByTestId('auth-error')).toHaveText('Неверный номер или пароль');

  await page.getByTestId('password-input').fill('secret1');
  await page.getByTestId('password-submit').click();
  await page.waitForURL(/\/onboarding$/);
});
