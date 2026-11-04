import { expect, test } from '@playwright/test';
import { login } from '../helpers/e2e-flow';

/** Экраны, которые макет показывает только на широком мониторе или только на телефоне. */
const ONLY_PROJECT = 'desktop-1280';

test('registration_shows_company_type_cards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'разметка, один прогон');
  await login(page, '+77079990002');
  await page.goto('/ru/onboarding');
  const card = page.getByTestId('type-SUPPLIER');
  await expect(card).toContainText('Продаю товары магазинам');
  await card.click();
  await expect(card).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('type-STORE')).toHaveAttribute('aria-checked', 'false');
});

test('admin_has_sidebar_and_no_second_logo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'разметка, один прогон');
  await page.goto('/ru/admin');
  await page.getByTestId('admin-phone').fill('+77009000001');
  await page.getByTestId('admin-request-code').click();
  const code = await page.getByTestId('admin-demo-code').textContent();
  await page.getByTestId('admin-code').fill(code!);
  await page.getByTestId('admin-enter').click();
  await expect(page.getByTestId('admin-sidebar')).toBeVisible();
  await expect(page.getByTestId('admin-role')).toHaveText('Суперадмин');
  // Логотип один — в боковом меню: шапка гостя в админке скрыта.
  await expect(page.locator('[data-guest-header]')).toBeHidden();
});
