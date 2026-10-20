import { describe, expect, it } from 'vitest';
import { isWithinHours, localMinutes, markingCodeFits } from '@/lib/pos/restrictions';

describe('ограничения продажи на кассе', () => {
  it('time_is_taken_in_kazakhstan_zone', () => {
    // 03:30 UTC = 08:30 в Алматы (UTC+5).
    expect(localMinutes(new Date('2026-10-20T03:30:00Z'))).toBe(8 * 60 + 30);
  });

  it('excise_hours_window_including_night_window', () => {
    const at = (utc: string) => new Date(`2026-10-20T${utc}:00Z`);
    expect(isWithinHours(at('03:30'), '08:00-23:00')).toBe(true); // 08:30
    expect(isWithinHours(at('02:30'), '08:00-23:00')).toBe(false); // 07:30
    expect(isWithinHours(at('18:30'), '08:00-23:00')).toBe(false); // 23:30
    expect(isWithinHours(at('18:30'), '22:00-06:00')).toBe(true);
    expect(isWithinHours(at('10:00'), 'кривая настройка')).toBe(true);
  });

  it('marking_code_must_belong_to_product', () => {
    const barcode = '4870204000017';
    expect(markingCodeFits(`0104870204000017215abcdef93xyz`, barcode)).toBe(true);
    expect(markingCodeFits(`0104870204000024215abcdef93xyz`, barcode)).toBe(false);
    expect(markingCodeFits('01048702', barcode)).toBe(false);
  });
});
