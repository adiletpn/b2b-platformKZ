import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { roundToPackSize } from '@/lib/cart/cart';

describe('кратность упаковки', () => {
  it('cart_rounds_quantity_up_to_pack_size', () => {
    expect(roundToPackSize(new Decimal('1'), new Decimal('12')).toFixed(3)).toBe('12.000');
    expect(roundToPackSize(new Decimal('13'), new Decimal('12')).toFixed(3)).toBe('24.000');
    expect(roundToPackSize(new Decimal('24'), new Decimal('12')).toFixed(3)).toBe('24.000');
  });

  it('cart_keeps_three_decimals_for_weighted_goods', () => {
    expect(roundToPackSize(new Decimal('0.4'), new Decimal('0.25')).toFixed(3)).toBe('0.500');
    expect(roundToPackSize(new Decimal('1.234'), new Decimal('0')).toFixed(3)).toBe('1.234');
  });

  it('cart_zero_quantity_stays_zero', () => {
    expect(roundToPackSize(new Decimal('0'), new Decimal('12')).toFixed(3)).toBe('0.000');
  });
});
