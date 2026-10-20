import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import type { DocumentPayload } from '@/lib/documents/payload';
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

  return envelope(companyId, body);
}

/** Шапка CommerceML: кто выгружает и когда. Общая для всех выгрузок в 1С. */
async function envelope(companyId: string, body: string): Promise<string> {
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

type Requisites = {
  name: string;
  bin: string;
  legalAddress: string;
  iik: string | null;
  bik: string | null;
  bankName: string | null;
  isVatPayer: boolean;
};

function counterparty(company: Requisites, role: string) {
  return [
    '<Контрагент>',
    tag('Ид', company.bin),
    tag('Наименование', company.name),
    tag('ПолноеНаименование', company.name),
    tag('ИНН', company.bin),
    tag('Роль', role),
    company.legalAddress
      ? `<ЮридическийАдрес>${tag('Представление', company.legalAddress)}</ЮридическийАдрес>`
      : '',
    company.iik
      ? [
          '<РасчетныеСчета><РасчетныйСчет>',
          tag('НомерСчета', company.iik),
          `<Банк>${tag('Наименование', company.bankName)}${tag('БИК', company.bik)}</Банк>`,
          '</РасчетныйСчет></РасчетныеСчета>',
        ].join('')
      : '',
    tag('ПлательщикНДС', company.isVatPayer ? 'true' : 'false'),
    '</Контрагент>',
  ].join('');
}

/**
 * Номенклатура компании (раздел 4.4 ТЗ): товары своего каталога у поставщика и
 * товары на остатках у магазина, с группами-категориями, штрихкодом и НДС.
 * TODO(open-question): состав реквизитов сверяется с бухгалтером заказчика.
 */
export async function exportNomenclatureToOneC(companyId: string): Promise<string> {
  // Правило 4: только свои предложения и свои остатки.
  const [offers, balances] = await Promise.all([
    prisma.supplierOffer.findMany({
      where: { supplierId: companyId },
      select: { productId: true, sku: true, vatRate: { select: { rate: true } } },
    }),
    prisma.stockBalance.findMany({
      where: { location: { companyId } },
      select: { productId: true },
    }),
  ]);
  const offerByProduct = new Map(offers.map((offer) => [offer.productId, offer]));
  const productIds = [
    ...new Set([...offerByProduct.keys(), ...balances.map((row) => row.productId)]),
  ];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { unit: true, category: true },
    orderBy: { nameRu: 'asc' },
  });

  const categories = new Map(
    products.flatMap((product) =>
      product.category ? [[product.category.code, product.category]] : [],
    ),
  );
  const groups = [...categories.values()]
    .map(
      (category) =>
        `<Группа>${tag('Ид', category.code)}${tag('Наименование', category.nameRu)}</Группа>`,
    )
    .join('');

  const goods = products
    .map((product) => {
      const offer = offerByProduct.get(product.id);
      return [
        '<Товар>',
        tag('Ид', product.barcode),
        tag('Штрихкод', product.barcode),
        tag('Артикул', offer?.sku),
        tag('Наименование', product.nameRu),
        tag('НаименованиеКаз', product.nameKk),
        tag('БазоваяЕдиница', product.unit.nameRu),
        product.category ? `<Группы>${tag('Ид', product.category.code)}</Группы>` : '',
        tag('Изготовитель', product.manufacturer),
        tag('Страна', product.country),
        tag('КодТНВЭД', product.tnvedCode),
        offer
          ? `<СтавкиНалогов><СтавкаНалога>${tag('Наименование', 'НДС')}${tag('Ставка', offer.vatRate.rate.toFixed(2))}</СтавкаНалога></СтавкиНалогов>`
          : '',
        '</Товар>',
      ].join('');
    })
    .join('');

  return envelope(
    companyId,
    [
      `<Классификатор>${tag('Ид', `nomenclature-${companyId}`)}${tag('Наименование', 'Номенклатура')}`,
      `<Группы>${groups}</Группы></Классификатор>`,
      `<Каталог>${tag('Ид', `catalog-${companyId}`)}${tag('Наименование', 'Номенклатура')}`,
      `<Товары>${goods}</Товары></Каталог>`,
    ].join(''),
  );
}

/** Контрагенты: все компании, с которыми были заявки, с реквизитами для платёжек. */
export async function exportCounterpartiesToOneC(companyId: string): Promise<string> {
  const orders = await prisma.order.findMany({
    where: {
      OR: [{ storeId: companyId }, { supplierId: companyId }],
      status: { not: 'DRAFT' },
    },
    select: { storeId: true, supplierId: true, store: true, supplier: true },
  });

  const parties = new Map<string, { company: Requisites; role: string }>();
  for (const order of orders) {
    if (order.storeId === companyId) {
      parties.set(order.supplierId, { company: order.supplier, role: 'Поставщик' });
    } else {
      parties.set(order.storeId, { company: order.store, role: 'Покупатель' });
    }
  }
  const list = [...parties.values()]
    .sort((a, b) => a.company.name.localeCompare(b.company.name, 'ru'))
    .map((party) => counterparty(party.company, party.role))
    .join('');

  return envelope(
    companyId,
    `<Классификатор>${tag('Ид', `counterparties-${companyId}`)}${tag('Наименование', 'Контрагенты')}<Контрагенты>${list}</Контрагенты></Классификатор>`,
  );
}

/**
 * Реализации за период: накладные, выписанные компанией магазинам, и закрытые смены
 * кассы как отчёт о розничных продажах.
 * TODO(open-question): вид документа 1С для розницы (отчёт о розничных продажах или
 * реализация на розничного покупателя) уточняется у бухгалтера заказчика.
 */
