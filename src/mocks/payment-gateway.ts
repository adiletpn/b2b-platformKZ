import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Мок платёжного шлюза (раздел 4.5 ТЗ: Kaspi Pay, Halyk, Freedom Pay).
 * Интерфейс как у настоящего: создаём платёж, получаем ссылку и payload для QR,
 * подтверждение приходит колбэком. Реальных вызовов нет — ключ включается
 * переменной `PAYMENT_API_KEY`, тогда же подставляется адрес боевого шлюза.
 */
export type GatewayPayment = {
  provider: string;
  externalId: string;
  payUrl: string;
  qrPayload: string;
  live: boolean;
};

/** Провайдеры из раздела 4.5 ТЗ. */
export const PAYMENT_PROVIDERS = ['kaspi', 'halyk', 'freedom'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export function isLiveGateway(): boolean {
  return Boolean(process.env.PAYMENT_API_KEY);
}

export function createGatewayPayment(
  orderNumber: string,
  amount: string,
  provider = 'kaspi',
): GatewayPayment {
  const live = isLiveGateway();
  const externalId = `${live ? provider : 'mock'}-${Date.now().toString(36)}-${orderNumber}`;
  const base = live ? `https://pay.${provider}.kz` : 'https://pay.mock.kz';

  console.info(`[pay-${live ? 'live' : 'mock'}] счёт ${orderNumber} на ${amount}`);
  return {
    provider,
    externalId,
    payUrl: `${base}/invoice/${encodeURIComponent(externalId)}`,
    // В QR кладётся та же ссылка: приложение банка открывает её камерой.
    qrPayload: `${base}/invoice/${encodeURIComponent(externalId)}`,
    live,
  };
}

/**
 * Секрет подписи колбэка. Настоящий шлюз выдаёт его при подключении
 * (`PAYMENT_WEBHOOK_SECRET`); у мока — постоянный тестовый.
 */
function webhookSecret(): string | null {
  if (process.env.PAYMENT_WEBHOOK_SECRET) return process.env.PAYMENT_WEBHOOK_SECRET;
  // Боевой шлюз без секрета колбэки не принимает: иначе оплату может отметить кто угодно.
  return isLiveGateway() ? null : 'mock-gateway-webhook-secret';
}

/** Подпись колбэка: HMAC-SHA256 от идентификатора платежа и результата. */
export function signGatewayCallback(externalId: string, paid: boolean): string {
  const secret = webhookSecret() ?? '';
  return createHmac('sha256', secret)
    .update(`${externalId}:${paid ? 'paid' : 'failed'}`)
    .digest('hex');
}

export function verifyGatewayCallback(
  externalId: string,
  paid: boolean,
  signature: string | null,
): boolean {
  if (!signature || !webhookSecret()) return false;
  const expected = Buffer.from(signGatewayCallback(externalId, paid));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
