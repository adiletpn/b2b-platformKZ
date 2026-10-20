/**
 * Ограничения продажи на кассе (раздел 4.2 ТЗ): маркированный товар — только со
 * сканированием DataMatrix, подакцизный — в разрешённые часы и с подтверждением возраста.
 * Часы и возраст — в настройках платформы (правило 5), здесь только проверка.
 */
const KZ_TIME_ZONE = 'Asia/Almaty';

/** Минуты от полуночи по времени Казахстана. */
export function localMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: KZ_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** «08:00-23:00» → окно в минутах; ночное окно «22:00-06:00» тоже поддерживается. */
export function isWithinHours(now: Date, hours: string): boolean {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(hours.trim());
  if (!match) return true;
  const [, h1, m1, h2, m2] = match.map(Number) as [number, number, number, number, number];
  const from = h1 * 60 + m1;
  const to = h2 * 60 + m2;
  const current = localMinutes(now);
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

/**
 * Код маркировки DataMatrix (GS1): начинается с «01» и GTIN из 14 цифр, дальше серийный
 * номер. Проверяем, что код относится к этому товару: GTIN совпадает со штрихкодом.
 * TODO(open-question): проверка кода в ИС МПТ — этап 3 ТЗ, сейчас только формат.
 */
export function markingCodeFits(code: string, barcode: string): boolean {
  const value = code.trim().replace(/[\u001d]/g, '');
  if (value.length < 20 || value.length > 150) return false;
  const gtin = barcode.padStart(14, '0');
  return value.startsWith(`01${gtin}`);
}
