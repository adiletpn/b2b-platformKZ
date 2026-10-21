/**
 * Даты в формате ДД.ММ.ГГГГ и в часовом поясе Казахстана (раздел 2 ТЗ):
 * сервер может стоять в другом поясе, а подпись и оплата показываются по местному времени.
 */
const KZ_TIME_ZONE = 'Asia/Almaty';

const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: KZ_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: KZ_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date).replace(',', '');
}

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: KZ_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Календарный день по Казахстану в виде ГГГГ-ММ-ДД: ключ для группировки и сравнения дат. */
export function kzDayKey(date: Date): string {
  return dayKeyFormat.format(date);
}

/**
 * Сумма как в макете: «1 251», «690», копейки только если они есть — «1 251,50».
 * Вход — строка Decimal (правило 1), вычислений здесь нет, только вывод.
 */
export function money(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cents = fraction.replace(/0+$/, '') ? `,${fraction.padEnd(2, '0').slice(0, 2)}` : '';
  return `${negative ? '−' : ''}${grouped}${cents}`;
}

/** Количество без лишних нулей: «12», «0,5», «2,125». */
export function quantity(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole},${trimmed}` : whole;
}
