import { describe, expect, it } from 'vitest';
import { plainQuantity } from '@/lib/format';

describe('количество для поля ввода', () => {
  it('drops_trailing_zeros_but_keeps_dot', () => {
    expect(plainQuantity('12.000')).toBe('12');
    expect(plainQuantity('1.500')).toBe('1.5');
    expect(plainQuantity('0.125')).toBe('0.125');
    expect(plainQuantity('40')).toBe('40');
    expect(plainQuantity('')).toBe('');
  });
});
