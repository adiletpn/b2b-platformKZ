import { prisma } from '@/lib/prisma';
import { escapeXml, tag } from './xml';

/**
 * Выгрузка поступлений для 1С:Бухгалтерии (раздел 4.5 ТЗ) в формате CommerceML:
 * документы поступления с товарами, ценами и НДС за период.
 * TODO(open-question): состав реквизитов сверяется с бухгалтером заказчика.
 */
export async function exportReceiptsToOneC(
  companyId: string,
  from: Date,
  to: Date,
): Promise<string> {
  const documents = await prisma.document.findMany({
    // Правило 4: выгружаются только накладные, полученные этой компанией.
    where: { type: 'WAYBILL', recipientId: companyId, issuedAt: { gte: from, lte: to } },
    include: {
      issuer: { select: { name: true, bin: true } },
      recipient: { select: { name: true, bin: true } },
      order: {
        include: {
          items: {
            include: { offer: { include: { product: { include: { unit: true } } } } },
          },
        },
      },
    },
    orderBy: { issuedAt: 'asc' },
  });

  const body = documents
    .map((document) => {
      const goods = document.order.items
        .map((item) => {
          const quantity = (
            item.quantityAccepted ??
            item.quantityConfirmed ??
            item.quantityOrdered
          ).toFixed(3);
          const total = item.priceWithVat.times(quantity).toFixed(2);
          return [
            '<Товар>',
            tag('Ид', item.offer.product.barcode),
            tag('Наименование', item.offer.product.nameRu),
            tag('БазоваяЕдиница', item.offer.product.unit.nameRu),
            tag('ЦенаЗаЕдиницу', item.priceWithVat.toFixed(2)),
            tag('Количество', quantity),
            tag('Сумма', total),
            '<СтавкиНалогов><СтавкаНалога>',
            tag('Наименование', 'НДС'),
            tag('Ставка', item.vatRateValue.toFixed(2)),
            '</СтавкаНалога></СтавкиНалогов>',
            '</Товар>',
          ].join('');
        })
        .join('');

      return [
        '<Документ>',
        tag('Ид', document.id),
        tag('Номер', document.number),
        tag('Дата', document.issuedAt.toISOString().slice(0, 10)),
        tag('ХозОперация', 'Поступление товаров'),
        tag('Роль', 'Покупатель'),
        tag('Валюта', 'KZT'),
        tag('Сумма', document.totalWithVat.toFixed(2)),
        '<Контрагенты><Контрагент>',
        tag('Ид', document.issuer.bin),
        tag('Наименование', document.issuer.name),
        tag('ИНН', document.issuer.bin),
        tag('Роль', 'Поставщик'),
        '</Контрагент></Контрагенты>',
        `<Товары>${goods}</Товары>`,
        '</Документ>',
      ].join('');
    })
    .join('');

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { name: true, bin: true },
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<КоммерческаяИнформация ВерсияСхемы="2.08"',
    ` ДатаФормирования="${new Date().toISOString().slice(0, 10)}"`,
    ` Получатель="${escapeXml(company.name)}" ИНН="${escapeXml(company.bin)}">`,
    body,
    '</КоммерческаяИнформация>',
  ].join('');
}
