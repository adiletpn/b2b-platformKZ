import { describe, expect, it } from 'vitest';
import { markupPercent } from '@/lib/stock/overview';

describe('наценка в таблице остатков (D09)', () => {
  it('markup_is_percent_of_cost_rounded', () => {
    expect(markupPercent('465.00', '690.00')).toBe(48);
    expect(markupPercent('500.00', '750.00')).toBe(50);
  });

  it('no_price_or_zero_cost_gives_no_markup', () => {
    expect(markupPercent('500.00', null)).toBeNull();
    expect(markupPercent('0.00', '100.00')).toBeNull();
  });
});
