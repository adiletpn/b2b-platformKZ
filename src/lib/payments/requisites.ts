import { prisma } from '@/lib/prisma';
import { isValidBik, isValidKzIban } from './iban';

export type RequisitesInput = { iik: string; bik: string; bankName: string };

export type RequisitesResult =
  | { status: 'ok' }
  | { status: 'invalid_iik' }
  | { status: 'invalid_bik' }
  | { status: 'invalid_bank' };

/** Раздел 3.1 ТЗ: ИИК, БИК и банк компании. Без них счёт на оплату не выставить. */
export async function saveRequisites(
  companyId: string,
  input: RequisitesInput,
): Promise<RequisitesResult> {
  const iik = input.iik.replace(/\s/g, '').toUpperCase();
  const bik = input.bik.replace(/\s/g, '').toUpperCase();
  const bankName = input.bankName.trim();

  if (!isValidKzIban(iik)) return { status: 'invalid_iik' };
  if (!isValidBik(bik)) return { status: 'invalid_bik' };
  if (bankName.length === 0) return { status: 'invalid_bank' };

  await prisma.company.update({ where: { id: companyId }, data: { iik, bik, bankName } });
  return { status: 'ok' };
}
