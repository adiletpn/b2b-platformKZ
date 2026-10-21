import type { Page } from '@playwright/test';

/**
 * Прямой переход и ожидание гидратации: иначе ввод до React теряется. Экран внутри
 * `Page` оживает позже оболочки (граница loading.tsx), поэтому ждём и его метку.
 */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => {
    const marks = document.documentElement.dataset;
    const screen = document.querySelector('main[data-page]');
    return screen ? marks.pageHydrated !== undefined : marks.hydrated !== undefined;
  });
}
