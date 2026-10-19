import { expect, test } from '@playwright/test';

/** Макеты без данных: проверяем вёрстку и оба языка на обоих вьюпортах. */
const SECTIONS = [{ path: '/chat', ru: 'Чат с контрагентом', kk: 'Контрагентпен чат' }] as const;

for (const section of SECTIONS) {
  test(`mockup${section.path.replace('/', '_')}_renders_in_both_languages`, async ({ page }) => {
    await page.goto(`/ru${section.path}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(section.ru);
    await expect(page.getByTestId('mockup-notice')).toContainText('Макет без логики');

    await page.goto(`/kk${section.path}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(section.kk);
    await expect(page.getByTestId('mockup-notice')).toContainText('Логикасыз макет');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
