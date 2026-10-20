import Decimal from 'decimal.js';
import type { DocumentType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { notify } from '@/mocks/notifications';
import { documentTotals, lineTotals } from './totals';
import type { DocumentLine, DocumentParty, DocumentPayload } from './payload';
import { LONG_TRANSACTION } from '@/lib/db-tx';

export function toParty(company: {
  name: string;
  bin: string;
  legalAddress: string;
  iik: string | null;
  bik: string | null;
  bankName: string | null;
  isVatPayer: boolean;
}): DocumentParty {
  return {
    name: company.name,
    bin: company.bin,
    legalAddress: company.legalAddress,
    iik: company.iik,
    bik: company.bik,
    bankName: company.bankName,
    isVatPayer: company.isVatPayer,
  };
}

export function formatDate(date: Date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

export type CreateDocumentsResult =
  | { status: 'created'; documents: { id: string; type: DocumentType; number: string }[] }
  | { status: 'not_found' }
  | { status: 'wrong_status'; current: string }
  | { status: 'already_exists'; documents: { id: string; type: DocumentType; number: string }[] };

/**
 * Раздел 6.1 демо-ТЗ: по принятой заявке поставщик в один клик формирует
 * накладную З-2 и счёт на оплату. Нумерация отдельная у каждой компании.
 */
export async function createWaybillAndInvoice(
  orderId: string,
  supplierId: string,
): Promise<CreateDocumentsResult> {
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
  if (!order || order.supplierId !== supplierId) return { status: 'not_found' };

  // Накладную формируем по принятой заявке.
  if (order.status !== 'ACCEPTED' && order.status !== 'PICKING') {
    return { status: 'wrong_status', current: order.status };
  }

  const existing = order.documents.filter((document) => document.type !== 'DISCREPANCY_ACT');
  if (existing.length > 0) {
    return {
      status: 'already_exists',
      documents: existing.map((document) => ({
        id: document.id,
        type: document.type,
        number: document.number,
      })),
    };
  }

  const inputs = order.items.map((item) => ({
    quantity: new Decimal((item.quantityConfirmed ?? item.quantityOrdered).toString()),
    priceWithVat: new Decimal(item.priceWithVat.toString()),
    vatRateValue: new Decimal(item.vatRateValue.toString()),
  }));

  const lines: DocumentLine[] = order.items.map((item, index) => {
    const input = inputs[index]!;
    const totals = lineTotals(input);
    return {
      position: index + 1,
      nameRu: item.offer.product.nameRu,
      nameKk: item.offer.product.nameKk,
      unitRu: item.offer.product.unit.nameRu,
      unitKk: item.offer.product.unit.nameKk,
      quantity: input.quantity.toFixed(3),
      priceWithoutVat: totals.priceWithoutVat.toFixed(2),
      vatRate: input.vatRateValue.toFixed(2),
      vatAmount: totals.vatAmount.toFixed(2),
      totalWithoutVat: totals.totalWithoutVat.toFixed(2),
      totalWithVat: totals.totalWithVat.toFixed(2),
    };
  });

  const totals = documentTotals(inputs);
  const issuedAt = new Date();

  const created = await prisma.$transaction(async (tx) => {
    const result: { id: string; type: DocumentType; number: string }[] = [];

    for (const type of ['WAYBILL', 'INVOICE'] as const) {
      const number = await nextDocumentNumber(
        tx,
        supplierId,
        type === 'WAYBILL' ? 'waybill' : 'invoice',
        issuedAt,
      );

      const payload: DocumentPayload = {
        number,
        issuedAt: formatDate(issuedAt),
        orderNumber: order.number,
        supplier: toParty(order.supplier),
        store: toParty(order.store),
        deliveryAddress: `${order.location.city.nameRu}, ${order.location.address}`,
        lines,
        totalWithoutVat: totals.totalWithoutVat.toFixed(2),
        vatAmount: totals.vatAmount.toFixed(2),
        totalWithVat: totals.totalWithVat.toFixed(2),
      };

      const document = await tx.document.create({
        data: {
          type,
          number,
          issuedAt,
          orderId: order.id,
          issuerId: supplierId,
          recipientId: order.storeId,
          totalWithoutVat: totals.totalWithoutVat.toFixed(2),
          vatAmount: totals.vatAmount.toFixed(2),
          totalWithVat: totals.totalWithVat.toFixed(2),
          payload: payload as never,
        },
      });

      result.push({ id: document.id, type, number });
    }

    return result;
  }, LONG_TRANSACTION);

  await notify(
    order.storeId,
    'order_status_changed',
    { number: order.number, status: 'documents' },
    order.id,
  );

  return { status: 'created', documents: created };
}
