import Decimal from 'decimal.js';

/**
 * Расчёт чека кассы (раздел 4.2 ТЗ): скидка на позицию и на весь чек в процентах.
 * Правило 1: деньги — Decimal, 2 знака. Скидка на чек раскладывается по позициям
 * пропорционально, последняя позиция забирает остаток копеек — сумма сходится точно.
 */
export type ReceiptLineInput = { price: Decimal; quantity: Decimal; discountPercent: Decimal };

export type ReceiptLineResult = {
  gross: Decimal;
  discount: Decimal;
  total: Decimal;
  /** Итоговая скидка позиции в процентах — для проверки лимита кассира. */
  effectivePercent: Decimal;
};

export type ReceiptResult = {
  lines: ReceiptLineResult[];
  gross: Decimal;
  discount: Decimal;
  total: Decimal;
};

const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function parsePercent(value: string | undefined | null): Decimal | null {
  if (value === undefined || value === null || value === '') return new Decimal(0);
  try {
    const percent = new Decimal(String(value).replace(',', '.'));
    if (!percent.isFinite() || percent.lessThan(0) || percent.greaterThan(100)) return null;
    if (percent.decimalPlaces() > 2) return null;
    return percent;
  } catch {
    return null;
  }
}

export function computeReceipt(
  lines: ReceiptLineInput[],
  receiptDiscountPercent: Decimal,
): ReceiptResult {
  const afterLine = lines.map((line) => {
    const gross = money(line.price.times(line.quantity));
    const lineDiscount = money(gross.times(line.discountPercent).dividedBy(100));
    return { gross, lineDiscount, subtotal: gross.minus(lineDiscount) };
  });

  const subtotal = afterLine.reduce((sum, line) => sum.plus(line.subtotal), new Decimal(0));
  const receiptDiscount = money(subtotal.times(receiptDiscountPercent).dividedBy(100));

  let allocated = new Decimal(0);
  const result = afterLine.map((line, index) => {
    const share =
      index === afterLine.length - 1
        ? receiptDiscount.minus(allocated)
        : subtotal.isZero()
          ? new Decimal(0)
          : money(receiptDiscount.times(line.subtotal).dividedBy(subtotal));
    allocated = allocated.plus(share);
    const discount = line.lineDiscount.plus(share);
    return {
      gross: line.gross,
      discount,
      total: line.gross.minus(discount),
      effectivePercent: line.gross.isZero()
        ? new Decimal(0)
        : discount.dividedBy(line.gross).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    };
  });

  const gross = result.reduce((sum, line) => sum.plus(line.gross), new Decimal(0));
  const discount = result.reduce((sum, line) => sum.plus(line.discount), new Decimal(0));
  return { lines: result, gross, discount, total: gross.minus(discount) };
}
