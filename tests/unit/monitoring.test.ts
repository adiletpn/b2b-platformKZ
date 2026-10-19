import { describe, expect, it, vi } from 'vitest';
import { reportError, scrub } from '@/mocks/monitoring';

describe('мониторинг ошибок', () => {
  it('phone_and_bin_are_masked_in_error_message', () => {
    // Правило 11: ни номер, ни БИН не уходят в мониторинг целиком.
    expect(scrub('сбой у +77011234567')).toBe('сбой у +7 *** *** 67');
    expect(scrub('компания 123456789012 не найдена')).toBe('компания *** *** 012 не найдена');
    expect(scrub('без персональных данных')).toBe('без персональных данных');
  });

  it('error_event_has_fingerprint_and_context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const event = reportError(new TypeError('документ не собрался для +77019998877'), {
      path: '/api/documents',
      method: 'POST',
    });

    expect(event).not.toBeNull();
    expect(event!.fingerprint.startsWith('TypeError:')).toBe(true);
    expect(event!.message).toContain('+7 *** *** 77');
    expect(event!.message).not.toContain('77019998877');
    expect(event!.context).toEqual({ path: '/api/documents', method: 'POST' });
    expect(event!.level).toBe('error');

    spy.mockRestore();
  });

  it('non_error_values_are_reported_too', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const event = reportError('очередь недоступна');

    expect(event!.fingerprint).toBe('Error:очередь недоступна');
    expect(event!.context).toEqual({});

    spy.mockRestore();
  });
});
