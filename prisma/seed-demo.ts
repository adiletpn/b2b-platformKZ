/**
 * Демо-данные для показа: компании, каталоги и заявки в разных статусах.
 * Правило 12: все данные вымышленные. Справочники грузит отдельный сид (seed.ts).
 *
 * Запуск: npm run db:seed && npm run db:seed:demo
 */
import Decimal from 'decimal.js';
import { prisma } from '../src/lib/prisma';
import { registerCompany } from '../src/lib/registration/register-company';
import { recordSwipe } from '../src/lib/feed/swipe';
import { checkout } from '../src/lib/orders/checkout';
import { changeStatus, confirmOrder } from '../src/lib/orders/workflow';
import { createWaybillAndInvoice } from '../src/lib/documents/create';
import { acceptDelivery } from '../src/lib/acceptance/accept';
import { recordPayment } from '../src/lib/payments/record';
import { saveRequisites } from '../src/lib/payments/requisites';
import { inviteEmployee, acceptPendingInvitations } from '../src/lib/employees/invitations';
import { createCustomRole, updateEmployeeAccess } from '../src/lib/employees/roles';
import { decideDiscrepancyAct } from '../src/lib/documents/returns';
import { assignPlan } from '../src/lib/admin/tariffs';

type ProductSeed = {
  barcode: string;
  nameRu: string;
  nameKk: string;
  category: string;
  unit: string;
  priceWithoutVat: string;
  packSize: string;
  minBatch: string;
  stock: string;
};

/** Демо-изображения лежат рядом с приложением: внешних зависимостей у показа нет. */
const PHOTO_BY_CATEGORY: Record<string, string> = {
  grocery: '/products/grocery.svg',
  dairy: '/products/dairy.svg',
  drinks: '/products/drinks.svg',
};

const GROCERY: ProductSeed[] = [
  {
    barcode: '4870001000018',
    nameRu: 'Мука пшеничная, 2 кг',
    nameKk: 'Бидай ұны, 2 кг',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '620.00',
    packSize: '6',
    minBatch: '6',
    stock: '480',
  },
  {
    barcode: '4870001000025',
    nameRu: 'Сахар-песок, 1 кг',
    nameKk: 'Қант, 1 кг',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '450.00',
    packSize: '10',
    minBatch: '10',
    stock: '600',
  },
  {
    barcode: '4870001000032',
    nameRu: 'Рис круглозёрный, 900 г',
    nameKk: 'Дөңгелек күріш, 900 г',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '780.00',
    packSize: '8',
    minBatch: '8',
    stock: '320',
  },
  {
    barcode: '4870001000049',
    nameRu: 'Масло подсолнечное, 1 л',
    nameKk: 'Күнбағыс майы, 1 л',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '1120.00',
    packSize: '12',
    minBatch: '12',
    stock: '240',
  },
  {
    barcode: '4870001000056',
    nameRu: 'Соль поваренная, 1 кг',
    nameKk: 'Ас тұзы, 1 кг',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '130.00',
    packSize: '20',
    minBatch: '20',
    stock: '800',
  },
  {
    barcode: '4870001000063',
    nameRu: 'Макароны «Спагетти», 450 г',
    nameKk: 'Макарон «Спагетти», 450 г',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '390.00',
    packSize: '12',
    minBatch: '12',
    stock: '360',
  },
  {
    barcode: '4870001000070',
    nameRu: 'Чай чёрный, 100 пак.',
    nameKk: 'Қара шай, 100 пак.',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '1450.00',
    packSize: '6',
    minBatch: '6',
    stock: '180',
  },
  {
    barcode: '4870001000087',
    nameRu: 'Гречневая крупа, 800 г',
    nameKk: 'Қарақұмық жармасы, 800 г',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '690.00',
    packSize: '8',
    minBatch: '8',
    stock: '200',
  },
];

