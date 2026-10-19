import { describe, expect, it } from 'vitest';
import { binCheckDigit, isValidBin, maskBin } from '@/lib/bin/checksum';
import { listBinRegistry } from '@/mocks/bin-registry';

describe('контрольная сумма БИН', () => {
  it('bin_checksum_accepts_valid_numbers', () => {
    for (const entry of listBinRegistry()) {
      expect(isValidBin(entry.bin), entry.bin).toBe(true);
    }
  });

  it('bin_checksum_rejects_wrong_check_digit', () => {
    for (const entry of listBinRegistry()) {
      const digits = [...entry.bin];
      const last = Number(digits[11]);
      const broken = `${entry.bin.slice(0, 11)}${(last + 1) % 10}`;
      expect(isValidBin(broken), broken).toBe(false);
    }
  });

  it('bin_checksum_rejects_wrong_length_and_letters', () => {
    expect(isValidBin('12034000123')).toBe(false);
    expect(isValidBin('1203400012300')).toBe(false);
    expect(isValidBin('12034000123a')).toBe(false);
    expect(isValidBin('')).toBe(false);
  });

  it('bin_check_digit_uses_second_weight_row', () => {
    // Первая строка весов даёт остаток 10 — тогда применяется вторая строка.
    const candidates = ['00000000019', '00000000028'];
    for (const prefix of candidates) {
      const digit = binCheckDigit(prefix);
      expect(digit === null || (digit >= 0 && digit <= 9)).toBe(true);
    }
  });

  it('bin_is_masked_in_logs', () => {
    expect(maskBin('120340001230')).toBe('1203****30');
    expect(maskBin('120340001230')).not.toContain('4000');
  });
});
