import { createTranslator } from 'next-intl';
import { maskPhone } from '@/lib/phone';
import { reportError } from '@/mocks/monitoring';
import { sendLoginCode as sendMockCode } from '@/mocks/sms';
import { sendViaMobizon } from './mobizon';
import ru from '../../../messages/ru.json';
import kk from '../../../messages/kk.json';

/**
 * Отправка кодов по SMS. Как остальные моки (CLAUDE.md, «Моки»): без `SMS_API_KEY`
 * работает мок и код показывается в интерфейсе, с ключом код уходит провайдеру
 * и в ответах API его нет — иначе войти можно было бы под чужим номером.
 */
export type SmsSendResult =
  | { ok: true; providerMessageId: string; showCodeInUi: boolean }
  | { ok: false; error: 'sms_failed' };

export function isSmsLive(): boolean {
  return Boolean(process.env.SMS_API_KEY);
}

export async function sendCodeSms(
  phone: string,
  code: string,
  locale: 'ru' | 'kk' = 'ru',
): Promise<SmsSendResult> {
  const apiKey = process.env.SMS_API_KEY;
  if (!apiKey) {
    const mock = sendMockCode(phone, code);
    return { ok: true, providerMessageId: mock.providerMessageId, showCodeInUi: true };
  }

  const t = createTranslator({ locale, messages: locale === 'kk' ? kk : ru, namespace: 'sms' });
  const result = await sendViaMobizon(phone, t('loginCode', { code }), {
    apiKey,
    sender: process.env.SMS_SENDER || undefined,
  });

  // Правило 11: номер в логе и в мониторинге только маской.
  if (!result.ok) {
    reportError(new Error(`SMS не отправлено на ${maskPhone(phone)}: ${result.reason}`), {
      provider: 'mobizon',
    });
    return { ok: false, error: 'sms_failed' };
  }
  console.info(`[sms-mobizon] код входа отправлен на ${maskPhone(phone)}`);
  return { ok: true, providerMessageId: result.messageId, showCodeInUi: false };
}
