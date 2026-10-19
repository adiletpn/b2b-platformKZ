import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { LONG_TRANSACTION } from '@/lib/db-tx';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { notify } from '@/mocks/notifications';
import { documentTotals, lineTotals } from './totals';
import { formatDate } from './create';
import type { DocumentLine, DocumentPayload } from './payload';

export type ReturnLine = { orderItemId: string; quantity: string };

export type ReturnResult =
  | { status: 'ok'; documentId: string; number: string; total: string }
  | { status: 'not_found' }
  | { status: 'nothing_to_return' }
  | { status: 'invalid_quantity'; orderItemId: string }
  | { status: 'wrong_status'; current: string };

/**
 * Возврат товара поставщику (раздел 3.5 ТЗ): возвратная накладная по той же логике,
 * остаток магазина уменьшается документом движения — правило 3.
 */
export async function createReturn(
  orderId: string,
  storeId: string,
  userId: string,
  lines: ReturnLine[],
): Promise<ReturnResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      store: true,
      supplier: true,
      location: { include: { city: true } },
      items: { include: { offer: { include: { product: { include: { unit: true } } } } } },
    },
  });
  if (!order || order.storeId !== storeId) return { status: 'not_found' };

  // Возвращать можно только принятый товар.
  const accepted = [
    'ACCEPTED_BY_STORE',
    'ACCEPTED_WITH_DISCREPANCY',
    'AWAITING_PAYMENT',
    'OVERDUE',
    'PAID',
    'CLOSED',
  ];
  if (!accepted.includes(order.status)) return { status: 'wrong_status', current: order.status };

  const byId = new Map(order.items.map((item) => [item.id, item]));
  const returns = new Map<string, Decimal>();

  for (const line of lines) {
    const item = byId.get(line.orderItemId);
    if (!item) return { status: 'invalid_quantity', orderItemId: line.orderItemId };

    const quantity = new Decimal(line.quantity || '0');
    const acceptedQuantity = new Decimal((item.quantityAccepted ?? 0).toString());
    if (quantity.isNaN() || quantity.isNegative() || quantity.greaterThan(acceptedQuantity)) {
      return { status: 'invalid_quantity', orderItemId: line.orderItemId };
    }
    if (quantity.greaterThan(0)) returns.set(item.id, quantity);
  }

  if (returns.size === 0) return { status: 'nothing_to_return' };

  const inputs = [...returns.entries()].map(([itemId, quantity]) => {
    const item = byId.get(itemId)!;
    return {
      quantity,
      priceWithVat: new Decimal(item.priceWithVat.toString()),
      vatRateValue: new Decimal(item.vatRateValue.toString()),
    };
  });
  const totals = documentTotals(inputs);
  const issuedAt = new Date();

  const document = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, storeId, 'return', issuedAt);

    const rows: DocumentLine[] = [...returns.entries()].map(([itemId, quantity], index) => {
      const item = byId.get(itemId)!;
      const line = lineTotals({
        quantity,
        priceWithVat: new Decimal(item.priceWithVat.toString()),
        vatRateValue: new Decimal(item.vatRateValue.toString()),
      });
      return {
        position: index + 1,
        nameRu: item.offer.product.nameRu,
        nameKk: item.offer.product.nameKk,
        unitRu: item.offer.product.unit.nameRu,
        unitKk: item.offer.product.unit.nameKk,
        quantity: quantity.toFixed(3),
        priceWithoutVat: line.priceWithoutVat.toFixed(2),
        vatRate: item.vatRateValue.toFixed(2),
        vatAmount: line.vatAmount.toFixed(2),
        totalWithoutVat: line.totalWithoutVat.toFixed(2),
        totalWithVat: line.totalWithVat.toFixed(2),
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
      lines: rows,
      totalWithoutVat: totals.totalWithoutVat.toFixed(2),
      vatAmount: totals.vatAmount.toFixed(2),
      totalWithVat: totals.totalWithVat.toFixed(2),
    };

    const created = await tx.document.create({
      data: {
        type: 'RETURN_WAYBILL',
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

    // Правило 3: остаток уменьшается документом движения, в той же транзакции.
    for (const [itemId, quantity] of returns) {
      const item = byId.get(itemId)!;
      await tx.stockMovement.create({
        data: {
          locationId: order.locationId,
          productId: item.offer.productId,
          quantity: quantity.negated().toFixed(3),
          costPrice: item.priceWithoutVat,
          type: 'ISSUE',
          documentId: created.id,
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
      if (balance) {
        await tx.stockBalance.update({
          where: { id: balance.id },
          data: {
            quantity: Decimal.max(
              new Decimal(balance.quantity.toString()).minus(quantity),
              0,
            ).toFixed(3),
          },
        });
      }
    }

    await tx.orderStatusLog.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        userId,
        comment: `возврат ${number}`,
      },
    });

    return created;
  }, LONG_TRANSACTION);

  await notify(order.supplierId, 'order_status_changed', {
    number: order.number,
    status: 'return',
  });

  return {
    status: 'ok',
    documentId: document.id,
    number: document.number,
    total: totals.totalWithVat.toFixed(2),
  };
}

export type DiscrepancyDecisionResult =
  | { status: 'ok'; decision: 'CONFIRMED' | 'DISPUTED' }
  | { status: 'not_found' }
  | { status: 'already_decided' }
  | { status: 'reason_required' };

/** Поставщик подтверждает или оспаривает акт расхождений (раздел 3.5 ТЗ). */
export async function decideDiscrepancyAct(
  documentId: string,
  supplierId: string,
  userId: string,
  confirm: boolean,
  reason?: string,
): Promise<DiscrepancyDecisionResult> {
  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document || document.type !== 'DISCREPANCY_ACT' || document.recipientId !== supplierId) {
    return { status: 'not_found' };
  }
  if (document.decision !== 'PENDING') return { status: 'already_decided' };
  if (!confirm && !reason?.trim()) return { status: 'reason_required' };

  const decision = confirm ? 'CONFIRMED' : 'DISPUTED';

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: documentId },
      data: { decision, decisionReason: reason?.trim() || null, decidedAt: new Date() },
    });

    // Оспаривание открывает спор по заявке (раздел 5.2 ТЗ).
    if (!confirm) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: document.orderId } });
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'DISPUTE', disputeReason: reason?.trim() ?? null },
      });
      await tx.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'DISPUTE',
          userId,
          comment: reason?.trim() ?? null,
        },
      });
    }
  });

  await notify(document.issuerId, 'order_status_changed', {
    number: document.number,
    status: decision,
  });

  return { status: 'ok', decision };
}
