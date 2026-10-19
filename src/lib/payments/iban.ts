/**
 * Проверка ИИК (IBAN) по ISO 13616: длина для КЗ — 20 символов, контроль mod 97.
 * Раздел 2 ТЗ: реквизиты компании с проверкой IBAN.
 */
const KZ_LENGTH = 20;

export function isValidKzIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (!/^KZ\d{2}[A-Z0-9]{16}$/.test(iban) || iban.length !== KZ_LENGTH) return false;

  // Первые четыре символа переносятся в конец, буквы заменяются числами (A = 10).
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = [...rearranged]
    .map((char) => (/[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char))
    .join('');

  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** БИК банка РК: 8 символов, латиница и цифры. */
export function isValidBik(value: string): boolean {
  return /^[A-Z]{4}KZ[A-Z0-9]{2}$/.test(value.replace(/\s/g, '').toUpperCase());
}
