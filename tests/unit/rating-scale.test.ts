import { describe, expect, it } from 'vitest';
import { criteriaFor, paymentDiscipline } from '@/lib/ratings/criteria';
import { windowStart, RATING_WINDOW_MONTHS } from '@/lib/ratings/metrics';

describe('шкала платёжной дисциплины', () => {
  it('payment_discipline_scale_matches_specification', () => {
    // Раздел 3.8 ТЗ: «платит в срок», «задержки до 7 дней», «частые просрочки».
    expect(paymentDiscipline(0)).toBe('on_time');
    expect(paymentDiscipline(0.5)).toBe('delays_up_to_7');
    expect(paymentDiscipline(7)).toBe('delays_up_to_7');
    expect(paymentDiscipline(7.1)).toBe('frequent_delays');
    expect(paymentDiscipline(30)).toBe('frequent_delays');
  });
});

describe('критерии оценок', () => {
  it('rating_criteria_differ_for_supplier_and_store', () => {
    expect(criteriaFor('supplier')).toEqual(['quality', 'matching', 'politeness', 'packaging']);
    expect(criteriaFor('store')).toEqual(['acceptance', 'communication']);
  });
});

describe('окно рейтинга', () => {
  it('rating_window_is_twelve_months', () => {
    expect(RATING_WINDOW_MONTHS).toBe(12);

    const now = new Date('2026-10-19T00:00:00.000Z');
    expect(windowStart(now).toISOString().slice(0, 10)).toBe('2025-10-19');
  });
});
