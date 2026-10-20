import { createHash } from 'node:crypto';

/**
 * Мок подписи ЭЦП (раздел 4.5 ТЗ: NCALayer, eGov mobile / SIGEX).
 * Интерфейс как у настоящего: на вход документ и подписант, на выходе сертификат
 * и значение подписи. Криптографии нет — значение детерминированно считается от данных,
 * боевой провайдер подключается ключом `ECP_PROVIDER_URL`.
 */
export type Signature = { certificate: string; signature: string; live: boolean };

export function signDocument(documentNumber: string, bin: string, signer: string): Signature {
  const live = Boolean(process.env.ECP_PROVIDER_URL);
  const signature = createHash('sha256')
    .update(`${documentNumber}:${bin}:${signer}`)
    .digest('base64');

  console.info(`[ecp-${live ? 'live' : 'mock'}] подписан документ ${documentNumber}`);
  return {
    // Номер сертификата в демо условный: реальный приходит из НУЦ РК.
    certificate: `${live ? 'NCA' : 'MOCK'}-${bin.slice(0, 6)}-${documentNumber}`,
    signature,
    live,
  };
}
