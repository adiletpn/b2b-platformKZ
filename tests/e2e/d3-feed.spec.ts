import { expect, test, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';

/** Магазин и поставщики создаются один раз на файл: БИН в базе уникален. */
test.describe.configure({ mode: 'serial' });

/** Из тестового пула реестра: именованные компании заняты показом и другими спеками. */
const FIXTURES: Record<string, { store: string; suppliers: string[]; otherCity: string }> = {
  'phone-375': {
    store: testPoolBin(0),
    suppliers: [testPoolBin(1), testPoolBin(2)],
    otherCity: testPoolBin(6),
  },
  'desktop-1280': {
    store: testPoolBin(3),
    suppliers: [testPoolBin(4), testPoolBin(5)],
    otherCity: testPoolBin(7),
  },
};

let page: Page;
let seed: number;
/** Названия товаров уникальны на проект: база общая для всех спек. */
let tarazProduct: string;
/** Товар второго поставщика: корзина должна делиться на две заявки. */
let tarazProductSecond: string;
let astanaProduct: string;

async function login(target: Page, phone: string) {
  await target.goto('/ru/login');
  await target.getByTestId('phone-input').fill(phone);
  await target.getByTestId('request-code').click();
  const code = await target.getByTestId('demo-code').textContent();
  await target.getByTestId('code-input').fill(code!);
  await target.getByTestId('verify-code').click();
  await target.waitForURL(/\/(onboarding|dashboard)$/);
}

/** Поставщик с каталогом, возит в Тараз. */
async function createSupplier(
  browserPage: Page,
  phone: string,
  bin: string,
  firstIndex: number,
  city = 'Тараз',
) {
  await login(browserPage, phone);
  await browserPage.getByTestId('type-SUPPLIER').click();
  await browserPage.getByTestId('bin-input').fill(bin);
  await browserPage.getByRole('checkbox', { name: city, exact: true }).check();
  await browserPage.getByTestId('consent-checkbox').check();
  await browserPage.getByTestId('submit-company').click();
  await browserPage.waitForURL(/\/dashboard$/);

  await browserPage.getByTestId('go-catalog').click();
  await browserPage.waitForURL(/\/catalog$/);
  await browserPage.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(firstIndex, { priceWithoutVat: '100.00', packSize: 1, minBatch: 1 }),
      validRow(firstIndex + 1, { priceWithoutVat: '200.00', packSize: 1, minBatch: 1 }),
      validRow(firstIndex + 2, { priceWithoutVat: '300.00', packSize: 1, minBatch: 1 }),
    ]),
  });
  await browserPage.getByTestId('upload-catalog').click();
  await expect(browserPage.getByTestId('import-created')).toHaveText('Добавлено товаров: 3');
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Подготовка тяжёлая: регистрации, каталоги и заявки.
  test.setTimeout(180_000);
  const fixtures = FIXTURES[testInfo.project.name]!;
  seed = testInfo.project.name.length * 1000;

  for (const [index, bin] of fixtures.suppliers.entries()) {
    const context = await browser.newContext();
    const supplierPage = await context.newPage();
    await createSupplier(
      supplierPage,
      `+7703${String(seed + index).padStart(7, '0')}`,
      bin,
      7000 + index * 100 + seed,
    );
    await context.close();
  }
  tarazProduct = `Тестовый товар ${7000 + seed}`;
  tarazProductSecond = `Тестовый товар ${7100 + seed}`;

  // Поставщик, который возит только в Астану: его товар не должен попасть в ленту Тараза.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await createSupplier(
    otherPage,
    `+7703${String(seed + 50).padStart(7, '0')}`,
    fixtures.otherCity,
    9000 + seed,
    'Астана',
  );
  await otherContext.close();
  astanaProduct = `Тестовый товар ${9000 + seed}`;

  page = await browser.newPage();
  await login(page, `+7704${String(seed).padStart(7, '0')}`);
  await page.getByTestId('type-STORE').click();
  await page.getByTestId('bin-input').fill(fixtures.store);
  await page.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await page.getByTestId('address-input').fill('ул. Демонстрационная, 5');
  await page.getByTestId('consent-checkbox').check();
  await page.getByTestId('submit-company').click();
  await page.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await page.close();
});

test('store_feed_shows_only_suppliers_delivering_to_its_city', async () => {
  await page.getByTestId('go-feed').click();
  await page.waitForURL(/\/feed$/);

  await expect(page.getByTestId('feed-city')).toHaveText('Тараз');
  await page.getByTestId('mode-list').click();

  await page.getByTestId('feed-search').fill(tarazProduct);
  await expect(page.getByTestId('list-table').getByRole('row')).toHaveCount(1);

  // Поставщик возит только в Астану — в ленте таразского магазина его нет.
  await page.getByTestId('feed-search').fill(astanaProduct);
  await expect(page.getByTestId('list-empty')).toBeVisible();

  await page.getByTestId('filter-reset').click();
});

