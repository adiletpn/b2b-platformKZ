import Decimal from 'decimal.js';

export type PreviewLine = {
  shipped: string;
  priceWithVat: string;
  accepted: string;
  defective: string;
  mismatch: string;
};

/**
 * Предпросмотр акта расхождений до подтверждения (макет M09). Сервер считает к оплате
 * принятое × цену (`acceptance/accept.ts`), поэтому разница — непринятое × цену.
 * Строка с недописанным числом не считается, пока пользователь его вводит.
 */
export function previewDiscrepancy(lines: PreviewLine[]): { count: number; amount: string } {
  let count = 0;
  let amount = new Decimal(0);
  for (const line of lines) {
    try {
      const shipped = new Decimal(line.shipped);
      const accepted = new Decimal(line.accepted || '0');
      const flagged =
        !accepted.equals(shipped) ||
        new Decimal(line.defective || '0').greaterThan(0) ||
        new Decimal(line.mismatch || '0').greaterThan(0);
      if (!flagged) continue;
      amount = amount.plus(shipped.minus(accepted).mul(line.priceWithVat));
      count += 1;
    } catch {
      continue;
    }
  }
  return { count, amount: amount.toDecimalPlaces(2).toFixed(2) };
}
