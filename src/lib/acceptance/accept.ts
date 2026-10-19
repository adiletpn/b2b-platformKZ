import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { documentTotals, lineTotals } from '@/lib/documents/totals';
import { formatDate } from '@/lib/documents/create';
import type { DocumentLine, DocumentPayload } from '@/lib/documents/payload';
import { notify } from '@/mocks/notifications';

export type AcceptanceLine = {
  orderItemId: string;
  /** Фактически принято годного товара. */
  quantityAccepted: string;
  /** Брак и пересорт — они не приходуются на остатки и уменьшают сумму к оплате. */
  quantityDefective?: string;
  quantityMismatch?: string;
};

export type AcceptanceResult =
  | {
      status: 'ok';
      orderStatus: 'ACCEPTED_BY_STORE' | 'ACCEPTED_WITH_DISCREPANCY';
      total: string;
      discrepancyActId: string | null;
    }
  | { status: 'not_found' }
  | { status: 'wrong_status'; current: string }
  | { status: 'no_waybill' }
  | { status: 'invalid_quantity'; orderItemId: string };

/**
 * Приёмка магазином (раздел 6.2 демо-ТЗ).
 * При расхождениях создаётся акт и пересчитывается сумма к оплате.
 * Принятый товар приходуется на точку магазина документом движения — правило 3,
 * всё одной транзакцией.
 */
