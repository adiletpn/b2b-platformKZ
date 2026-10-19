/**
 * Контрольная сумма БИН/ИИН РК: 12 цифр, последняя — контрольная.
 * Раздел 2 ТЗ, идентификация компаний.
 */
const FIRST_WEIGHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const SECOND_WEIGHTS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2] as const;

function weightedRemainder(digits: number[], weights: readonly number[]): number {
  const sum = weights.reduce((acc, weight, index) => acc + weight * (digits[index] ?? 0), 0);
  return sum % 11;
}

/** Контрольная цифра для первых 11 цифр, либо null, если номер непригоден. */
export function binCheckDigit(firstEleven: string): number | null {
  if (!/^\d{11}$/.test(firstEleven)) return null;
  const digits = [...firstEleven].map(Number);

  const first = weightedRemainder(digits, FIRST_WEIGHTS);
  if (first !== 10) return first;

  const second = weightedRemainder(digits, SECOND_WEIGHTS);
  return second === 10 ? null : second;
}

export function isValidBin(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  const expected = binCheckDigit(value.slice(0, 11));
  return expected !== null && expected === Number(value[11]);
}

/** Для логов: правило 11 — БИН и телефоны целиком не пишем. */
export function maskBin(value: string): string {
  return value.length <= 6 ? '***' : `${value.slice(0, 4)}****${value.slice(-2)}`;
}
