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

/**
 * Электронный чек по SMS или WhatsApp (раздел 4.2 ТЗ). Мок: в лог пишется только маска
 * номера и канал, ссылка на чек в ОФД уходит покупателю у настоящего провайдера.
 */
export function sendReceiptLink(
  phone: string,
  channel: 'sms' | 'whatsapp',
  link: string,
): SmsResult {
  console.info(`[${channel}-mock] электронный чек отправлен на ${maskPhone(phone)}`);
  void link;
  return { providerMessageId: `mock-${Date.now()}`, deliveredToUi: true };
}