const DAIRY: ProductSeed[] = [
  {
    barcode: '4870002000017',
    nameRu: 'Молоко 2,5%, 1 л',
    nameKk: 'Сүт 2,5%, 1 л',
    category: 'dairy',
    unit: 'pcs',
    priceWithoutVat: '420.00',
    packSize: '12',
    minBatch: '12',
    stock: '480',
  },
  {
    barcode: '4870002000024',
    nameRu: 'Кефир 2,5%, 900 мл',
    nameKk: 'Кефир 2,5%, 900 мл',
    category: 'dairy',
    unit: 'pcs',
    priceWithoutVat: '450.00',
    packSize: '9',
    minBatch: '9',
    stock: '270',
  },
  {
    barcode: '4870002000031',
    nameRu: 'Сметана 20%, 400 г',
    nameKk: 'Қаймақ 20%, 400 г',
    category: 'dairy',
    unit: 'pcs',
    priceWithoutVat: '560.00',
    packSize: '10',
    minBatch: '10',
    stock: '200',
  },
  {
    barcode: '4870002000048',
    nameRu: 'Творог 5%, 200 г',
    nameKk: 'Сүзбе 5%, 200 г',
    category: 'dairy',
    unit: 'pcs',
    priceWithoutVat: '390.00',
    packSize: '12',
    minBatch: '12',
    stock: '240',
  },
  {
    barcode: '4870002000055',
    nameRu: 'Масло сливочное 72%, 180 г',
    nameKk: 'Сары май 72%, 180 г',
    category: 'dairy',
    unit: 'pcs',
    priceWithoutVat: '980.00',
    packSize: '10',
    minBatch: '10',
    stock: '150',
  },
  {
    barcode: '4870002000062',
    nameRu: 'Айран 1,5%, 500 мл',
    nameKk: 'Айран 1,5%, 500 мл',
    category: 'dairy',
    unit: 'pcs',
    priceWithoutVat: '280.00',
    packSize: '12',
    minBatch: '12',
    stock: '360',
  },
];

const DRINKS: ProductSeed[] = [
  {
    barcode: '4870003000016',
    nameRu: 'Вода питьевая, 5 л',
    nameKk: 'Ауыз су, 5 л',
    category: 'drinks',
    unit: 'pcs',
    priceWithoutVat: '340.00',
    packSize: '4',
    minBatch: '4',
    stock: '400',
  },
  {
    barcode: '4870003000023',
    nameRu: 'Сок яблочный, 1 л',
    nameKk: 'Алма шырыны, 1 л',
    category: 'drinks',
    unit: 'pcs',
    priceWithoutVat: '520.00',
    packSize: '12',
    minBatch: '12',
    stock: '288',
  },
  {
    barcode: '4870003000030',
    nameRu: 'Минеральная вода, 0,5 л',
    nameKk: 'Минералды су, 0,5 л',
    category: 'drinks',
    unit: 'pcs',
    priceWithoutVat: '180.00',
    packSize: '24',
    minBatch: '24',
    stock: '720',
  },
  {
    barcode: '4870003000047',
    nameRu: 'Компот из сухофруктов, 1 л',
    nameKk: 'Кепкен жеміс компоты, 1 л',
    category: 'drinks',
    unit: 'pcs',
    priceWithoutVat: '430.00',
    packSize: '12',
    minBatch: '12',
    stock: '180',
  },
  {
    barcode: '4870003000054',
    nameRu: 'Лимонад, 1,5 л',
    nameKk: 'Лимонад, 1,5 л',
    category: 'drinks',
    unit: 'pcs',
    priceWithoutVat: '390.00',
    packSize: '6',
    minBatch: '6',
    stock: '240',
  },
];

async function createCompany(options: {
  phone: string;
  bin: string;
  type: 'STORE' | 'SUPPLIER';
  cityCodes: string[];
  address?: string;
}) {
  const user = await prisma.user.upsert({
    where: { phone: options.phone },
    update: {},
    create: { phone: options.phone },
  });
  const cities = await prisma.city.findMany({ where: { code: { in: options.cityCodes } } });

  const result = await registerCompany({
    userId: user.id,
    bin: options.bin,
    type: options.type,
    location:
      options.type === 'STORE'
        ? { cityId: cities[0]!.id, address: options.address!, format: 'grocery' }
        : undefined,
    deliveryCityIds: options.type === 'SUPPLIER' ? cities.map((city) => city.id) : undefined,
    consentAccepted: true,
  });
  if (result.status !== 'created') {
    throw new Error(`компания ${options.bin}: ${result.status}`);
  }

  return { userId: user.id, companyId: result.companyId };
}

