import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll } from '../helpers/e2e-flow';
import { open } from '../helpers/open';

test.describe.configure({ mode: 'serial' });

/** Раздел 3.13 ТЗ: редактор печатных форм. Шаблоны глобальные — гоняем в одном проекте. */
const ONLY_PROJECT = 'desktop-1280';
const CONTENT_MANAGER_PHONE = '+77009000003';
const MODERATOR_PHONE = '+77009000002';

async function adminLogin(page: Page, phone: string) {
  await page.request.post('/api/admin/logout').catch(() => undefined);
  await open(page, '/ru/admin');
  await page.getByTestId('admin-phone').fill(phone);
  await page.getByTestId('admin-request-code').click();
  const code = await page.getByTestId('admin-demo-code').textContent();
  await page.getByTestId('admin-code').fill(code!);
  await page.getByTestId('admin-enter').click();
  await expect(page.getByTestId('admin-role')).toBeVisible();
}

test('content_manager_edits_invoice_template_with_pdf_preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'шаблоны общие для всей платформы');
  await adminLogin(page, CONTENT_MANAGER_PHONE);

  const editor = page.getByTestId('template-editor');
  await editor.getByTestId('template-type').selectOption('INVOICE');
  await editor.getByTestId('template-locale').selectOption('kk');
  await expect(editor.getByTestId('template-state')).toHaveText('Стандартный шаблон');
  await expect(editor.getByTestId('template-body')).toHaveValue(/Төлеуге арналған шот/);

  // Сломанный шаблон не сохраняется.
  await editor.getByTestId('template-body').fill('{{#lines}} без конца');
  await editor.getByTestId('template-save').click();
  await expect(editor.getByTestId('template-error')).toContainText('lines');

  await editor.getByTestId('template-insert-default').click();
  const body = await editor.getByTestId('template-body').inputValue();
  await editor.getByTestId('template-body').fill(body.replace('</h1>', ' (жаңа)</h1>'));
  await editor.getByTestId('template-preview').click();
  await expect(editor.getByTestId('template-preview-frame')).toBeVisible();

  await editor.getByTestId('template-save').click();
  await expect(editor.getByTestId('template-saved')).toHaveText('Сохранена версия 1');
  await expect(editor.getByTestId('template-state')).toHaveText('Действует версия 1');
  await expect(editor.getByTestId('template-history')).toContainText('v1');
  await expectNoHorizontalScroll(page);

  // Возвращаем стандартный шаблон, чтобы не влиять на другие прогоны.
  await editor.getByTestId('template-reset').click();
  await expect(editor.getByTestId('template-saved')).toHaveText('Действует стандартный шаблон');
});

test('moderator_cannot_edit_templates', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'шаблоны общие для всей платформы');
  await adminLogin(page, MODERATOR_PHONE);

  await expect(page.getByTestId('template-editor')).toHaveCount(0);
  const response = await page.request.post('/api/admin/templates', {
    data: { type: 'INVOICE', locale: 'ru', body: '<h1>взлом</h1>' },
  });
  expect(response.status()).toBe(403);
});
