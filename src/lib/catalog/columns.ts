/** Колонки шаблона каталога. Состав полей — раздел 3.2 ТЗ (карточка товара). */
export const CATALOG_COLUMNS = [
  {
    key: 'barcode',
    titleRu: 'Штрихкод (EAN-13 / GTIN)',
    titleKk: 'Штрихкод (EAN-13 / GTIN)',
    required: true,
    width: 22,
  },
  { key: 'nameRu', titleRu: 'Название (рус)', titleKk: 'Атауы (орыс)', required: true, width: 34 },
  { key: 'nameKk', titleRu: 'Название (каз)', titleKk: 'Атауы (қаз)', required: true, width: 34 },
  { key: 'sku', titleRu: 'Артикул', titleKk: 'Артикул', required: false, width: 14 },
  { key: 'brand', titleRu: 'Бренд', titleKk: 'Бренд', required: false, width: 18 },
  {
    key: 'categoryCode',
    titleRu: 'Категория (код)',
    titleKk: 'Санаты (коды)',
    required: false,
    width: 18,
  },
  {
    key: 'manufacturer',
    titleRu: 'Производитель',
    titleKk: 'Өндіруші',
    required: false,
    width: 22,
  },
  { key: 'country', titleRu: 'Страна', titleKk: 'Елі', required: false, width: 14 },
  {
    key: 'unitCode',
    titleRu: 'Единица измерения (код)',
    titleKk: 'Өлшем бірлігі (коды)',
    required: true,
    width: 22,
  },
  {
    key: 'packSize',
    titleRu: 'Кратность упаковки',
    titleKk: 'Қаптама еселігі',
    required: false,
    width: 18,
  },
  {
    key: 'minBatch',
    titleRu: 'Минимальная партия',
    titleKk: 'Ең аз партия',
    required: false,
    width: 18,
  },
  {
    key: 'priceWithoutVat',
    titleRu: 'Цена без НДС',
    titleKk: 'ҚҚС-сыз баға',
    required: true,
    width: 16,
  },
  {
    key: 'vatCode',
    titleRu: 'Ставка НДС (код)',
    titleKk: 'ҚҚС мөлшерлемесі (коды)',
    required: true,
    width: 20,
  },
  { key: 'stock', titleRu: 'Остаток', titleKk: 'Қалдық', required: false, width: 12 },
  {
    key: 'expiresAt',
    titleRu: 'Срок годности (ДД.ММ.ГГГГ)',
    titleKk: 'Жарамдылық мерзімі (КК.АА.ЖЖЖЖ)',
    required: false,
    width: 24,
  },
  {
    key: 'isMarked',
    titleRu: 'Маркируемый (да/нет)',
    titleKk: 'Таңбаланатын (иә/жоқ)',
    required: false,
    width: 20,
  },
  {
    key: 'isExcise',
    titleRu: 'Подакцизный (да/нет)',
    titleKk: 'Акцизделетін (иә/жоқ)',
    required: false,
    width: 20,
  },
  {
    key: 'requiresSnt',
    titleRu: 'Требует СНТ (да/нет)',
    titleKk: 'ІЖҚ қажет (иә/жоқ)',
    required: false,
    width: 20,
  },
  {
    key: 'isLicensed',
    titleRu: 'Лицензируемый (да/нет)',
    titleKk: 'Лицензияланатын (иә/жоқ)',
    required: false,
    width: 22,
  },
  { key: 'tnvedCode', titleRu: 'Код ТН ВЭД', titleKk: 'СЭҚ ТН коды', required: false, width: 16 },
] as const;

export type CatalogColumnKey = (typeof CATALOG_COLUMNS)[number]['key'];

export const HEADER_ROW = 1;
export const FIRST_DATA_ROW = 2;