test('swipe_card_shows_photo_and_supplier_rating', async () => {
  await page.getByTestId('mode-swipe').click();
  await expect(page.getByTestId('swipe-card')).toBeVisible();

  // Фото нет — показывается плитка-заглушка вместо пустого места.
  await expect(
    page.getByTestId('product-photo').or(page.getByTestId('product-photo-placeholder')).first(),
  ).toBeVisible();

  // Оценок у поставщика пока нет.
  await expect(page.getByTestId('swipe-supplier-few-ratings')).toBeVisible();
});

test('store_picks_products_by_swiping_on_phone', async () => {
  await page.getByTestId('mode-swipe').click();

  const card = page.getByTestId('swipe-card');
  await expect(card).toBeVisible();
  // Сверяем по предложению, а не по названию: один товар бывает у нескольких поставщиков.
  const firstOffer = await card.getAttribute('data-offer-id');

  // Свайп вправо жестом, а не кнопкой.
  // Жест мышью идёт в координатах экрана: карточка должна быть в видимой области.
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByTestId('feed-notice')).toHaveText('Добавлено в корзину');
  await expect(card).not.toHaveAttribute('data-offer-id', firstOffer!);
});

test('swipe_left_skips_card_and_undo_returns_it', async () => {
  const card = page.getByTestId('swipe-card');
  const skipped = await card.getAttribute('data-offer-id');

  await page.getByTestId('swipe-skip').click();
  await expect(card).not.toHaveAttribute('data-offer-id', skipped!);

  await page.getByTestId('swipe-undo').first().click();
  await expect(page.getByTestId('feed-notice')).toHaveText('Карточка возвращена');
  await expect(card).toHaveAttribute('data-offer-id', skipped!);
});

test('store_sets_quantity_in_list_mode', async () => {
  await page.getByTestId('mode-list').click();

  // Берём по позиции у каждого поставщика: корзина делится на две заявки
  // независимо от того, чью карточку выдал свайп. У чужих фикстур кратность 12.
  for (const product of [tarazProduct, tarazProductSecond]) {
    await page.getByTestId('feed-search').fill(product);
    // Строку ищем по названию: счётчик строк совпадает и до перезагрузки списка.
    const row = page.getByTestId('list-table').getByRole('row').filter({ hasText: product });
    await expect(row).toHaveCount(1);

    const input = row.getByRole('textbox');
    await input.fill('5');
    await input.blur();
    await expect(input).toHaveValue('5.000');
  }

  await page.getByTestId('filter-reset').click();
});

test('cart_is_split_by_supplier_with_totals_and_minimum', async () => {
  await page.getByTestId('go-cart').click();
  await page.waitForURL(/\/cart$/);

  // Свайп мог взять карточку любого поставщика города, поэтому сверяем деление
  // корзины, а не точное число: ровно три заявки проверяет критерий 4 в d7.
  const counter = await page.getByTestId('cart-suppliers-count').textContent();
  const suppliers = Number(counter!.match(/\d+/)![0]);
  expect(suppliers).toBeGreaterThanOrEqual(2);

  const totals = page.locator('[data-testid^="cart-total-"]');
  await expect(totals).toHaveCount(suppliers);
  for (const total of await totals.all()) {
    await expect(total).toContainText('₸');
  }
});

test('repeat_last_order_reports_no_history_before_first_order', async () => {
  await page.goto('/ru/feed');
  await page.getByTestId('repeat-last-order').click();
  await expect(page.getByTestId('feed-notice')).toHaveText('Прошлых заказов пока нет');
});

test('swipe_up_sends_card_to_favorites', async () => {
  await page.goto('/ru/feed');
  await page.getByTestId('mode-swipe').click();
  const card = page.getByTestId('swipe-card');
  await expect(card).toBeVisible();
  const favorite = await card.getAttribute('data-offer-id');

  // Свайп вверх жестом: карточка уходит в избранное, а не в корзину.
  // Жест мышью идёт в координатах экрана: карточка должна быть в видимой области.
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 220, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId('feed-notice')).toHaveText('Добавлено в избранное');

  // Фильтр «только избранное» показывает именно её.
  await page.getByTestId('mode-list').click();
  await page.getByTestId('filter-onlyFavorites').check();
  const rows = page.getByTestId('list-table').getByRole('row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-testid', `list-row-${favorite}`);
  await page.getByTestId('filter-reset').click();
});

test('tap_on_card_opens_details_with_price_comparison', async () => {
  await page.goto('/ru/feed');
  await page.getByTestId('mode-swipe').click();
  await expect(page.getByTestId('swipe-card')).toBeVisible();

  await page.getByTestId('swipe-details').click();
  await expect(page.getByTestId('offer-details')).toBeVisible();
  // Сравнение цен: в таблице минимум одно предложение города.
  await expect(page.getByTestId('details-offers').getByRole('row')).not.toHaveCount(0);
  await page.getByTestId('details-close').click();
  await expect(page.getByTestId('offer-details')).toBeHidden();
});
