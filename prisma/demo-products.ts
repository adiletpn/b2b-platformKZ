/**
 * Фото и товары макета для демо-каталога. Снимки — из макета заказчика, на упаковках настоящие
 * бренды: заказчик 4.11.2026 разрешил их для показа. Для пилота с настоящими поставщиками
 * заменяются фотографиями из их каталогов.
 */
export const PHOTO_BY_BARCODE: Record<string, string> = {
  '4870001000032': '/products/rice.webp',
  '4870001000049': '/products/sunflower-oil.webp',
  '4870001000097': '/products/ketchup.webp',
  '4870001000103': '/products/lazdjan.webp',
  '4870001000110': '/products/adjika.webp',
  '4870001000127': '/products/pelmeni.webp',
  '4870002000017': '/products/milk.webp',
  '4870002000024': '/products/kefir.webp',
  '4870002000048': '/products/tvorog.webp',
  '4870002000072': '/products/eggs.webp',
};

export type DemoProduct = {
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

/** Товары с экранов макета, которых не было в демо-каталоге. */
export const MOCKUP_GROCERY: DemoProduct[] = [
  {
    barcode: '4870001000097',
    nameRu: 'Кетчуп томатный, 250 г',
    nameKk: 'Қызанақ кетчупы, 250 г',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '616.00',
    packSize: '12',
    minBatch: '12',
    stock: '1840',
  },
  {
    barcode: '4870001000103',
    nameRu: 'Лазджан острый, 250 г',
    nameKk: 'Ащы лазджан, 250 г',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '1117.00',
    packSize: '20',
    minBatch: '20',
    stock: '620',
  },
  {
    barcode: '4870001000110',
    nameRu: 'Аджика острая, 450 мл',
    nameKk: 'Ащы аджика, 450 мл',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '1224.00',
    packSize: '12',
    minBatch: '12',
    stock: '240',
  },
  {
    barcode: '4870001000127',
    nameRu: 'Пельмени домашние, 800 г',
    nameKk: 'Үй тұшпарасы, 800 г',
    category: 'grocery',
    unit: 'pcs',
    priceWithoutVat: '1955.00',
    packSize: '8',
    minBatch: '8',
    stock: '310',
  },
];

export const MOCKUP_DAIRY: DemoProduct[] = [
  {
    barcode: '4870002000072',
    nameRu: 'Яйца С1, 10 шт',
    nameKk: 'С1 жұмыртқа, 10 дана',
    category: 'dairy',
    unit: 'pcs',
    priceWithoutVat: '696.00',
    packSize: '36',
    minBatch: '36',
    stock: '720',
  },
];
