import { expect, test, type Page } from '@playwright/test';

/**
 * БИН уникален в базе, а проекты phone-375 и desktop-1280 идут параллельно,
 * поэтому у каждого проекта свои компании из мок-реестра.
 */
const FIXTURES: Record<string, { store: Fixture; supplier: Fixture }> = {
  'phone-375': {
    store: { bin: '140240003217', name: 'Береке Маркет' },
    supplier: { bin: '120340001230', name: 'Алматы Азык' },
  },
  'desktop-1280': {
    store: { bin: '210540009877', name: 'Айгерим' },
    supplier: { bin: '150640004569', name: 'Дала Сут' },
  },
};

type Fixture = { bin: string; name: string };

function fixtures(projectName: string) {
  const found = FIXTURES[projectName];
  if (!found) throw new Error(`нет фикстур для проекта ${projectName}`);
  return found;
}

function phone(seed: number) {
  return `+7701${String(seed).padStart(7, '0')}`;
}

async function login(page: Page, locale: string, phoneNumber: string) {
  await page.goto(`/${locale}/login`);
  await page.getByTestId('phone-input').fill(phoneNumber);
  await page.getByTestId('request-code').click();

  const code = await page.getByTestId('demo-code').textContent();
  expect(code).toMatch(/^\d{6}$/);

  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();
  await page.waitForURL(/\/(onboarding|dashboard)$/);
}

test('store_registers_with_mock_sms_and_mock_bin_registry', async ({ page }, testInfo) => {
  const { store } = fixtures(testInfo.project.name);
  await login(page, 'ru', phone(1_000_000 + testInfo.project.name.length * 1000 + 1));

  await page.getByTestId('type-STORE').click();
  await page.getByTestId(`demo-bin-${store.bin}`).click();
  await page.getByTestId('bin-check').click();

  // Название и адрес подтянулись из мок-реестра.
  await expect(page.getByTestId('bin-found')).toContainText(store.name);

  await page.getByTestId('address-input').fill('ул. Демонстрационная, 10');
  await page.getByTestId('consent-checkbox').check();
  await page.getByTestId('submit-company').click();

  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByTestId('company-bin')).toHaveText(store.bin);
  await expect(page.getByTestId('company-type')).toHaveText('Магазин');
  await expect(page.getByTestId('company-status')).toHaveText('Проверена');
  await expect(page.getByTestId('company-locations')).toContainText('ул. Демонстрационная, 10');

  // Критерий 9: кабинет не уезжает за экран ни на телефоне, ни на компьютере.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('supplier_registers_and_picks_delivery_cities', async ({ page }, testInfo) => {
  const { supplier } = fixtures(testInfo.project.name);
  await login(page, 'ru', phone(2_000_000 + testInfo.project.name.length * 1000 + 2));

  await page.getByTestId('type-SUPPLIER').click();
  await page.getByTestId(`demo-bin-${supplier.bin}`).click();
  await page.getByTestId('bin-check').click();
  await expect(page.getByTestId('bin-found')).toContainText(supplier.name);

  await page.getByRole('checkbox', { name: 'Тараз' }).check();
  await page.getByTestId('consent-checkbox').check();
  await page.getByTestId('submit-company').click();

  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByTestId('company-type')).toHaveText('Поставщик');
  await expect(page.getByTestId('company-delivery-cities')).toContainText('Тараз');
});

test('bin_with_wrong_checksum_is_rejected', async ({ page }, testInfo) => {
  await login(page, 'ru', phone(3_000_000 + testInfo.project.name.length * 1000 + 3));

  await page.getByTestId('type-STORE').click();
  await page.getByTestId('bin-input').fill('140240003218');
  await page.getByTestId('bin-check').click();

  await expect(page.getByTestId('onboarding-error')).toHaveText(
    'БИН не прошёл проверку контрольной суммы',
  );
});

test('registration_without_consent_is_refused', async ({ page }, testInfo) => {
  await login(page, 'ru', phone(5_000_000 + testInfo.project.name.length * 1000 + 5));

  await page.getByTestId('type-STORE').click();
  await page.getByTestId('bin-input').fill('140240003217');
  await page.getByTestId('address-input').fill('ул. Демонстрационная, 1');
  // Галочку согласия намеренно не ставим.
  await page.getByTestId('submit-company').click();

  await expect(page.getByTestId('onboarding-error')).toHaveText(
    'Без согласия на обработку персональных данных регистрация невозможна',
  );
});

test('registration_screens_work_in_kazakh', async ({ page }, testInfo) => {
  await login(page, 'kk', phone(4_000_000 + testInfo.project.name.length * 1000 + 4));

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Компанияны тіркеу');
  await expect(page.getByTestId('type-SUPPLIER')).toHaveText('Мен жеткізушімін');
  await expect(page.getByTestId('bin-check')).toHaveText('Тексеру');
});
