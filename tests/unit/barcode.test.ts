import { describe, expect, it } from 'vitest';
import { barcodeSvg, ean13Modules } from '@/lib/stock/barcode';

describe('штрихкод EAN-13 на ценнике', () => {
  it('modules_have_95_bars_with_guards', () => {
    const modules = ean13Modules('4870001000011')!;

    expect(modules).toHaveLength(95);
    expect(modules.startsWith('101')).toBe(true);
    expect(modules.endsWith('101')).toBe(true);
    // Разделитель в середине: 01010 с 45-го модуля.
    expect(modules.slice(45, 50)).toBe('01010');
  });

  it('wrong_checksum_or_length_gives_nothing', () => {
    expect(ean13Modules('4870001000012')).toBeNull();
    expect(ean13Modules('123')).toBeNull();
    expect(barcodeSvg('123')).toBe('');
  });

  it('svg_contains_bars_and_digits', () => {
    const svg = barcodeSvg('4870001000011');

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('4870001000011');
    expect(svg.split('<rect').length - 1).toBeGreaterThan(20);
  });
});
