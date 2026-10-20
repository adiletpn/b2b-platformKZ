import type { DocumentType } from '@/generated/prisma/enums';
import { qrSvg } from '@/lib/qr/qr';
import type { DocumentPayload, DocumentParty } from './payload';
import { renderTemplate } from './template-engine';

type Locale = 'ru' | 'kk';

/** Ссылка на страницу проверки документа для QR (раздел 4.4 ТЗ). */
export type PrintOptions = { verifyUrl?: string };

const LABELS = {
  ru: {
    waybillTitle: 'Накладная на отпуск запасов на сторону',
    waybillForm: 'Форма З-2',
    invoiceTitle: 'Счёт на оплату',
    actTitle: 'Акт о расхождениях при приёмке',
    returnTitle: 'Накладная на возврат товара поставщику',
    settlementTitle: 'Акт сверки взаиморасчётов',
    debit: 'Дебет',
    credit: 'Кредит',
    balance: 'Остаток',
    number: 'Номер',
    date: 'Дата',
    order: 'По заявке',
    supplier: 'Поставщик',
    store: 'Получатель',
    bin: 'БИН/ИИН',
    address: 'Адрес',
    deliveryAddress: 'Адрес доставки',
    iik: 'ИИК',
    bik: 'БИК',
    bank: 'Банк',
    position: '№',
    name: 'Наименование',
    unit: 'Ед. изм.',
    quantity: 'Кол-во',
    price: 'Цена без НДС',
    vatRate: 'НДС, %',
    vatAmount: 'Сумма НДС',
    totalWithoutVat: 'Сумма без НДС',
    totalWithVat: 'Сумма с НДС',
    totals: 'Итого',
    vatNote: 'В том числе НДС',
    notVatPayer: 'Поставщик не является плательщиком НДС',
    released: 'Отпустил',
    received: 'Получил',
    payTo: 'Оплата по реквизитам',
    shipped: 'Отгружено',
    accepted: 'Принято',
    defective: 'Брак',
    mismatch: 'Пересорт',
    difference: 'Разница суммы',
    actNote: 'Сумма к оплате уменьшена на величину расхождений',
    correction: 'Исправление',
    verify: 'Проверка документа',
    correctionReason: 'Причина',
    currency: '₸',
  },
  kk: {
    waybillTitle: 'Қорларды сыртқа босатуға арналған жүкқұжат',
    waybillForm: 'З-2 нысаны',
    invoiceTitle: 'Төлеуге арналған шот',
    actTitle: 'Қабылдау кезіндегі алшақтықтар актісі',
    returnTitle: 'Тауарды жеткізушіге қайтару жүкқұжаты',
    settlementTitle: 'Өзара есеп айырысуды салыстыру актісі',
    debit: 'Дебет',
    credit: 'Кредит',
    balance: 'Қалдық',
    number: 'Нөмірі',
    date: 'Күні',
    order: 'Өтінім бойынша',
    supplier: 'Жеткізуші',
    store: 'Алушы',
    bin: 'БСН/ЖСН',
    address: 'Мекенжайы',
    deliveryAddress: 'Жеткізу мекенжайы',
    iik: 'ЖСК',
    bik: 'БСК',
    bank: 'Банк',
    position: '№',
    name: 'Атауы',
    unit: 'Өлш. бір.',
    quantity: 'Саны',
    price: 'ҚҚС-сыз баға',
    vatRate: 'ҚҚС, %',
    vatAmount: 'ҚҚС сомасы',
    totalWithoutVat: 'ҚҚС-сыз сома',
    totalWithVat: 'ҚҚС-пен сома',
    totals: 'Жиыны',
    vatNote: 'Оның ішінде ҚҚС',
    notVatPayer: 'Жеткізуші ҚҚС төлеуші болып табылмайды',
    released: 'Босатты',
    received: 'Алды',
    payTo: 'Деректемелер бойынша төлем',
    shipped: 'Жөнелтілді',
    accepted: 'Қабылданды',
    defective: 'Ақау',
    mismatch: 'Сұрыпталмаған',
    difference: 'Сома айырмасы',
    actNote: 'Төлеуге арналған сома алшақтық мөлшеріне азайтылды',
    correction: 'Түзету',
    verify: 'Құжатты тексеру',
    correctionReason: 'Себебі',
    currency: '₸',
  },
} as const;

