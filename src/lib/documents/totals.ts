import Decimal from 'decimal.js';

export type LineInput = {
  quantity: Decimal;
  /** Цена с НДС за единицу — то, по чему магазин заказывал. */
  priceWithVat: Decimal;
  vatRateValue: Decimal;
};

export type LineTotals = {
  totalWithVat: Decimal;
  totalWithoutVat: Decimal;
  vatAmount: Decimal;
  priceWithoutVat: Decimal;
};

/**
 * Суммы строки документа. Правило 1: только Decimal, 2 знака.
 * НДС выделяется из цены с НДС: сумма без НДС = сумма / (1 + ставка/100).
 */
export function lineTotals(line: LineInput): LineTotals {
  const divisor = line.vatRateValue.div(100).plus(1);
  const totalWithVat = line.priceWithVat
    .times(line.quantity)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const totalWithoutVat = totalWithVat.div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    totalWithVat,
    totalWithoutVat,
    vatAmount: totalWithVat.minus(totalWithoutVat),
    priceWithoutVat: line.priceWithVat.div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  };
}

export type DocumentTotals = {
  totalWithVat: Decimal;
  totalWithoutVat: Decimal;
  vatAmount: Decimal;
};

/** Итог документа — сумма построчных итогов, без повторного округления всей суммы. */
export function documentTotals(lines: LineInput[]): DocumentTotals {
  return lines.reduce<DocumentTotals>(
    (acc, line) => {
      const totals = lineTotals(line);
      return {
        totalWithVat: acc.totalWithVat.plus(totals.totalWithVat),
        totalWithoutVat: acc.totalWithoutVat.plus(totals.totalWithoutVat),
        vatAmount: acc.vatAmount.plus(totals.vatAmount),
      };
    },
    { totalWithVat: new Decimal(0), totalWithoutVat: new Decimal(0), vatAmount: new Decimal(0) },
  );
}
