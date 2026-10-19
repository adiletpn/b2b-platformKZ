import { describe, expect, it } from 'vitest';
import { formatPhone, maskPhone, normalizePhone } from '@/lib/phone';

describe('телефон', () => {
  it('phone_normalizes_kazakhstan_formats', () => {
    expect(normalizePhone('+7 701 234 56 78')).toBe('+77012345678');
    expect(normalizePhone('8 (701) 234-56-78')).toBe('+77012345678');
    expect(normalizePhone('7012345678')).toBe('+77012345678');
  });

  it('phone_rejects_invalid_input', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('+7 601 234 56 78')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('phone_formats_for_display', () => {
    expect(formatPhone('+77012345678')).toBe('+7 (701) 234-56-78');
  });

  it('phone_is_masked_in_logs', () => {
    const masked = maskPhone('+77012345678');
    expect(masked).toBe('+7 *** *** 78');
    expect(masked).not.toContain('7012345');
  });
});
