/**
 * Мок государственного реестра БИН. Интерфейс как у реального справочника:
 * по БИН возвращает название, форму и юридический адрес.
 * Правило 12: данные вымышленные, реальных компаний здесь нет.
 */
export type BinRegistryEntry = {
  bin: string;
  name: string;
  legalForm: 'IP' | 'TOO' | 'AO';
  legalAddress: string;
  cityCode: string;
  isVatPayer: boolean;
};

const ENTRIES: readonly BinRegistryEntry[] = [
  {
    bin: '120340001230',
    name: 'ТОО «Алматы Азык» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Алматы, ул. Демонстрационная, 1',
    cityCode: 'almaty',
    isVatPayer: true,
  },
  {
    bin: '150640004569',
    name: 'ТОО «Дала Сут» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Тараз, ул. Демонстрационная, 2',
    cityCode: 'taraz',
    isVatPayer: true,
  },
  {
    bin: '191140007892',
    name: 'ИП «Мырзабек» (тест)',
    legalForm: 'IP',
    legalAddress: 'г. Алматы, ул. Демонстрационная, 3',
    cityCode: 'almaty',
    isVatPayer: false,
  },
  {
    bin: '140240003217',
    name: 'ТОО «Береке Маркет» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Тараз, ул. Демонстрационная, 4',
    cityCode: 'taraz',
    isVatPayer: true,
  },
  {
    bin: '170840006546',
    name: 'ТОО «Қала Дүкені» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Алматы, ул. Демонстрационная, 5',
    cityCode: 'almaty',
    isVatPayer: true,
  },
  {
    bin: '210540009877',
    name: 'ИП «Айгерим» (тест)',
    legalForm: 'IP',
    legalAddress: 'г. Тараз, ул. Демонстрационная, 6',
    cityCode: 'taraz',
    isVatPayer: false,
  },
  {
    bin: '130540001359',
    name: 'ТОО «Тараз Сауда» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Тараз, ул. Демонстрационная, 7',
    cityCode: 'taraz',
    isVatPayer: true,
  },
  {
    bin: '160940002466',
    name: 'ТОО «Нан Өнімдері» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Алматы, ул. Демонстрационная, 8',
    cityCode: 'almaty',
    isVatPayer: true,
  },
  {
    bin: '200140003574',
    name: 'ТОО «Сусын Дистрибьюция» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Алматы, ул. Демонстрационная, 9',
    cityCode: 'almaty',
    isVatPayer: true,
  },
  {
    bin: '220640004683',
    name: 'ИП «Нурлан» (тест)',
    legalForm: 'IP',
    legalAddress: 'г. Тараз, ул. Демонстрационная, 10',
    cityCode: 'taraz',
    isVatPayer: false,
  },
  {
    bin: '190240005798',
    name: 'ТОО «Магнум Тест» (тест)',
    legalForm: 'TOO',
    legalAddress: 'г. Алматы, ул. Демонстрационная, 11',
    cityCode: 'almaty',
    isVatPayer: true,
  },
  {
    bin: '231040006800',
    name: 'ИП «Жанна» (тест)',
    legalForm: 'IP',
    legalAddress: 'г. Тараз, ул. Демонстрационная, 12',
    cityCode: 'taraz',
    isVatPayer: false,
  },
];

/**
 * Пул для автотестов: каждый прогон занимает БИН безвозвратно, а именованных
 * компаний выше хватает только на показ. Генерируется с валидной контрольной суммой.
 */
const FIRST_WEIGHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const SECOND_WEIGHTS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

function checkDigit(firstEleven: string): number | null {
  const digits = [...firstEleven].map(Number);
  const weighted = (weights: number[]) =>
    weights.reduce((acc, weight, index) => acc + weight * (digits[index] ?? 0), 0) % 11;

  const first = weighted(FIRST_WEIGHTS);
  if (first !== 10) return first;
  const second = weighted(SECOND_WEIGHTS);
  return second === 10 ? null : second;
}

function buildTestPool(count: number): BinRegistryEntry[] {
  const pool: BinRegistryEntry[] = [];
  for (let index = 0; pool.length < count; index += 1) {
    const prefix = `24014${String(index).padStart(6, '0')}`;
    const digit = checkDigit(prefix);
    if (digit === null) continue;

    const number = pool.length + 1;
    const isStore = number % 2 === 0;
    pool.push({
      bin: `${prefix}${digit}`,
      name: `ТОО «Тест-${isStore ? 'магазин' : 'поставщик'} ${number}»`,
      legalForm: 'TOO',
      legalAddress: `г. ${isStore ? 'Тараз' : 'Алматы'}, ул. Тестовая, ${number}`,
      cityCode: isStore ? 'taraz' : 'almaty',
      isVatPayer: true,
    });
  }
  return pool;
}

const TEST_POOL = buildTestPool(400);

export function lookupBin(bin: string): BinRegistryEntry | null {
  return (
    ENTRIES.find((entry) => entry.bin === bin) ??
    TEST_POOL.find((entry) => entry.bin === bin) ??
    null
  );
}

/** Полный реестр: именованные компании плюс пул для автотестов. */
export function listBinRegistry(): readonly BinRegistryEntry[] {
  return [...ENTRIES, ...TEST_POOL];
}

/** Что показывать подсказкой в онбординге: только именованные компании. */
export function listDemoBins(): readonly BinRegistryEntry[] {
  return ENTRIES;
}

/** БИН из тестового пула по индексу — для автотестов. */
export function testPoolBin(index: number): string {
  const entry = TEST_POOL[index];
  if (!entry) throw new Error(`в тестовом пуле нет БИН с индексом ${index}`);
  return entry.bin;
}