export async function exportSalesToOneC(companyId: string, from: Date, to: Date): Promise<string> {
  const [waybills, shifts] = await Promise.all([
    prisma.document.findMany({
      // Правило 4: продавец — эта компания.
      where: { type: 'WAYBILL', issuerId: companyId, issuedAt: { gte: from, lte: to } },
      include: { recipient: true },
      orderBy: { issuedAt: 'asc' },
    }),
    prisma.posShift.findMany({
      where: { companyId, status: 'CLOSED', closedAt: { gte: from, lte: to } },
      include: {
        location: { include: { city: true } },
        receipts: { include: { items: { include: { product: { include: { unit: true } } } } } },
      },
      orderBy: { closedAt: 'asc' },
    }),
  ]);

  const sales = waybills
    .map((document) => {
      const payload = document.payload as unknown as DocumentPayload;
      const goods = payload.lines
        .map((line) =>
          [
            '<Товар>',
            tag('Наименование', line.nameRu),
            tag('БазоваяЕдиница', line.unitRu),
            tag('ЦенаЗаЕдиницу', line.priceWithoutVat),
            tag('Количество', line.quantity),
            tag('Сумма', line.totalWithVat),
            `<СтавкиНалогов><СтавкаНалога>${tag('Наименование', 'НДС')}${tag('Ставка', line.vatRate)}</СтавкаНалога></СтавкиНалогов>`,
            `<Налоги><Налог>${tag('Наименование', 'НДС')}${tag('Сумма', line.vatAmount)}</Налог></Налоги>`,
            '</Товар>',
          ].join(''),
        )
        .join('');
      return [
        '<Документ>',
        tag('Ид', document.id),
        tag('Номер', document.number),
        tag('Дата', document.issuedAt.toISOString().slice(0, 10)),
        tag('ХозОперация', 'Отпуск товара'),
        tag('Роль', 'Продавец'),
        tag('Валюта', 'KZT'),
        tag('Сумма', document.totalWithVat.toFixed(2)),
        `<Контрагенты>${counterparty(document.recipient, 'Покупатель')}</Контрагенты>`,
        `<Товары>${goods}</Товары>`,
        '</Документ>',
      ].join('');
    })
    .join('');

  const retail = shifts
    .map((shift) => {
      // Продажа и возврат по одному товару сворачиваются в итог смены.
      const totals = new Map<
        string,
        { name: string; unit: string; quantity: Decimal; sum: Decimal }
      >();
      for (const receipt of shift.receipts) {
        const sign = receipt.refundOf ? -1 : 1;
        for (const item of receipt.items) {
          const row = totals.get(item.product.barcode) ?? {
            name: item.product.nameRu,
            unit: item.product.unit.nameRu,
            quantity: new Decimal(0),
            sum: new Decimal(0),
          };
          row.quantity = row.quantity.plus(new Decimal(item.quantity.toString()).times(sign));
          row.sum = row.sum.plus(new Decimal(item.total.toString()).times(sign));
          totals.set(item.product.barcode, row);
        }
      }
      const shiftTotal = [...totals.values()].reduce(
        (sum, row) => sum.plus(row.sum),
        new Decimal(0),
      );
      const goods = [...totals.entries()]
        .map(([barcode, row]) =>
          [
            '<Товар>',
            tag('Ид', barcode),
            tag('Наименование', row.name),
            tag('БазоваяЕдиница', row.unit),
            tag('Количество', row.quantity.toFixed(3)),
            tag('Сумма', row.sum.toFixed(2)),
            '</Товар>',
          ].join(''),
        )
        .join('');
      return [
        '<Документ>',
        tag('Ид', shift.id),
        tag('Номер', shift.number),
        tag('Дата', (shift.closedAt ?? shift.openedAt).toISOString().slice(0, 10)),
        tag('ХозОперация', 'Отчет о розничных продажах'),
        tag('Роль', 'Продавец'),
        tag('Валюта', 'KZT'),
        tag('Сумма', shiftTotal.toFixed(2)),
        tag('Склад', `${shift.location.city.nameRu}, ${shift.location.address}`),
        `<Товары>${goods}</Товары>`,
        '</Документ>',
      ].join('');
    })
    .join('');

  return envelope(companyId, sales + retail);
}

/** Оплаты за период: магазин платит поставщику, поставщик получает. */
export async function exportPaymentsToOneC(
  companyId: string,
  from: Date,
  to: Date,
): Promise<string> {
  const payments = await prisma.payment.findMany({
    where: {
      status: 'PAID',
      paidAt: { gte: from, lte: to },
      // Правило 4: только оплаты по своим заявкам.
      order: { OR: [{ storeId: companyId }, { supplierId: companyId }] },
    },
    include: { order: { include: { store: true, supplier: true } } },
    orderBy: { paidAt: 'asc' },
  });

  const body = payments
    .map((payment) => {
      const outgoing = payment.order.storeId === companyId;
      return [
        '<Документ>',
        tag('Ид', payment.id),
        tag('Номер', payment.reference ?? payment.id.slice(-8)),
        tag('Дата', payment.paidAt.toISOString().slice(0, 10)),
        tag('ХозОперация', 'Выплата безналичных денег'),
        tag('Роль', outgoing ? 'Покупатель' : 'Продавец'),
        tag('Валюта', 'KZT'),
        tag('Сумма', payment.amount.toFixed(2)),
        tag('Основание', payment.order.number),
        `<Контрагенты>${
          outgoing
            ? counterparty(payment.order.supplier, 'Продавец')
            : counterparty(payment.order.store, 'Покупатель')
        }</Контрагенты>`,
        '</Документ>',
      ].join('');
    })
    .join('');

  return envelope(companyId, body);
}
