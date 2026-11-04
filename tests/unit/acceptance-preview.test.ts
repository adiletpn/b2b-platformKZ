import { describe, expect, it } from 'vitest';
import { previewDiscrepancy } from '@/lib/acceptance/preview';

const line = {
  shipped: '10',
  priceWithVat: '100.50',
  accepted: '10',
  defective: '0',
  mismatch: '0',
};

describe('предпросмотр акта расхождений', () => {
  it('clean_acceptance_has_no_discrepancy', () => {
    expect(previewDiscrepancy([line])).toEqual({ count: 0, amount: '0.00' });
  });

  it('counts_short_delivery_by_price_in_decimal', () => {
    expect(previewDiscrepancy([{ ...line, accepted: '8' }])).toEqual({
      count: 1,
      amount: '201.00',
    });
    // Дробное количество весового товара без ошибки плавающей точки.
    expect(previewDiscrepancy([{ ...line, priceWithVat: '0.10', accepted: '9.700' }])).toEqual({
      count: 1,
      amount: '0.03',
    });
  });

  it('defect_without_shortage_is_flagged_with_zero_amount', () => {
    expect(previewDiscrepancy([{ ...line, defective: '1' }])).toEqual({ count: 1, amount: '0.00' });
  });

  it('half_typed_number_is_skipped', () => {
    expect(
      previewDiscrepancy([
        { ...line, accepted: '1,' },
        { ...line, accepted: '9' },
      ]),
    ).toEqual({
      count: 1,
      amount: '100.50',
    });
  });
});