export async function acceptDelivery(
  orderId: string,
  storeId: string,
  userId: string,
  lines: AcceptanceLine[],
): Promise<AcceptanceResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      store: true,
      supplier: true,
      location: { include: { city: true } },
      items: { include: { offer: { include: { product: { include: { unit: true } } } } } },
      documents: true,
    },
  });
  if (!order || order.storeId !== storeId) return { status: 'not_found' };
  if (order.status !== 'DELIVERED') return { status: 'wrong_status', current: order.status };

  const waybill = order.documents.find((document) => document.type === 'WAYBILL');
  if (!waybill) return { status: 'no_waybill' };

  const byId = new Map(order.items.map((item) => [item.id, item]));
  const parsed = new Map<
    string,
    { accepted: Decimal; defective: Decimal; mismatch: Decimal; shipped: Decimal }
  >();

  for (const item of order.items) {
    const shipped = new Decimal((item.quantityConfirmed ?? item.quantityOrdered).toString());
    parsed.set(item.id, {
      accepted: shipped,
      defective: new Decimal(0),
      mismatch: new Decimal(0),
      shipped,
    });
  }

  for (const line of lines) {
    const item = byId.get(line.orderItemId);
    if (!item) return { status: 'invalid_quantity', orderItemId: line.orderItemId };

    const shipped = new Decimal((item.quantityConfirmed ?? item.quantityOrdered).toString());
    const accepted = new Decimal(line.quantityAccepted || '0');
    const defective = new Decimal(line.quantityDefective || '0');
    const mismatch = new Decimal(line.quantityMismatch || '0');

    const invalid =
      [accepted, defective, mismatch].some(
        (value) => value.isNaN() || value.isNegative() || value.decimalPlaces() > 3,
      ) || accepted.plus(defective).plus(mismatch).greaterThan(shipped);
    if (invalid) return { status: 'invalid_quantity', orderItemId: line.orderItemId };

    parsed.set(item.id, { accepted, defective, mismatch, shipped });
  }

  const acceptedInputs = order.items.map((item) => {
    const values = parsed.get(item.id)!;
    return {
      quantity: values.accepted,
      priceWithVat: new Decimal(item.priceWithVat.toString()),
      vatRateValue: new Decimal(item.vatRateValue.toString()),
    };
  });

  const totals = documentTotals(acceptedInputs);
  const hasDiscrepancy = order.items.some((item) => {
    const values = parsed.get(item.id)!;
    return !values.accepted.equals(values.shipped);
  });

  const issuedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const values = parsed.get(item.id)!;
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          quantityAccepted: values.accepted.toFixed(3),
          quantityDefective: values.defective.toFixed(3),
          quantityMismatch: values.mismatch.toFixed(3),
        },
      });
    }

    let discrepancyActId: string | null = null;

    if (hasDiscrepancy) {
      const number = await nextDocumentNumber(tx, storeId, 'discrepancy', issuedAt);
      const lineRows: DocumentLine[] = order.items.map((item, index) => {
        const values = parsed.get(item.id)!;
        const totalsForLine = lineTotals({
          quantity: values.accepted,
          priceWithVat: new Decimal(item.priceWithVat.toString()),
          vatRateValue: new Decimal(item.vatRateValue.toString()),
        });
        return {
          position: index + 1,
          nameRu: item.offer.product.nameRu,
          nameKk: item.offer.product.nameKk,
          unitRu: item.offer.product.unit.nameRu,
          unitKk: item.offer.product.unit.nameKk,
          quantity: values.accepted.toFixed(3),
          priceWithoutVat: totalsForLine.priceWithoutVat.toFixed(2),
          vatRate: item.vatRateValue.toFixed(2),
          vatAmount: totalsForLine.vatAmount.toFixed(2),
          totalWithoutVat: totalsForLine.totalWithoutVat.toFixed(2),
          totalWithVat: totalsForLine.totalWithVat.toFixed(2),
        };
      });

      const payload: DocumentPayload = {
        number,
        issuedAt: formatDate(issuedAt),
        orderNumber: order.number,
        supplier: {
          name: order.supplier.name,
          bin: order.supplier.bin,
          legalAddress: order.supplier.legalAddress,
          iik: order.supplier.iik,
          bik: order.supplier.bik,
          bankName: order.supplier.bankName,
          isVatPayer: order.supplier.isVatPayer,
        },
        store: {
          name: order.store.name,
          bin: order.store.bin,
          legalAddress: order.store.legalAddress,
          iik: order.store.iik,
          bik: order.store.bik,
          bankName: order.store.bankName,
          isVatPayer: order.store.isVatPayer,
        },
        deliveryAddress: `${order.location.city.nameRu}, ${order.location.address}`,
        lines: lineRows,
        totalWithoutVat: totals.totalWithoutVat.toFixed(2),
        vatAmount: totals.vatAmount.toFixed(2),
        totalWithVat: totals.totalWithVat.toFixed(2),
        discrepancies: order.items.map((item, index) => {
          const values = parsed.get(item.id)!;
          const price = new Decimal(item.priceWithVat.toString());
          return {
            position: index + 1,
            nameRu: item.offer.product.nameRu,
            nameKk: item.offer.product.nameKk,
            quantityShipped: values.shipped.toFixed(3),
            quantityAccepted: values.accepted.toFixed(3),
            quantityDefective: values.defective.toFixed(3),
            quantityMismatch: values.mismatch.toFixed(3),
            amountDifference: price
              .times(values.shipped.minus(values.accepted))
              .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
              .toFixed(2),
          };
        }),
      };

      const act = await tx.document.create({
        data: {
          type: 'DISCREPANCY_ACT',
          number,
          issuedAt,
          orderId: order.id,
          issuerId: storeId,
          recipientId: order.supplierId,
          totalWithoutVat: totals.totalWithoutVat.toFixed(2),
          vatAmount: totals.vatAmount.toFixed(2),
          totalWithVat: totals.totalWithVat.toFixed(2),
          payload: payload as never,
        },
      });
      discrepancyActId = act.id;
    }

    // Правило 3: остаток растёт только через движение, и всё в одной транзакции.
    for (const item of order.items) {
      const values = parsed.get(item.id)!;
      if (values.accepted.lessThanOrEqualTo(0)) continue;

      const costPrice = new Decimal(item.priceWithoutVat.toString());
      await tx.stockMovement.create({
        data: {
          locationId: order.locationId,
          productId: item.offer.productId,
          quantity: values.accepted.toFixed(3),
          costPrice: costPrice.toFixed(2),
          type: 'RECEIPT',
          documentId: waybill.id,
        },
      });

      const balance = await tx.stockBalance.findUnique({
        where: {
          locationId_productId: {
            locationId: order.locationId,
            productId: item.offer.productId,
          },
        },
      });

      if (!balance) {
        await tx.stockBalance.create({
          data: {
            locationId: order.locationId,
            productId: item.offer.productId,
            quantity: values.accepted.toFixed(3),
            averageCost: costPrice.toFixed(2),
          },
        });
        continue;
      }

      // Средневзвешенная себестоимость (раздел 4.1 ТЗ, значение по умолчанию).
      const oldQuantity = new Decimal(balance.quantity.toString());
      const oldCost = new Decimal(balance.averageCost.toString());
      const newQuantity = oldQuantity.plus(values.accepted);
      const newCost = newQuantity.isZero()
        ? costPrice
        : oldQuantity
            .times(oldCost)
            .plus(values.accepted.times(costPrice))
            .div(newQuantity)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      await tx.stockBalance.update({
        where: { id: balance.id },
        data: { quantity: newQuantity.toFixed(3), averageCost: newCost.toFixed(2) },
      });
    }

    const nextStatus: 'ACCEPTED_BY_STORE' | 'ACCEPTED_WITH_DISCREPANCY' = hasDiscrepancy
      ? 'ACCEPTED_WITH_DISCREPANCY'
      : 'ACCEPTED_BY_STORE';
    await tx.order.update({
      where: { id: order.id },
      data: { status: nextStatus, totalWithVat: totals.totalWithVat.toFixed(2) },
    });
    await tx.orderStatusLog.create({
      data: { orderId: order.id, fromStatus: order.status, toStatus: nextStatus, userId },
    });

    return { nextStatus, discrepancyActId };
  });

  await notify(
    order.supplierId,
    'order_status_changed',
    { number: order.number, status: result.nextStatus },
    order.id,
  );

  return {
    status: 'ok',
    orderStatus: result.nextStatus,
    total: totals.totalWithVat.toFixed(2),
    discrepancyActId: result.discrepancyActId,
  };
}
