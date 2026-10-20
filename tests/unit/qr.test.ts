import { describe, expect, it } from 'vitest';
import { qrMatrix, qrSvg } from '@/lib/qr/qr';

/** Искатель 7 × 7: тёмная рамка, светлое кольцо, тёмный центр 3 × 3. */
function hasFinder(modules: boolean[][], left: number, top: number) {
  for (let dy = 0; dy < 7; dy += 1) {
    for (let dx = 0; dx < 7; dx += 1) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (modules[top + dy]![left + dx] !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe('QR-код без зависимостей', () => {
  it('qr_size_grows_with_text_length', () => {
    // Версия 1 — 21 модуль, каждая следующая на 4 больше.
    expect(qrMatrix('hi')).toHaveLength(21);
    expect(qrMatrix('x'.repeat(20))).toHaveLength(25);
    expect(qrMatrix('x'.repeat(213))).toHaveLength(57);
  });

  it('qr_has_three_finder_patterns_and_timing', () => {
    const modules = qrMatrix('https://pay.mock.kz/invoice/mock-1')!;
    const size = modules.length;

    expect(hasFinder(modules, 0, 0)).toBe(true);
    expect(hasFinder(modules, size - 7, 0)).toBe(true);
    expect(hasFinder(modules, 0, size - 7)).toBe(true);
    // Тайминговый узор: чередование в шестой строке между искателями.
    for (let x = 8; x < size - 8; x += 1) expect(modules[6]![x]).toBe(x % 2 === 0);
    // Обязательный тёмный модуль у левого нижнего искателя.
    expect(modules[size - 8]![8]).toBe(true);
  });

  it('qr_is_deterministic_and_depends_on_text', () => {
    const first = qrMatrix('ЗК-000001')!;
    expect(qrMatrix('ЗК-000001')).toEqual(first);
    expect(qrMatrix('ЗК-000002')).not.toEqual(first);
  });

  it('too_long_text_gives_nothing', () => {
    expect(qrMatrix('x'.repeat(214))).toBeNull();
    expect(qrSvg('x'.repeat(214))).toBe('');
  });

  it('svg_contains_quiet_zone_and_path', () => {
    const svg = qrSvg('https://pay.mock.kz/inv/1', { size: 100 });

    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="100"');
    // 25 модулей версии 2 плюс поле по 4 модуля с каждой стороны.
    expect(svg).toContain('viewBox="0 0 33 33"');
    expect(svg).toContain('<path fill="#000" d="M');
  });
});
