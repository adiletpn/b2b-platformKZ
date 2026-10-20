import { expect, test } from '@playwright/test';

test('cabinet_renders_without_horizontal_scroll', async ({ page }) => {
  await page.goto('/ru');
  await expect(page.getByTestId('landing-hero')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('language_switches_between_ru_and_kk', async ({ page }) => {
  await page.goto('/ru');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'От заказа до кассы — без двойного ввода и пяти программ',
  );

  await page.getByTestId('locale-kk').click();
  await expect(page).toHaveURL(/\/kk$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Тапсырыстан кассаға дейін — қайта енгізусіз және бес бағдарламасыз',
  );

  await page.getByTestId('locale-ru').click();
  await expect(page).toHaveURL(/\/ru$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'От заказа до кассы — без двойного ввода и пяти программ',
  );
});

test('root_redirects_to_default_locale', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ru$/);
});
