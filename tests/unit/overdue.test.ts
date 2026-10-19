import { describe, expect, it } from 'vitest';
import { daysOverdue, isOverdue } from '@/lib/settlements/receivables';

describe('просрочка оплаты', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');

  it('order_without_due_date_is_never_overdue', () => {
    expect(isOverdue(null, now)).toBe(false);
    expect(daysOverdue(null, now)).toBe(0);
  });

  it('order_is_not_overdue_before_due_date', () => {
    expect(isOverdue(new Date('2026-10-25'), now)).toBe(false);
    expect(daysOverdue(new Date('2026-10-25'), now)).toBe(0);
  });

  it('days_overdue_are_counted_from_due_date', () => {
    expect(isOverdue(new Date('2026-10-09T12:00:00.000Z'), now)).toBe(true);
    expect(daysOverdue(new Date('2026-10-09T12:00:00.000Z'), now)).toBe(10);
  });
});
