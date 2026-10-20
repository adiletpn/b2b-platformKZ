import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { computeReceipt, parsePercent } from '@/lib/pos/receipt-math';

const line = (price: string, quantity: string, discount = '0') => ({
  price: new Decimal(price),
  quantity: new Decimal(quantity),
  discountPercent: new Decimal(discount),
});

describe('расчёт чека кассы', () => {
  it('line_and_receipt_discounts_sum_exactly_to_kopecks', () => {
    const receipt = computeReceipt(
      [line('100.00', '1'), line('33.33', '3', '10'), line('0.99', '7')],
      new Decimal('5'),
    );
    // 100 + 99.99 − 10.00 + 6.93 = 196.92; скидка на чек 5% = 9.85.
    expect(receipt.gross.toFixed(2)).toBe('206.92');
    expect(receipt.total.toFixed(2)).toBe('187.07');
    expect(receipt.discount.toFixed(2)).toBe('19.85');
    const sum = receipt.lines.reduce((total, row) => total.plus(row.total), new Decimal(0));
    expect(sum.toFixed(2)).toBe(receipt.total.toFixed(2));
  });

  it('effective_percent_includes_share_of_receipt_discount', () => {
    const receipt = computeReceipt([line('200', '1', '10')], new Decimal('10'));
    // 200 − 20 = 180, ещё 10% = 18: итог 162, скидка 19%.
    expect(receipt.total.toFixed(2)).toBe('162.00');
    expect(receipt.lines[0]!.effectivePercent.toFixed(2)).toBe('19.00');
  });

  it('percent_is_validated', () => {
    expect(parsePercent('')!.toFixed(0)).toBe('0');
    expect(parsePercent('12,5')!.toFixed(1)).toBe('12.5');
    expect(parsePercent('101')).toBeNull();
    expect(parsePercent('-1')).toBeNull();
    expect(parsePercent('1.234')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
  });
});
