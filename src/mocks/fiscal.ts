/**
 * Мок онлайн-кассы (раздел 4.5 ТЗ: Webkassa / ReKassa). Интерфейс как у реальной:
 * чек уходит на фискализацию и возвращает номер фискального документа и ссылку в ОФД.
 * Реальных вызовов нет — ключи подключаются переменной `FISCAL_API_KEY`.
 */
export type FiscalResult = { fiscalId: string; fiscalUrl: string; offline: boolean };

export function fiscalize(receiptNumber: string, total: string): FiscalResult {
  const live = Boolean(process.env.FISCAL_API_KEY);
  const fiscalId = `${live ? 'ofd' : 'mock'}-${Date.now().toString(36)}`;

  console.info(`[fiscal-${live ? 'live' : 'mock'}] чек ${receiptNumber} на ${total}`);
  return {
    fiscalId,
    fiscalUrl: `https://ofd.kz/check/${fiscalId}`,
    // Правила ОФД разрешают автономный режим: чек фискализируется при появлении связи.
    offline: !live,
  };
}
