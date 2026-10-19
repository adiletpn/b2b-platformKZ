/** Критерии ручных оценок из раздела 3.8 ТЗ. */
export const SUPPLIER_CRITERIA = ['quality', 'matching', 'politeness', 'packaging'] as const;
export const STORE_CRITERIA = ['acceptance', 'communication'] as const;

export type SupplierCriterion = (typeof SUPPLIER_CRITERIA)[number];
export type StoreCriterion = (typeof STORE_CRITERIA)[number];

export function criteriaFor(targetSide: 'supplier' | 'store'): readonly string[] {
  return targetSide === 'supplier' ? SUPPLIER_CRITERIA : STORE_CRITERIA;
}

/** Шкала платёжной дисциплины магазина (раздел 3.8 ТЗ). */
export type PaymentDiscipline = 'on_time' | 'delays_up_to_7' | 'frequent_delays';

export function paymentDiscipline(averageDelayDays: number): PaymentDiscipline {
  if (averageDelayDays <= 0) return 'on_time';
  if (averageDelayDays <= 7) return 'delays_up_to_7';
  return 'frequent_delays';
}
