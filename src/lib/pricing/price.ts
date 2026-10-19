import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';

/** Товар считается новинкой первые 30 дней (раздел 3.3 ТЗ, бейдж «новинка»). */
export const NEW_PRODUCT_DAYS = 30;

export type EffectivePrice = {
  offerId: string;
  /** Базовая цена предложения с НДС. */
  basePriceWithVat: string;
  /** Цена с учётом прайса, скидки от объёма и акции. */
  priceWithVat: string;
  isPromo: boolean;
  /** Скидка в процентах относительно базовой цены, 0 — скидки нет. */
  discountPercent: string;
};

type RuleRow = {
  offerId: string;
  priceWithVat: Decimal | null;
  discountPercent: Decimal | null;
  minQuantity: Decimal;
  isPromo: boolean;
  isStoreSpecific: boolean;
};

function applyRule(base: Decimal, rule: RuleRow): Decimal {
  if (rule.priceWithVat) return rule.priceWithVat.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (rule.discountPercent) {
    return base
      .times(new Decimal(100).minus(rule.discountPercent).div(100))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  return base;
}

/**
 * Цены для магазина: базовый прайс, индивидуальный прайс, скидки от объёма и акции
 * (раздел 3.2 ТЗ). Индивидуальный прайс важнее базового, среди подходящих правил
 * выигрывает самое выгодное для магазина.
 */
export async function effectivePrices(
  offers: { id: string; priceWithVat: Decimal | string; supplierId: string }[],
  storeId: string,
  quantities: Map<string, Decimal> = new Map(),
  now = new Date(),
): Promise<Map<string, EffectivePrice>> {
  const result = new Map<string, EffectivePrice>();
  if (offers.length === 0) return result;

  const rules = await prisma.priceRule.findMany({
    where: {
      offerId: { in: offers.map((offer) => offer.id) },
      OR: [{ validFrom: null }, { validFrom: { lte: now } }],
      AND: [{ OR: [{ validTo: null }, { validTo: { gte: now } }] }],
      priceList: { OR: [{ isDefault: true }, { storeIds: { has: storeId } }] },
    },
    include: { priceList: { select: { isDefault: true, storeIds: true } } },
  });

  const byOffer = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const row: RuleRow = {
      offerId: rule.offerId,
      priceWithVat: rule.priceWithVat ? new Decimal(rule.priceWithVat.toString()) : null,
      discountPercent: rule.discountPercent ? new Decimal(rule.discountPercent.toString()) : null,
      minQuantity: new Decimal(rule.minQuantity.toString()),
      isPromo: rule.isPromo,
      isStoreSpecific: rule.priceList.storeIds.includes(storeId),
    };
    byOffer.set(rule.offerId, [...(byOffer.get(rule.offerId) ?? []), row]);
  }

  for (const offer of offers) {
    const base = new Decimal(offer.priceWithVat.toString());
    const quantity = quantities.get(offer.id) ?? new Decimal(0);

    const applicable = (byOffer.get(offer.id) ?? []).filter((rule) =>
      rule.minQuantity.lessThanOrEqualTo(quantity.greaterThan(0) ? quantity : rule.minQuantity),
    );

    // Индивидуальный прайс важнее базового, дальше — меньшая цена.
    let best: { price: Decimal; rule: RuleRow | null } = { price: base, rule: null };
    for (const rule of applicable) {
      const price = applyRule(base, rule);
      const better =
        best.rule === null ||
        (rule.isStoreSpecific && !best.rule.isStoreSpecific) ||
        (rule.isStoreSpecific === best.rule.isStoreSpecific && price.lessThan(best.price));
      if (better) best = { price, rule };
    }

    const discount = base.isZero()
      ? new Decimal(0)
      : base.minus(best.price).div(base).times(100).toDecimalPlaces(2);

    result.set(offer.id, {
      offerId: offer.id,
      basePriceWithVat: base.toFixed(2),
      priceWithVat: best.price.toFixed(2),
      isPromo: best.rule?.isPromo ?? false,
      discountPercent: Decimal.max(discount, 0).toFixed(2),
    });
  }

  return result;
}

export function isNewProduct(createdAt: Date, now = new Date()) {
  return now.getTime() - createdAt.getTime() <= NEW_PRODUCT_DAYS * 24 * 60 * 60 * 1000;
}
