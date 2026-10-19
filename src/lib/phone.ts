/** Телефоны РК: +7 и 10 цифр. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const national =
    digits.length === 11 && (digits[0] === '8' || digits[0] === '7') ? digits.slice(1) : digits;
  if (national.length !== 10 || national[0] !== '7') return null;
  return `+7${national}`;
}

export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

/** Для логов: правило 11 — номер целиком не пишем. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length < 4 ? '***' : `+7 *** *** ${d.slice(-2)}`;
}
