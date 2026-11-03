import { sendLoginCode as sendMockCode } from '@/mocks/sms';
import { isFirebaseSmsLive } from './firebase';

/**
 * Коды по SMS. С Firebase (переменные NEXT_PUBLIC_FIREBASE_*) код отправляет и проверяет
 * Firebase в браузере, сервер его не знает и проверяет только ID-токен с номером.
 * Без Firebase работает мок, как остальные моки (CLAUDE.md, «Моки»): код генерирует
 * сервер и показывает его в интерфейсе.
 */
export type CodeDelivery = { via: 'firebase' } | { via: 'mock'; code: string };

export function isSmsLive(): boolean {
  return isFirebaseSmsLive();
}

/** Доставка кода: у Firebase его шлёт клиент, у мока код уходит в лог и в интерфейс. */
export function deliverCode(phone: string, code: string): CodeDelivery {
  if (isSmsLive()) return { via: 'firebase' };
  sendMockCode(phone, code);
  return { via: 'mock', code };
}

/**
 * Подтверждение номера: код из мока или ID-токен Firebase. Какой из двух нужен,
 * решает сервер по isSmsLive(): с Firebase голый код не принимается.
 */
export type PhoneProof = { code?: string; idToken?: string };

export function readProof(body: { code?: unknown; idToken?: unknown }): PhoneProof {
  return {
    ...(typeof body.code === 'string' ? { code: body.code } : {}),
    ...(typeof body.idToken === 'string' ? { idToken: body.idToken } : {}),
  };
}

export function hasProof(proof: PhoneProof): boolean {
  return Boolean(proof.code || proof.idToken);
}
