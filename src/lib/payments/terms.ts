import Decimal from 'decimal.js';
import type { PaymentMethod } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

export type TermsInput = { paymentTerms: string; deferralDays: string; creditLimit: string };

export type TermsResult =
  | { status: 'ok' }
  | { status: 'invalid_terms' }
  | { status: 'invalid_days' }
  | { status: 'invalid_limit' };

const TERMS: PaymentMethod[] = ['PREPAY', 'ON_DELIVERY', 'DEFERRED'];

/**
 * Условия оплаты поставщика (разделы 3.1 и 3.6 ТЗ): предоплата, по факту или отсрочка
 * N дней, кредитный лимит на магазин. Пустой лимит — без ограничения.
 */
export async function savePaymentTerms(companyId: string, input: TermsInput): Promise<TermsResult> {
  if (!TERMS.includes(input.paymentTerms as PaymentMethod)) return { status: 'invalid_terms' };

  let deferralDays: number | null = null;
  if (input.paymentTerms === 'DEFERRED') {
    deferralDays = Number(input.deferralDays);
    if (!Number.isInteger(deferralDays) || deferralDays < 1 || deferralDays > 365) {
      return { status: 'invalid_days' };
    }
  }

  let creditLimit: string | null = null;
  if (input.creditLimit.trim()) {
    try {
      const value = new Decimal(input.creditLimit.replace(',', '.').replace(/\s/g, ''));
      // Правило 1: деньги Decimal, два знака.
      if (!value.isFinite() || value.lessThan(0) || value.decimalPlaces() > 2) {
        return { status: 'invalid_limit' };
      }
      creditLimit = value.toFixed(2);
    } catch {
      return { status: 'invalid_limit' };
    }
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { paymentTerms: input.paymentTerms as PaymentMethod, deferralDays, creditLimit },
  });
  return { status: 'ok' };
}
