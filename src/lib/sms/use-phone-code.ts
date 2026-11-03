'use client';

import { useCallback, useRef } from 'react';
import { useLocale } from 'next-intl';
import type { ConfirmationResult } from 'firebase/auth';

/**
 * Общий шаг «код по SMS» для входа, админки, кассы и передачи прав Владельца.
 * Сервер сначала проверяет, можно ли слать код, и отвечает via: 'firebase' или 'mock'.
 * С Firebase код отправляет браузер, а на сервер уходит ID-токен; у мока — сам код.
 */
export type CodeTicket = { via?: 'firebase' | 'mock'; phone: string };
export type PhoneProof = { code: string } | { idToken: string };
export type PhoneCodeError =
  'invalid' | 'expired' | 'too_many_requests' | 'invalid_phone' | 'sms_failed';

export function usePhoneCode() {
  const locale = useLocale();
  const confirmation = useRef<ConfirmationResult | null>(null);

  /** Вызывается после ответа сервера на запрос кода. */
  const send = useCallback(
    async (ticket: CodeTicket): Promise<{ ok: true } | { ok: false; error: PhoneCodeError }> => {
      confirmation.current = null;
      if (ticket.via !== 'firebase') return { ok: true };
      const { sendFirebaseCode } = await import('./firebase-client');
      const sent = await sendFirebaseCode(ticket.phone, locale);
      if (!sent.ok) return sent;
      confirmation.current = sent.confirmation;
      return { ok: true };
    },
    [locale],
  );

  /** Введённый код превращается в то, что ждёт сервер. */
  const prove = useCallback(
    async (
      code: string,
    ): Promise<{ ok: true; proof: PhoneProof } | { ok: false; error: PhoneCodeError }> => {
      if (!confirmation.current) return { ok: true, proof: { code: code.trim() } };
      const { confirmFirebaseCode } = await import('./firebase-client');
      const confirmed = await confirmFirebaseCode(confirmation.current, code, locale);
      if (!confirmed.ok) return confirmed;
      confirmation.current = null;
      return { ok: true, proof: { idToken: confirmed.idToken } };
    },
    [locale],
  );

  return { send, prove };
}
