import { describe, expect, it } from 'vitest';
import { formatWhen } from '@/lib/format';

// 22.10.2026 12:00 по Алматы (UTC+5).
const NOW = new Date('2026-10-22T07:00:00Z');

describe('время заявки на карточке (D03)', () => {
  it('today_shows_time_in_kz_zone', () => {
    expect(formatWhen(new Date('2026-10-22T05:14:00Z'), 'ru', 'вчера', NOW)).toBe('10:14');
  });

  it('yesterday_shows_word', () => {
    expect(formatWhen(new Date('2026-10-21T10:00:00Z'), 'ru', 'вчера', NOW)).toBe('вчера');
  });

  it('older_shows_day_and_month', () => {
    expect(formatWhen(new Date('2026-10-19T10:00:00Z'), 'ru', 'вчера', NOW)).toBe('19 окт');
  });
});
