/**
 * SMS-провайдер Mobizon (mobizon.kz), HTTP API `message/sendSmsMessage`.
 * Ключ — `SMS_API_KEY`, имя отправителя — `SMS_SENDER` (согласуется с Mobizon заранее,
 * без него уходит с общего номера провайдера).
 *
 * TODO(open-question): провайдер выбран по умолчанию. Если заказчик возьмёт другого
 * (SMSC.kz, Kcell, Beeline), меняется только этот файл: вход — номер и текст,
 * выход — идентификатор сообщения или ошибка.
 */
const API_URL = 'https://api.mobizon.kz/service/message/sendSmsMessage';
const TIMEOUT_MS = 10_000;

export type ProviderResult = { ok: true; messageId: string } | { ok: false; reason: string };

type MobizonResponse = {
  code?: number;
  message?: string;
  data?: { messageId?: string | number; campaignId?: string | number };
};

export async function sendViaMobizon(
  phone: string,
  text: string,
  config: { apiKey: string; sender?: string },
): Promise<ProviderResult> {
  const url = `${API_URL}?output=json&api=v1&apiKey=${encodeURIComponent(config.apiKey)}`;
  const body = new URLSearchParams({
    // Mobizon ждёт номер без «+»: 77011234567.
    recipient: phone.replace(/\D/g, ''),
    text,
  });
  if (config.sender) body.set('from', config.sender);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as MobizonResponse;
    // Код 0 — сообщение принято, остальные коды — ошибка с текстом в message.
    if (!response.ok || data.code !== 0) {
      return { ok: false, reason: `http ${response.status}, code ${data.code ?? '-'}` };
    }
    return { ok: true, messageId: String(data.data?.messageId ?? data.data?.campaignId ?? '') };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'network' };
  }
}
