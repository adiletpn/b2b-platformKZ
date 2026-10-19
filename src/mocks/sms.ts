import { maskPhone } from '@/lib/phone';

/**
 * Мок SMS-провайдера. Интерфейс как у реального: send возвращает идентификатор отправки.
 * Реальной отправки нет — код показывается в интерфейсе демо.
 * Правило 11: в лог пишем только маскированный номер.
 */
export type SmsResult = { providerMessageId: string; deliveredToUi: true };

export function sendLoginCode(phone: string, code: string): SmsResult {
  console.info(`[sms-mock] код входа отправлен на ${maskPhone(phone)}`);
  void code;
  return { providerMessageId: `mock-${Date.now()}`, deliveredToUi: true };
}