async function fillCatalog(supplierId: string, products: ProductSeed[]) {
  const vat = await prisma.vatRate.findFirstOrThrow({ where: { isDefault: true } });
  const rate = new Decimal(vat.rate.toString());

  for (const item of products) {
    const unit = await prisma.unit.findUniqueOrThrow({ where: { code: item.unit } });
    const category = await prisma.category.findUnique({ where: { code: item.category } });

    const product = await prisma.product.upsert({
      where: { barcode: item.barcode },
      update: {},
      create: {
        barcode: item.barcode,
        nameRu: item.nameRu,
        nameKk: item.nameKk,
        brand: 'Дала (тест)',
        manufacturer: 'ТОО «Дала Сут» (тест)',
        country: 'Казахстан',
        categoryId: category?.id ?? null,
        unitId: unit.id,
        photoUrls: PHOTO_BY_CATEGORY[item.category] ? [PHOTO_BY_CATEGORY[item.category]!] : [],
      },
    });

    const priceWithoutVat = new Decimal(item.priceWithoutVat);
    await prisma.supplierOffer.upsert({
      where: { supplierId_productId: { supplierId, productId: product.id } },
      update: {},
      create: {
        supplierId,
        productId: product.id,
        sku: item.barcode.slice(-6),
        priceWithoutVat: priceWithoutVat.toFixed(2),
        priceWithVat: priceWithoutVat
          .times(rate.div(100).plus(1))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toFixed(2),
        vatRateId: vat.id,
        packSize: item.packSize,
        minBatch: item.minBatch,
        stock: item.stock,
      },
    });
  }
}

/** Заявка от магазина к поставщику: позиции берутся первыми из каталога. */
async function makeOrder(
  store: { companyId: string; userId: string; locationId: string; cityId: string },
  supplierId: string,
  itemCount: number,
) {
  const offers = await prisma.supplierOffer.findMany({
    where: { supplierId },
    take: itemCount,
    orderBy: { id: 'asc' },
  });
  for (const offer of offers) {
    await recordSwipe(store.companyId, store.locationId, offer.id, 'LIKE');
  }

  const result = await checkout({
    storeId: store.companyId,
    locationId: store.locationId,
    cityId: store.cityId,
    userId: store.userId,
  });
  if (result.status !== 'created') throw new Error(`заявка: ${result.status}`);
  return result.orders[0]!.id;
}

/** Сотрудник магазина с ролью менеджера по закупкам и лимитом заявки. */
async function addPurchasingManager(companyId: string, ownerId: string, phone: string) {
  const invited = await inviteEmployee(companyId, ownerId, phone, 'PURCHASING_MANAGER');
  if (invited.status !== 'ok') throw new Error(`приглашение: ${invited.status}`);

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });
  await acceptPendingInvitations(user.id, phone);
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { userId_companyId: { userId: user.id, companyId } },
  });
  return { userId: user.id, membershipId: membership.id };
}

