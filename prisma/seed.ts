import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL не задан');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const regions = [
  {
    code: 'abai',
    nameRu: 'Абайская область',
    nameKk: 'Абай облысы',
    center: { code: 'semey', nameRu: 'Семей', nameKk: 'Семей' },
  },
  {
    code: 'akmola',
    nameRu: 'Акмолинская область',
    nameKk: 'Ақмола облысы',
    center: { code: 'kokshetau', nameRu: 'Кокшетау', nameKk: 'Көкшетау' },
  },
  {
    code: 'aktobe',
    nameRu: 'Актюбинская область',
    nameKk: 'Ақтөбе облысы',
    center: { code: 'aktobe', nameRu: 'Актобе', nameKk: 'Ақтөбе' },
  },
  {
    code: 'almaty-region',
    nameRu: 'Алматинская область',
    nameKk: 'Алматы облысы',
    center: { code: 'konaev', nameRu: 'Конаев', nameKk: 'Қонаев' },
  },
  {
    code: 'atyrau',
    nameRu: 'Атырауская область',
    nameKk: 'Атырау облысы',
    center: { code: 'atyrau', nameRu: 'Атырау', nameKk: 'Атырау' },
  },
  {
    code: 'east-kz',
    nameRu: 'Восточно-Казахстанская область',
    nameKk: 'Шығыс Қазақстан облысы',
    center: { code: 'oskemen', nameRu: 'Усть-Каменогорск', nameKk: 'Өскемен' },
  },
  {
    code: 'zhambyl',
    nameRu: 'Жамбылская область',
    nameKk: 'Жамбыл облысы',
    center: { code: 'taraz', nameRu: 'Тараз', nameKk: 'Тараз' },
  },
  {
    code: 'zhetysu',
    nameRu: 'Жетысуская область',
    nameKk: 'Жетісу облысы',
    center: { code: 'taldykorgan', nameRu: 'Талдыкорган', nameKk: 'Талдықорған' },
  },
  {
    code: 'west-kz',
    nameRu: 'Западно-Казахстанская область',
    nameKk: 'Батыс Қазақстан облысы',
    center: { code: 'oral', nameRu: 'Уральск', nameKk: 'Орал' },
  },
  {
    code: 'karaganda',
    nameRu: 'Карагандинская область',
    nameKk: 'Қарағанды облысы',
    center: { code: 'karaganda', nameRu: 'Караганда', nameKk: 'Қарағанды' },
  },
  {
    code: 'kostanay',
    nameRu: 'Костанайская область',
    nameKk: 'Қостанай облысы',
    center: { code: 'kostanay', nameRu: 'Костанай', nameKk: 'Қостанай' },
  },
  {
    code: 'kyzylorda',
    nameRu: 'Кызылординская область',
    nameKk: 'Қызылорда облысы',
    center: { code: 'kyzylorda', nameRu: 'Кызылорда', nameKk: 'Қызылорда' },
  },
  {
    code: 'mangystau',
    nameRu: 'Мангистауская область',
    nameKk: 'Маңғыстау облысы',
    center: { code: 'aktau', nameRu: 'Актау', nameKk: 'Ақтау' },
  },
  {
    code: 'pavlodar',
    nameRu: 'Павлодарская область',
    nameKk: 'Павлодар облысы',
    center: { code: 'pavlodar', nameRu: 'Павлодар', nameKk: 'Павлодар' },
  },
  {
    code: 'north-kz',
    nameRu: 'Северо-Казахстанская область',
    nameKk: 'Солтүстік Қазақстан облысы',
    center: { code: 'petropavl', nameRu: 'Петропавловск', nameKk: 'Петропавл' },
  },
  {
    code: 'turkestan',
    nameRu: 'Туркестанская область',
    nameKk: 'Түркістан облысы',
    center: { code: 'turkestan', nameRu: 'Туркестан', nameKk: 'Түркістан' },
  },
  {
    code: 'ulytau',
    nameRu: 'Улытауская область',
    nameKk: 'Ұлытау облысы',
    center: { code: 'zhezkazgan', nameRu: 'Жезказган', nameKk: 'Жезқазған' },
  },
];

