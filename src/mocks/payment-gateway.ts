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

export function createGatewayPayment(
  orderNumber: string,
  amount: string,
  provider = 'kaspi',
): GatewayPayment {
  const live = Boolean(process.env.PAYMENT_API_KEY);
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