async function main() {
  // `truncate ... cascade` вычищает и справочники: без ролей матрица прав пуста и всё отдаёт 403.
  const roles = await prisma.role.count();
  if (roles === 0) {
    throw new Error('Справочники не загружены. Сначала выполните npm run db:seed');
  }

  const existing = await prisma.company.count();
  if (existing > 0) {
    console.log(`Демо-данные уже есть: компаний ${existing}. Пропускаю.`);
    return;
  }

  // Поставщики.
  const grocery = await createCompany({
    phone: '+77010000001',
    bin: '120340001230',
    type: 'SUPPLIER',
    cityCodes: ['taraz', 'almaty'],
  });
  const dairy = await createCompany({
    phone: '+77010000002',
    bin: '150640004569',
    type: 'SUPPLIER',
    cityCodes: ['taraz'],
  });
  const drinks = await createCompany({
    phone: '+77010000003',
    bin: '200140003574',
    type: 'SUPPLIER',
    cityCodes: ['taraz', 'almaty'],
  });

  for (const supplier of [grocery, dairy, drinks]) {
    await saveRequisites(supplier.companyId, {
      iik: 'KZ07HSBK123456789012',
      bik: 'HSBKKZKX',
      bankName: 'Тестовый банк (демо)',
    });
  }

  await fillCatalog(grocery.companyId, GROCERY);
  await fillCatalog(dairy.companyId, DAIRY);
  await fillCatalog(drinks.companyId, DRINKS);

  // Минимальные суммы заказа, чтобы на показе было видно «не хватает до минимума».
  await prisma.deliveryZone.updateMany({
    where: { supplierId: grocery.companyId },
    data: { minOrderAmount: '20000.00', leadTimeDays: 1 },
  });
  await prisma.deliveryZone.updateMany({
    where: { supplierId: dairy.companyId },
    data: { minOrderAmount: '15000.00', leadTimeDays: 1 },
  });
  await prisma.deliveryZone.updateMany({
    where: { supplierId: drinks.companyId },
    data: { minOrderAmount: '10000.00', leadTimeDays: 2 },
  });

  // Склады поставщиков: по ним строится карта поставщиков города (раздел 3.9 ТЗ).
  const tarazCity = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const almatyCity = await prisma.city.findUniqueOrThrow({ where: { code: 'almaty' } });
  await prisma.location.createMany({
    data: [
      {
        companyId: dairy.companyId,
        cityId: tarazCity.id,
        type: 'WAREHOUSE',
        address: 'ул. Складская, 7',
      },
      {
        companyId: drinks.companyId,
        cityId: tarazCity.id,
        type: 'WAREHOUSE',
        address: 'ул. Промышленная, 21',
      },
      {
        companyId: grocery.companyId,
        cityId: almatyCity.id,
        type: 'WAREHOUSE',
        address: 'ул. Рыскулова, 14',
      },
    ],
  });

  // Поставщик соседнего города: в Тараз доставку не указывал — его находят с пометкой.
  const neighbour = await createCompany({
    phone: '+77010000004',
    bin: '220640004683',
    type: 'SUPPLIER',
    cityCodes: ['shu'],
  });
  await fillCatalog(neighbour.companyId, GROCERY.slice(0, 3));

  // Магазины.
  const storeCompany = await createCompany({
    phone: '+77020000001',
    bin: '140240003217',
    type: 'STORE',
    cityCodes: ['taraz'],
    address: 'ул. Толе би, 45',
  });
  await createCompany({
    phone: '+77020000002',
    bin: '170840006546',
    type: 'STORE',
    cityCodes: ['almaty'],
    address: 'пр. Абая, 120',
  });

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: storeCompany.companyId },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const store = { ...storeCompany, locationId: location.id, cityId: taraz.id };

  // Заявка 1: только отправлена — её поставщик примет прямо на показе.
  await makeOrder(store, grocery.companyId, 4);

  // Заявка 2: доведена до «Доставлена» с накладной — на показе делаем приёмку.
  const delivered = await makeOrder(store, dairy.companyId, 3);
  const deliveredOrder = await prisma.order.findUniqueOrThrow({
    where: { id: delivered },
    include: { items: true },
  });
  await confirmOrder(
    delivered,
    dairy.companyId,
    dairy.userId,
    deliveredOrder.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );
  await createWaybillAndInvoice(delivered, dairy.companyId);
  for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
    await changeStatus(delivered, dairy.companyId, dairy.userId, status);
  }

  // Заявка 3: закрытый цикл с расхождением и оплатой — показываем документы и историю.
  const closed = await makeOrder(store, drinks.companyId, 3);
  const closedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: closed },
    include: { items: true },
  });
  await confirmOrder(
    closed,
    drinks.companyId,
    drinks.userId,
    closedOrder.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );
  await createWaybillAndInvoice(closed, drinks.companyId);
  for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
    await changeStatus(closed, drinks.companyId, drinks.userId, status);
  }
  await acceptDelivery(
    closed,
    store.companyId,
    store.userId,
    closedOrder.items.map((item, index) => {
      const ordered = new Decimal(item.quantityOrdered.toString());
      // В первой позиции — брак на одну единицу, чтобы был акт расхождений.
      const accepted = index === 0 ? ordered.minus(1) : ordered;
      return {
        orderItemId: item.id,
        quantityAccepted: accepted.toFixed(3),
        quantityDefective: index === 0 ? '1.000' : '0.000',
      };
    }),
  );
  await changeStatus(closed, store.companyId, store.userId, 'AWAITING_PAYMENT');
  const toPay = await prisma.order.findUniqueOrThrow({ where: { id: closed } });
  await recordPayment({
    orderId: closed,
    storeId: store.companyId,
    userId: store.userId,
    amount: toPay.totalWithVat.toFixed(2),
    method: 'ON_DELIVERY',
    paidAt: new Date().toISOString().slice(0, 10),
    reference: 'ПП-1041',
  });
  await changeStatus(closed, store.companyId, store.userId, 'CLOSED');

  // Сотрудник с лимитом: его заявка выше лимита встаёт на согласование Владельцу.
  const manager = await addPurchasingManager(store.companyId, store.userId, '+77020000011');
  await updateEmployeeAccess(store.companyId, store.userId, manager.membershipId, {
    allowedLocationIds: [store.locationId],
    orderLimit: '5000.00',
    maxDiscount: '10.00',
  });
  await createCustomRole(store.companyId, store.userId, {
    nameRu: 'Старший кассир',
    nameKk: 'Аға кассир',
    permissions: [
      { section: 'POS', action: 'VIEW' },
      { section: 'POS', action: 'CREATE' },
      { section: 'STOCK', action: 'VIEW' },
    ],
  });

  const awaitingApproval = await makeOrder(
    { ...store, userId: manager.userId },
    grocery.companyId,
    4,
  );
  console.log(`Заявка на согласовании: ${awaitingApproval.slice(0, 8)}…`);

  // Избранное: свайп вверх по первой карточке молочного поставщика.
  const favorite = await prisma.supplierOffer.findFirstOrThrow({
    where: { supplierId: dairy.companyId },
    orderBy: { id: 'asc' },
  });
  await prisma.swipeAction.create({
    data: { storeId: store.companyId, offerId: favorite.id, action: 'FAV' },
  });

  // Спор по акту расхождений на отдельной заявке: его разбирает администратор.
  // Позиций хватает на минимальную сумму заказа этого поставщика.
  const disputed = await makeOrder(store, drinks.companyId, 4);
  const disputedOrder = await prisma.order.findUniqueOrThrow({
    where: { id: disputed },
    include: { items: true },
  });
  await confirmOrder(
    disputed,
    drinks.companyId,
    drinks.userId,
    disputedOrder.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );
  await createWaybillAndInvoice(disputed, drinks.companyId);
  for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
    await changeStatus(disputed, drinks.companyId, drinks.userId, status);
  }
  await acceptDelivery(
    disputed,
    store.companyId,
    store.userId,
    disputedOrder.items.map((item, index) => {
      const ordered = new Decimal(item.quantityOrdered.toString());
      return {
        orderItemId: item.id,
        quantityAccepted: index === 0 ? ordered.minus(2).toFixed(3) : ordered.toFixed(3),
        quantityDefective: index === 0 ? '2.000' : '0.000',
      };
    }),
  );
  const act = await prisma.document.findFirstOrThrow({
    where: { orderId: disputed, type: 'DISCREPANCY_ACT' },
  });
  await decideDiscrepancyAct(
    act.id,
    drinks.companyId,
    drinks.userId,
    false,
    'брак получен по вине перевозчика',
  );

  // Подписки: пробный период у магазина, оплаченный тариф у поставщика.
  const admin = await prisma.adminUser.findFirstOrThrow({ where: { role: 'SUPERADMIN' } });
  await assignPlan(admin.id, store.companyId, 'START', 0);
  await assignPlan(admin.id, grocery.companyId, 'BUSINESS', 3);

  // Каналы уведомлений: у молочного поставщика только мессенджеры.
  await prisma.company.update({
    where: { id: dairy.companyId },
    data: { notificationChannels: ['whatsapp', 'telegram'] },
  });

  const [companies, offers, orders] = await Promise.all([
    prisma.company.count(),
    prisma.supplierOffer.count(),
    prisma.order.count(),
  ]);
  console.log(
    `Демо-данные готовы: компаний ${companies}, предложений ${offers}, заявок ${orders}.`,
  );
  console.log('Вход: +7 701 000 00 01 (поставщик бакалеи), +7 702 000 00 01 (магазин в Таразе).');
  console.log('Сотрудник с лимитом заявки: +7 702 000 00 11 (менеджер по закупкам).');
  console.log('Админка: /ru/admin, +7 700 900 00 01 (суперадмин) — там спор и подписки.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