const republicCities = [
  { code: 'astana', nameRu: 'Астана', nameKk: 'Астана' },
  { code: 'almaty', nameRu: 'Алматы', nameKk: 'Алматы' },
  { code: 'shymkent', nameRu: 'Шымкент', nameKk: 'Шымкент' },
];

// Раздел 2 ТЗ: ставка НДС с 01.01.2026 — 16%. Прошлая ставка остаётся для документов прошлых периодов.
const vatRates = [
  {
    code: 'vat-16',
    nameRu: 'НДС 16%',
    nameKk: 'ҚҚС 16%',
    rate: '16.00',
    validFrom: '2026-01-01',
    validTo: null,
    isDefault: true,
  },
  {
    code: 'vat-12',
    nameRu: 'НДС 12%',
    nameKk: 'ҚҚС 12%',
    rate: '12.00',
    validFrom: '2009-01-01',
    validTo: '2025-12-31',
    isDefault: false,
  },
  {
    code: 'vat-0',
    nameRu: 'НДС 0%',
    nameKk: 'ҚҚС 0%',
    rate: '0.00',
    validFrom: '2009-01-01',
    validTo: null,
    isDefault: false,
  },
  {
    code: 'vat-none',
    nameRu: 'Без НДС',
    nameKk: 'ҚҚС-сыз',
    rate: '0.00',
    validFrom: '2009-01-01',
    validTo: null,
    isDefault: false,
  },
];

// Раздел 3.2 ТЗ: единицы измерения и категории — справочники, правило 5.
const units = [
  { code: 'pcs', nameRu: 'шт', nameKk: 'дана' },
  { code: 'kg', nameRu: 'кг', nameKk: 'кг' },
  { code: 'l', nameRu: 'л', nameKk: 'л' },
  { code: 'pack', nameRu: 'упак', nameKk: 'қаптама' },
];

const categories = [
  { code: 'grocery', nameRu: 'Бакалея', nameKk: 'Бакалея' },
  { code: 'dairy', nameRu: 'Молочные продукты', nameKk: 'Сүт өнімдері' },
  { code: 'drinks', nameRu: 'Напитки', nameKk: 'Сусындар' },
  { code: 'bakery', nameRu: 'Хлеб и выпечка', nameKk: 'Нан және тоқаш' },
  { code: 'household', nameRu: 'Бытовая химия', nameKk: 'Тұрмыстық химия' },
  { code: 'tobacco', nameRu: 'Табачные изделия', nameKk: 'Темекі өнімдері' },
];

/**
 * Матрица прав из раздела 3.12 ТЗ. Правило 5: перечень в справочнике, не в коде приложения —
 * здесь он только загружается в БД, читает его приложение уже оттуда.
 */
const ALL_ACTIONS = ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'SIGN', 'EXPORT'] as const;

