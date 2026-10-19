import { expect, test, type Page } from '@playwright/test';

/** Проверка на уровне API, от вьюпорта не зависит — гоняем в одном проекте. */
const ONLY_PROJECT = 'desktop-1280';

const FIRST = { bin: '191140007892', phone: '+77015000001' };
const SECOND = { bin: '170840006546', phone: '+77015000002' };

async function registerStore(page: Page, bin: string, phone: string) {
  await page.goto('/ru/login');
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('request-code').click();
  const code = await page.getByTestId('demo-code').textContent();
  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();

  await page.waitForURL(/\/onboarding$/);
  await page.getByTestId('type-STORE').click();
  await page.getByTestId(`demo-bin-${bin}`).click();
  await page.getByTestId('address-input').fill('ул. Демонстрационная, 7');
  await page.getByTestId('consent-checkbox').check();
  await page.getByTestId('submit-company').click();
  await page.waitForURL(/\/dashboard$/);

  const companyId = await page.getByTestId('company-card').getAttribute('data-company-id');
  expect(companyId).toBeTruthy();
  return companyId!;
}

test('company_data_is_not_returned_to_user_of_another_company', async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== ONLY_PROJECT,
    'проверка уровня API, достаточно одного прогона',
  );

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const companyA = await registerStore(pageA, FIRST.bin, FIRST.phone);
  const companyB = await registerStore(pageB, SECOND.bin, SECOND.phone);
  expect(companyA).not.toBe(companyB);

  // Свою компанию владелец видит.
  const own = await pageA.request.get(`/api/companies/${companyA}`);
  expect(own.status()).toBe(200);

  // Чужую — нет, и её существование не раскрывается: 404, а не 403.
  const foreign = await pageA.request.get(`/api/companies/${companyB}`);
  expect(foreign.status()).toBe(404);
  expect(await foreign.text()).not.toContain(SECOND.bin);

  const foreignBack = await pageB.request.get(`/api/companies/${companyA}`);
  expect(foreignBack.status()).toBe(404);

  await contextA.close();
  await contextB.close();
});

test('company_data_requires_authentication', async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== ONLY_PROJECT,
    'проверка уровня API, достаточно одного прогона',
  );

  // Без сессии маршрут отвечает 401 ещё до обращения к базе.
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get('/api/companies/any-company-id');
  expect(response.status()).toBe(401);

  await anonymous.close();
});

test('new_routes_are_closed_without_session', async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== ONLY_PROJECT,
    'проверка уровня API, достаточно одного прогона',
  );

  const anonymous = await browser.newContext();

  // Правило 4: без сессии данные компании не отдаются ни одним из новых маршрутов.
  const gets = [
    '/api/employees/roles',
    '/api/orders/approvals',
    '/api/feed/geography',
    '/api/feed/any-offer-id',
    '/api/catalog/barcode?code=4870001000018',
  ];
  for (const path of gets) {
    const response = await anonymous.request.get(path);
    expect(response.status(), path).toBe(401);
  }

  const posts: [string, unknown][] = [
    ['/api/employees/roles', { nameRu: 'Роль', nameKk: 'Рөл', permissions: [] }],
    ['/api/catalog/offer', { barcode: '4870001000018' }],
    ['/api/orders/any-order-id/approval', { approved: true }],
    ['/api/company/owner', { membershipId: 'any' }],
    ['/api/company/switch', { companyId: 'any' }],
  ];
  for (const [path, body] of posts) {
    const response = await anonymous.request.post(path, { data: body });
    expect(response.status(), path).toBe(401);
  }

  const puts: [string, unknown][] = [
    ['/api/employees/any-membership-id/access', { orderLimit: '100' }],
    ['/api/notifications/channels', { channels: ['email'] }],
  ];
  for (const [path, body] of puts) {
    const response = await anonymous.request.put(path, { data: body });
    expect(response.status(), path).toBe(401);
  }

  await anonymous.close();
});

test('admin_routes_are_closed_without_admin_session', async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== ONLY_PROJECT,
    'проверка уровня API, достаточно одного прогона',
  );

  const anonymous = await browser.newContext();

  // Админка живёт на отдельной сессии: кабинет компании к ней доступа не даёт.
  for (const path of ['/api/admin/disputes', '/api/admin/tariffs', '/api/admin/subscriptions']) {
    expect((await anonymous.request.get(path)).status(), path).toBe(401);
  }
  expect((await anonymous.request.post('/api/admin/tariffs', { data: {} })).status()).toBe(401);
  expect((await anonymous.request.post('/api/admin/reference', { data: {} })).status()).toBe(401);

  await anonymous.close();
});
