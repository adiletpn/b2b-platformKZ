import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { tag } from './xml';

/**
 * ЭСФ в XML для ИС ЭСФ (раздел 4.5 ТЗ). Собирается подмножество реквизитов:
 * номер и дата, стороны с БИН, позиции с ТН ВЭД, ставкой и суммами НДС.
 * TODO(open-question): полную схему и подпись ЭЦП подтверждает заказчик —
 * загрузка в ИС ЭСФ в демо не проверялась, внешних вызовов нет.
 */
export type EsfResult = { status: 'ok'; xml: string } | { status: 'not_found' };

export async function exportEsf(documentId: string, companyId: string): Promise<EsfResult> {
  const document = await prisma.document.findFirst({
    // Правило 4: ЭСФ выгружает только выписавшая сторона.
    where: { id: documentId, type: 'INVOICE', issuerId: companyId },
    include: {
      issuer: { select: { name: true, bin: true, legalAddress: true, isVatPayer: true } },
      recipient: { select: { name: true, bin: true, legalAddress: true } },
      order: {
        include: {
          items: {
            include: { offer: { include: { product: { include: { unit: true } } } } },
          },
        },
      },
    },
  });
  if (!document) return { status: 'not_found' };

  const items = document.order.items
    .map((item, index) => {
      const quantity = new Decimal(
        (item.quantityAccepted ?? item.quantityConfirmed ?? item.quantityOrdered).toString(),
      );
      const withoutVat = new Decimal(item.priceWithoutVat.toString())
        .times(quantity)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const withVat = new Decimal(item.priceWithVat.toString())
        .times(quantity)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      return [
        '<invoiceItem>',
        tag('rowNumber', index + 1),
        tag('description', item.offer.product.nameRu),
        tag('tnvedCode', item.offer.product.tnvedCode ?? ''),
        tag('unitCode', item.offer.product.unit.code),
        tag('quantity', quantity.toFixed(3)),
        tag('unitPrice', item.priceWithoutVat.toFixed(2)),
        tag('turnoverSize', withoutVat.toFixed(2)),
        tag('vatRate', item.vatRateValue.toFixed(2)),
        tag('vatAmount', withVat.minus(withoutVat).toFixed(2)),
        tag('priceWithTax', withVat.toFixed(2)),
        '</invoiceItem>',
      ].join('');
    })
    .join('');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<invoice xmlns="urn:kz:esf:invoice">',
    tag('invoiceNumber', document.number),
    tag('turnoverDate', document.issuedAt.toISOString().slice(0, 10)),
    tag('currencyCode', 'KZT'),
    '<sellers><seller>',
    tag('tin', document.issuer.bin),
    tag('name', document.issuer.name),
    tag('address', document.issuer.legalAddress),
    tag('vatPayer', document.issuer.isVatPayer ? 'true' : 'false'),
    '</seller></sellers>',
    '<customers><customer>',
    tag('tin', document.recipient.bin),
    tag('name', document.recipient.name),
    tag('address', document.recipient.legalAddress),
    '</customer></customers>',
    `<invoiceItems>${items}</invoiceItems>`,
    '<totals>',
    tag('totalWithoutTax', document.totalWithoutVat.toFixed(2)),
    tag('totalTax', document.vatAmount.toFixed(2)),
    tag('totalWithTax', document.totalWithVat.toFixed(2)),
    '</totals>',
    '</invoice>',
  ].join('');

  return { status: 'ok', xml };
}
