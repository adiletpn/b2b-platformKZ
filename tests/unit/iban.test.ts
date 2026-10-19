import { describe, expect, it } from 'vitest';
import { isValidBik, isValidKzIban } from '@/lib/payments/iban';

describe('реквизиты', () => {
  it('iban_accepts_valid_kazakhstan_account', () => {
    expect(isValidKzIban('KZ07HSBK123456789012')).toBe(true);
    expect(isValidKzIban('kz07hsbk123456789012')).toBe(true);
    expect(isValidKzIban('KZ07 HSBK 1234 5678 9012')).toBe(true);
  });

  it('iban_rejects_wrong_checksum', () => {
    expect(isValidKzIban('KZ08HSBK123456789012')).toBe(false);
  });

  it('iban_rejects_wrong_length_and_country', () => {
    expect(isValidKzIban('KZ07HSBK12345678901')).toBe(false);
    expect(isValidKzIban('KZ07HSBK1234567890123')).toBe(false);
    expect(isValidKzIban('RU07HSBK123456789012')).toBe(false);
    expect(isValidKzIban('')).toBe(false);
  });

  it('bik_accepts_known_format', () => {
    expect(isValidBik('HSBKKZKX')).toBe(true);
    expect(isValidBik('hsbkkzkx')).toBe(true);
    expect(isValidBik('KCJBKZKX')).toBe(true);
  });

  it('bik_rejects_wrong_format', () => {
    expect(isValidBik('HSBK')).toBe(false);
    expect(isValidBik('HSBKRUKX')).toBe(false);
    expect(isValidBik('HSBKKZKXX')).toBe(false);
  });
});