export const STYLES = `
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #111; margin: 0; }
  h1 { font-size: 14pt; margin: 0 0 2mm; }
  .form { font-size: 8pt; color: #555; margin-bottom: 4mm; }
  .meta { margin-bottom: 4mm; }
  .parties { display: flex; gap: 6mm; margin-bottom: 4mm; }
  .party { flex: 1; border: 0.3mm solid #999; padding: 2mm; }
  .party-label { font-size: 8pt; color: #555; }
  .party-name { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 0.3mm solid #999; padding: 1.5mm; vertical-align: top; }
  th { background: #f0f0f0; font-size: 8pt; text-align: left; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 600; }
  .note { margin-top: 3mm; font-size: 9pt; }
  .signatures { display: flex; gap: 10mm; margin-top: 10mm; font-size: 9pt; }
  .signature { flex: 1; border-top: 0.3mm solid #666; padding-top: 1.5mm; }
  .correction { border-left: 1mm solid #b45309; padding-left: 2mm; }
  .head { display: flex; justify-content: space-between; gap: 6mm; align-items: flex-start; }
  .verify { flex: none; text-align: center; font-size: 7pt; color: #555; }
  .verify svg { display: block; }
`;

/** Типы документов, у которых есть печатная форма и шаблон в редакторе. */
export const PRINTABLE_TYPES = ['WAYBILL', 'INVOICE', 'DISCREPANCY_ACT', 'RETURN_WAYBILL'] as const;
export type PrintableType = (typeof PRINTABLE_TYPES)[number];

// ---------- Стандартные шаблоны: из них начинает редактор админки ----------

function partyBlock(label: string, key: 'supplier' | 'store', locale: Locale) {
  const t = LABELS[locale];
  return `
    <div class="party">
      <div class="party-label">${label}</div>
      <div class="party-name">{{${key}.name}}</div>
      <div>${t.bin}: {{${key}.bin}}</div>
      <div>${t.address}: {{${key}.legalAddress}}</div>
      {{#${key}.requisites}}<div>{{${key}.requisites}}</div>{{/${key}.requisites}}
    </div>`;
}

function headerBlock(title: string, form: string | null, locale: Locale) {
  const t = LABELS[locale];
  return `
<div class="head">
  <div>
    <h1>${title} № {{number}}</h1>
    ${form ? `<div class="form">${form}</div>` : ''}
  </div>
  {{{blocks.qr}}}
</div>
<div class="meta">${t.date}: {{issuedAt}} · ${t.order}: {{orderNumber}}</div>
{{#correction}}<div class="meta correction">${t.correction} № {{correction.version}} · {{correction.correctedAt}}. ${t.correctionReason}: {{correction.reason}}</div>{{/correction}}
<div class="parties">
  ${partyBlock(t.supplier, 'supplier', locale)}
  ${partyBlock(t.store, 'store', locale)}
</div>
<div class="meta">${t.deliveryAddress}: {{deliveryAddress}}</div>`;
}

function linesBlock(locale: Locale) {
  const t = LABELS[locale];
  return `
<table>
  <thead>
    <tr>
      <th class="num">${t.position}</th>
      <th>${t.name}</th>
      <th>${t.unit}</th>
      <th class="num">${t.quantity}</th>
      <th class="num">${t.price}</th>
      <th class="num">${t.vatRate}</th>
      <th class="num">${t.vatAmount}</th>
      <th class="num">${t.totalWithVat}</th>
    </tr>
  </thead>
  <tbody>
    {{#lines}}
    <tr>
      <td class="num">{{position}}</td>
      <td>{{name}}</td>
      <td>{{unit}}</td>
      <td class="num">{{quantity}}</td>
      <td class="num">{{priceWithoutVat}}</td>
      <td class="num">{{vatRate}}</td>
      <td class="num">{{vatAmount}}</td>
      <td class="num">{{totalWithVat}}</td>
    </tr>
    {{/lines}}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="6">${t.totals}</td>
      <td class="num">{{vatAmount}}</td>
      <td class="num">{{totalWithVat}}</td>
    </tr>
  </tfoot>
</table>`;
}

function vatBlock(locale: Locale) {
  const t = LABELS[locale];
  return `
{{#supplier.isVatPayer}}<div class="note">${t.vatNote}: {{vatAmount}} ${t.currency}</div>{{/supplier.isVatPayer}}
{{^supplier.isVatPayer}}<div class="note">${t.notVatPayer}</div>{{/supplier.isVatPayer}}`;
}

function signaturesBlock(left: string, right: string) {
  return `
<div class="signatures">
  <div class="signature">${left}</div>
  <div class="signature">${right}</div>
</div>`;
}

/**
 * Стандартный шаблон печатной формы на выбранном языке. Он же — отправная точка
 * для редактора и запасной вариант, пока администратор не сохранил свой.
 * TODO(open-question): формы собраны по типовому виду, образцы З-2, счёта и акта не получены (TZ-demo 8.4).
 */