const ROLE_TEMPLATES = [
  {
    code: 'OWNER',
    nameRu: 'Владелец компании',
    nameKk: 'Компания иесі',
    permissions: {
      CATALOG: ALL_ACTIONS,
      SWIPE_ORDERS: ALL_ACTIONS,
      ACCEPTANCE: ALL_ACTIONS,
      POS: ALL_ACTIONS,
      STOCK: ALL_ACTIONS,
      PURCHASE_PRICES: ALL_ACTIONS,
      DOCUMENTS_PAYMENTS: ALL_ACTIONS,
      EMPLOYEES_REQUISITES: ALL_ACTIONS,
      DELIVERIES: ALL_ACTIONS,
    },
  },
  {
    code: 'PURCHASING_MANAGER',
    nameRu: 'Менеджер по закупкам',
    nameKk: 'Сатып алу менеджері',
    permissions: {
      SWIPE_ORDERS: ['VIEW', 'CREATE', 'UPDATE'],
      ACCEPTANCE: ['VIEW', 'CREATE', 'UPDATE'],
      STOCK: ['VIEW'],
      PURCHASE_PRICES: ['VIEW'],
      DOCUMENTS_PAYMENTS: ['VIEW'],
    },
  },
  {
    code: 'CASHIER',
    nameRu: 'Кассир',
    nameKk: 'Кассир',
    // Раздел 3.12 ТЗ: кассиру недоступны закупочные цены, заявки и выгрузки.
    permissions: {
      POS: ['VIEW', 'CREATE'],
      STOCK: ['VIEW'],
    },
  },
  {
    code: 'STOREKEEPER',
    nameRu: 'Кладовщик',
    nameKk: 'Қоймашы',
    permissions: {
      SWIPE_ORDERS: ['VIEW'],
      ACCEPTANCE: ['VIEW', 'CREATE', 'UPDATE'],
      STOCK: ALL_ACTIONS,
      DELIVERIES: ['VIEW', 'UPDATE'],
    },
  },
  {
    code: 'ACCOUNTANT',
    nameRu: 'Бухгалтер',
    nameKk: 'Бухгалтер',
    permissions: {
      SWIPE_ORDERS: ['VIEW'],
      ACCEPTANCE: ['VIEW'],
      POS: ['VIEW'],
      STOCK: ['VIEW'],
      PURCHASE_PRICES: ['VIEW'],
      DOCUMENTS_PAYMENTS: ALL_ACTIONS,
    },
  },
  {
    code: 'SALES_MANAGER',
    nameRu: 'Менеджер продаж',
    nameKk: 'Сату менеджері',
    permissions: {
      CATALOG: ALL_ACTIONS,
      SWIPE_ORDERS: ['VIEW', 'UPDATE'],
      DOCUMENTS_PAYMENTS: ['VIEW', 'CREATE'],
      STOCK: ['VIEW'],
    },
  },
  {
    code: 'DRIVER',
    nameRu: 'Водитель',
    nameKk: 'Жүргізуші',
    permissions: {
      DELIVERIES: ['VIEW', 'UPDATE'],
    },
  },
] as const;

/** Администраторы платформы и флаги функций (раздел 3.13 ТЗ). Данные тестовые. */
const ADMINS = [
  { phone: '+77009000001', name: 'Админ платформы (тест)', role: 'SUPERADMIN' as const },
  { phone: '+77009000002', name: 'Модератор платформы (тест)', role: 'MODERATOR' as const },
  // Шаблоны печатных форм и справочники (раздел 3.13 ТЗ).
  {
    phone: '+77009000003',
    name: 'Контент-менеджер платформы (тест)',
    role: 'CONTENT_MANAGER' as const,
  },
];

/**
 * Районные центры демо-регионов (раздел 3.9 ТЗ): нужны для поиска поставщиков
 * в соседних городах. Остальные области пока представлены только центром.
 */
const districtCities = [
  { regionCode: 'zhambyl', code: 'shu', nameRu: 'Шу', nameKk: 'Шу' },
  { regionCode: 'zhambyl', code: 'karatau', nameRu: 'Каратау', nameKk: 'Қаратау' },
  { regionCode: 'zhambyl', code: 'zhanatas', nameRu: 'Жанатас', nameKk: 'Жаңатас' },
  { regionCode: 'zhetysu', code: 'taldykorgan-tekeli', nameRu: 'Текели', nameKk: 'Текелі' },
];

/** Тарифные планы платформы (раздел 3.13 ТЗ). Правило 5: лимиты в справочнике БД. */
const TARIFF_PLANS = [
  {
    code: 'START',
    nameRu: 'Старт',
    nameKk: 'Бастау',
    priceMonthly: '0.00',
    maxLocations: 1,
    maxEmployees: 3,
    maxProducts: 100,
    trialDays: 14,
    isDefault: true,
  },
  {
    code: 'BUSINESS',
    nameRu: 'Бизнес',
    nameKk: 'Бизнес',
    priceMonthly: '19900.00',
    maxLocations: 5,
    maxEmployees: 15,
    maxProducts: 5000,
    trialDays: 14,
    isDefault: false,
  },
  {
    code: 'PRO',
    nameRu: 'Профи',
    nameKk: 'Кәсіби',
    priceMonthly: '49900.00',
    maxLocations: null,
    maxEmployees: null,
    maxProducts: null,
    trialDays: 0,
    isDefault: false,
  },
];

