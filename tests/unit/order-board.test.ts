import { describe, expect, it } from 'vitest';
import { boardColumn } from '@/lib/orders/board';

describe('канбан поставщика (D03)', () => {
  it('statuses_fall_into_mockup_columns', () => {
    expect(boardColumn('SENT')).toBe('new');
    expect(boardColumn('CHANGED_BY_SUPPLIER')).toBe('waitingStore');
    expect(boardColumn('PICKING')).toBe('picking');
    expect(boardColumn('DELIVERED')).toBe('shipped');
    expect(boardColumn('OVERDUE')).toBe('waitingPayment');
  });

  it('finished_and_draft_orders_are_off_the_board', () => {
    for (const status of ['DRAFT', 'PAID', 'CLOSED', 'CANCELLED', 'REJECTED', 'DISPUTE'] as const) {
      expect(boardColumn(status)).toBeNull();
    }
  });
});
