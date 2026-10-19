import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { documentTotals, lineTotals } from '@/lib/documents/totals';

const d = (value: string) => new Decimal(value);

describe('суммы документа', () => {
  it('vat_is_extracted_from_price_with_vat_at_16_percent', () => {
    const totals = lineTotals({
      quantity: d('10'),
      priceWithVat: d('116.00'),
      vatRateValue: d('16'),
    });

    expect(totals.totalWithVat.toFixed(2)).toBe('1160.00');
    expect(totals.totalWithoutVat.toFixed(2)).toBe('1000.00');
    expect(totals.vatAmount.toFixed(2)).toBe('160.00');
    expect(totals.priceWithoutVat.toFixed(2)).toBe('100.00');
  });

  it('vat_zero_rate_keeps_amount_unchanged', () => {
    const totals = lineTotals({ quantity: d('3'), priceWithVat: d('99.99'), vatRateValue: d('0') });
    expect(totals.totalWithVat.toFixed(2)).toBe('299.97');
    expect(totals.totalWithoutVat.toFixed(2)).toBe('299.97');
    expect(totals.vatAmount.toFixed(2)).toBe('0.00');
  });

  it('document_total_is_sum_of_line_totals', () => {
    const totals = documentTotals([
      { quantity: d('2'), priceWithVat: d('116.00'), vatRateValue: d('16') },
      { quantity: d('1'), priceWithVat: d('58.00'), vatRateValue: d('16') },
    ]);

    expect(totals.totalWithVat.toFixed(2)).toBe('290.00');
    expect(totals.totalWithoutVat.toFixed(2)).toBe('250.00');
    expect(totals.vatAmount.toFixed(2)).toBe('40.00');
  });

  it('vat_sum_always_equals_total_minus_net', () => {
    // Цены с копейками: округление не должно ломать равенство.
    const lines = [
      { quantity: d('7'), priceWithVat: d('13.33'), vatRateValue: d('16') },
      { quantity: d('3'), priceWithVat: d('1.07'), vatRateValue: d('16') },
      { quantity: d('1.5'), priceWithVat: d('999.99'), vatRateValue: d('16') },
    ];
    const totals = documentTotals(lines);
    expect(totals.vatAmount.toFixed(2)).toBe(
      totals.totalWithVat.minus(totals.totalWithoutVat).toFixed(2),
    );
  });

  it('quantities_with_three_decimals_are_supported', () => {
    const totals = lineTotals({
      quantity: d('1.234'),
      priceWithVat: d('116.00'),
      vatRateValue: d('16'),
    });
    expect(totals.totalWithVat.toFixed(2)).toBe('143.14');
  });
});
