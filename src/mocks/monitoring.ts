/**
 * Мок мониторинга ошибок (НФТ раздела 5.4 ТЗ: Sentry). Интерфейс как у реального SDK:
 * событие с отпечатком, контекстом и уровнем. Реальной отправки нет — запись в лог;
 * боевой провайдер подключается ключом `MONITORING_DSN` без правок вызовов.
 *
 * Правило 11: телефоны и ИИН/БИН в сообщение целиком не попадают.
 */
export type ErrorEvent = {
  fingerprint: string;
  message: string;
  level: 'error' | 'warning';
  context: Record<string, string>;
};

const PHONE = /\+?7\d{9,10}/g;
const BIN = /\b\d{12}\b/g;

/** Из сообщения убираются номера и БИН: в мониторинг уходит только хвост. */
export function scrub(text: string): string {
  return text
    .replace(PHONE, (match) => `+7 *** *** ${match.slice(-2)}`)
    .replace(BIN, (match) => `*** *** ${match.slice(-3)}`);
}

export function reportError(
  error: unknown,
  context: Record<string, string> = {},
): ErrorEvent | null {
  const dsn = process.env.MONITORING_DSN;
  const message = scrub(error instanceof Error ? error.message : String(error));
  const name = error instanceof Error ? error.name : 'Error';

  const event: ErrorEvent = {
    // Отпечаток группирует однотипные ошибки, как это делает Sentry.
    fingerprint: `${name}:${message.slice(0, 80)}`,
    message,
    level: 'error',
    context,
  };

  // Без ключа событие остаётся в логе: внешних вызовов в демо нет.
  console.error(
    `[monitoring-${dsn ? 'live' : 'mock'}] ${event.fingerprint}`,
    Object.keys(context).length > 0 ? context : '',
  );

  return event;
}