export function defaultTemplate(type: PrintableType, locale: Locale): string {
  const t = LABELS[locale];
  if (type === 'WAYBILL') {
    return [
      headerBlock(t.waybillTitle, t.waybillForm, locale),
      linesBlock(locale),
      vatBlock(locale),
      signaturesBlock(t.released, t.received),
    ].join('\n');
  }
  if (type === 'INVOICE') {
    return [
      headerBlock(t.invoiceTitle, null, locale),
      linesBlock(locale),
      vatBlock(locale),
      `<div class="note">${t.payTo}: {{supplier.requisitesShort}}</div>`,
    ].join('\n');
  }
  if (type === 'RETURN_WAYBILL') {
    return [
      headerBlock(t.returnTitle, null, locale),
      linesBlock(locale),
      vatBlock(locale),
      signaturesBlock(t.received, t.released),
    ].join('\n');
  }
  return [
    headerBlock(t.actTitle, null, locale),
    `
<table>
  <thead>
    <tr>
      <th class="num">${t.position}</th>
      <th>${t.name}</th>
      <th class="num">${t.shipped}</th>
      <th class="num">${t.accepted}</th>
      <th class="num">${t.defective}</th>
      <th class="num">${t.mismatch}</th>
      <th class="num">${t.difference}</th>
    </tr>
  </thead>
  <tbody>
    {{#discrepancies}}
    <tr>
      <td class="num">{{position}}</td>
      <td>{{name}}</td>
      <td class="num">{{quantityShipped}}</td>
      <td class="num">{{quantityAccepted}}</td>
      <td class="num">{{quantityDefective}}</td>
      <td class="num">{{quantityMismatch}}</td>
      <td class="num">{{amountDifference}}</td>
    </tr>
    {{/discrepancies}}
  </tbody>
</table>
<div class="note">${t.actNote}. ${t.totals}: {{totalWithVat}} ${t.currency}</div>`,
    signaturesBlock(t.released, t.received),
  ].join('\n');
}

// ---------- Данные для шаблона ----------

function partyContext(company: DocumentParty, locale: Locale) {
  const t = LABELS[locale];
  return {
    ...company,
    requisites: [
      company.iik ? `${t.iik}: ${company.iik}` : null,
      company.bik ? `${t.bik}: ${company.bik}` : null,
      company.bankName ? `${t.bank}: ${company.bankName}` : null,
    ]
      .filter(Boolean)
      .join(', '),
    requisitesShort: [company.iik, company.bik, company.bankName].filter(Boolean).join(', '),
  };
}

/**
 * Поля, доступные в шаблоне: снимок документа плюс названия и единицы на языке печати
 * и готовые блоки платформы (`blocks.qr`).
 */
export function templateContext(payload: DocumentPayload, locale: Locale, options: PrintOptions) {
  const qr = options.verifyUrl ? qrSvg(options.verifyUrl, { size: 104 }) : '';
  return {
    ...payload,
    supplier: partyContext(payload.supplier, locale),
    store: partyContext(payload.store, locale),
    lines: payload.lines.map((line) => ({
      ...line,
      name: locale === 'kk' ? line.nameKk : line.nameRu,
      unit: locale === 'kk' ? line.unitKk : line.unitRu,
    })),
    discrepancies: (payload.discrepancies ?? []).map((line) => ({
      ...line,
      name: locale === 'kk' ? line.nameKk : line.nameRu,
    })),
    correction: payload.correction ?? null,
    blocks: {
      qr: qr ? `<div class="verify">${qr}<div>${LABELS[locale].verify}</div></div>` : '',
    },
  };
}

function printableType(type: DocumentType): PrintableType {
  // Акта сверки как документа в базе нет: он строится отчётом (раздел 3.6 ТЗ).
  return (PRINTABLE_TYPES as readonly string[]).includes(type)
    ? (type as PrintableType)
    : 'DISCREPANCY_ACT';
}

/**
 * HTML печатной формы. `body` — шаблон администратора из базы; без него — стандартный.
 * Стили платформы подключаются всегда, шаблон может добавить свои через <style>.
 */
export function documentHtml(
  type: DocumentType,
  payload: DocumentPayload,
  locale: Locale,
  options: PrintOptions = {},
  body?: string,
) {
  const source = body ?? defaultTemplate(printableType(type), locale);
  const html = renderTemplate(source, templateContext(payload, locale, options));
  const title = `${payload.number}`.replace(/[<>&"]/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${STYLES}</style></head><body>${html}</body></html>`;
}