const SETTINGS = [
  // В демо компании подтверждаются автоматически, иначе показ упирается в модерацию.
  { key: 'auto_verify_companies', value: 'true' },
  { key: 'platform_name', value: 'B2B-платформа (демо)' },
  // Раздел 4.2 ТЗ: подакцизный товар (алкоголь, табак) продаётся только в эти часы.
  // TODO(open-question): часы и возраст сверяются с юристом и местными правилами акимата.
  { key: 'excise_sale_hours', value: '08:00-23:00' },
  { key: 'excise_min_age', value: '21' },
  // Разделы 4.1 и 4.2 ТЗ: доля упаковки при продаже штуками округляется до 3 знаков.
  // TODO(open-question): способ округления (half_up, up, down) подтверждает заказчик.
  { key: 'piece_sale_rounding', value: 'half_up' },
];

async function main() {
  for (const city of republicCities) {
    await prisma.city.upsert({
      where: { code: city.code },
      update: { nameRu: city.nameRu, nameKk: city.nameKk, isRepublicSignificant: true },
      create: { ...city, isRepublicSignificant: true },
    });
  }

  for (const region of regions) {
    const { center, ...regionData } = region;
    const saved = await prisma.region.upsert({
      where: { code: regionData.code },
      update: regionData,
      create: regionData,
    });
    await prisma.city.upsert({
      where: { code: center.code },
      update: { ...center, regionId: saved.id },
      create: { ...center, regionId: saved.id },
    });
  }

  for (const city of districtCities) {
    const region = await prisma.region.findUniqueOrThrow({ where: { code: city.regionCode } });
    const data = { nameRu: city.nameRu, nameKk: city.nameKk, regionId: region.id };
    await prisma.city.upsert({
      where: { code: city.code },
      update: data,
      create: { code: city.code, ...data },
    });
  }

  for (const rate of vatRates) {
    const data = {
      nameRu: rate.nameRu,
      nameKk: rate.nameKk,
      rate: rate.rate,
      validFrom: new Date(rate.validFrom),
      validTo: rate.validTo ? new Date(rate.validTo) : null,
      isDefault: rate.isDefault,
    };
    await prisma.vatRate.upsert({
      where: { code: rate.code },
      update: data,
      create: { code: rate.code, ...data },
    });
  }

  for (const unit of units) {
    await prisma.unit.upsert({ where: { code: unit.code }, update: unit, create: unit });
  }

  for (const category of categories) {
    await prisma.category.upsert({
      where: { code: category.code },
      update: category,
      create: category,
    });
  }

  for (const template of ROLE_TEMPLATES) {
    // Составной unique с nullable companyId не годится для upsert — ищем вручную.
    const existing = await prisma.role.findFirst({
      where: { companyId: null, code: template.code },
    });
    const data = { nameRu: template.nameRu, nameKk: template.nameKk, isTemplate: true };
    const role = existing
      ? await prisma.role.update({ where: { id: existing.id }, data })
      : await prisma.role.create({ data: { code: template.code, ...data } });

    await prisma.permission.deleteMany({ where: { roleId: role.id } });
    const rows = Object.entries(template.permissions).flatMap(([section, actions]) =>
      [...actions].map((action) => ({
        roleId: role.id,
        section: section as never,
        action: action as never,
      })),
    );
    await prisma.permission.createMany({ data: rows });
  }

  for (const plan of TARIFF_PLANS) {
    const { code, ...data } = plan;
    await prisma.tariffPlan.upsert({ where: { code }, update: data, create: { code, ...data } });
  }

  const [cities, rates, unitCount, categoryCount, planCount] = await Promise.all([
    prisma.city.count(),
    prisma.vatRate.count(),
    prisma.unit.count(),
    prisma.category.count(),
    prisma.tariffPlan.count(),
  ]);
  for (const admin of ADMINS) {
    await prisma.adminUser.upsert({
      where: { phone: admin.phone },
      update: { name: admin.name, role: admin.role },
      create: admin,
    });
  }

  for (const setting of SETTINGS) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  const [roleCount, permissionCount] = await Promise.all([
    prisma.role.count(),
    prisma.permission.count(),
  ]);
  console.log(
    `Справочники загружены: городов ${cities}, ставок НДС ${rates}, ` +
      `единиц ${unitCount}, категорий ${categoryCount}, тарифов ${planCount}, ролей ${roleCount}, прав ${permissionCount}, ` +
      `администраторов ${await prisma.adminUser.count()}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
