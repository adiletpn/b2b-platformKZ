import { qrSvg } from '@/lib/qr/qr';
import type { DocumentPayload, DocumentParty } from './payload';

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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function party(label: string, company: DocumentParty, locale: Locale) {
  const t = LABELS[locale];
  const requisites = [
    company.iik ? `${t.iik}: ${escapeHtml(company.iik)}` : null,
    company.bik ? `${t.bik}: ${escapeHtml(company.bik)}` : null,
    company.bankName ? `${t.bank}: ${escapeHtml(company.bankName)}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return `
    <div class="party">
      <div class="party-label">${label}</div>
      <div class="party-name">${escapeHtml(company.name)}</div>
      <div>${t.bin}: ${escapeHtml(company.bin)}</div>
      <div>${t.address}: ${escapeHtml(company.legalAddress)}</div>
      ${requisites ? `<div>${requisites}</div>` : ''}
    </div>`;
}

const STYLES = `
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
  .correction { border-left: 1mm solid #b45309; padding-left: 2mm; }
  .head { display: flex; justify-content: space-between; gap: 6mm; align-items: flex-start; }
  .verify { flex: none; text-align: center; font-size: 7pt; color: #555; }
  .verify svg { display: block; }
  .signatures { display: flex; gap: 10mm; margin-top: 10mm; font-size: 9pt; }
  .signature { flex: 1; border-top: 0.3mm solid #666; padding-top: 1.5mm; }
`;

function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head><body>${body}</body></html>`;
}

function linesTable(payload: DocumentPayload, locale: Locale) {
  const t = LABELS[locale];
  const rows = payload.lines
    .map(
      (line) => `
      <tr>
        <td class="num">${line.position}</td>
        <td>${escapeHtml(locale === 'kk' ? line.nameKk : line.nameRu)}</td>
        <td>${escapeHtml(locale === 'kk' ? line.unitKk : line.unitRu)}</td>
        <td class="num">${line.quantity}</td>
        <td class="num">${line.priceWithoutVat}</td>
        <td class="num">${line.vatRate}</td>
        <td class="num">${line.vatAmount}</td>
        <td class="num">${line.totalWithVat}</td>
      </tr>`,
    )
    .join('');

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
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="6">${t.totals}</td>
          <td class="num">${payload.vatAmount}</td>
          <td class="num">${payload.totalWithVat}</td>
        </tr>
      </tfoot>
    </table>`;
}

function verifyBlock(locale: Locale, options: PrintOptions) {
  if (!options.verifyUrl) return '';
  const svg = qrSvg(options.verifyUrl, { size: 104 });
  if (!svg) return '';
  return `<div class="verify">${svg}<div>${LABELS[locale].verify}</div></div>`;
}

function header(
  title: string,
  form: string | null,
  payload: DocumentPayload,
  locale: Locale,
  options: PrintOptions,
) {
  const t = LABELS[locale];
  return `
    <div class="head">
      <div>
        <h1>${title} № ${escapeHtml(payload.number)}</h1>
        ${form ? `<div class="form">${form}</div>` : ''}
      </div>
      ${verifyBlock(locale, options)}
    </div>
    <div class="meta">
      ${t.date}: ${escapeHtml(payload.issuedAt)} · ${t.order}: ${escapeHtml(payload.orderNumber)}
    </div>
    ${
      payload.correction
        ? `<div class="meta correction">${t.correction} № ${payload.correction.version} ${t.date.toLowerCase()} ${escapeHtml(payload.correction.correctedAt)}. ${t.correctionReason}: ${escapeHtml(payload.correction.reason)}</div>`
        : ''
    }
    <div class="parties">
      ${party(t.supplier, payload.supplier, locale)}
      ${party(t.store, payload.store, locale)}
    </div>
    <div class="meta">${t.deliveryAddress}: ${escapeHtml(payload.deliveryAddress)}</div>`;
}

function vatNote(payload: DocumentPayload, locale: Locale) {
  const t = LABELS[locale];
  return payload.supplier.isVatPayer
    ? `<div class="note">${t.vatNote}: ${payload.vatAmount} ${t.currency}</div>`
    : `<div class="note">${t.notVatPayer}</div>`;
}

/** Накладная формы З-2 (раздел 2 ТЗ, первичные документы). */
export function waybillHtml(payload: DocumentPayload, locale: Locale, options: PrintOptions = {}) {
  const t = LABELS[locale];
  return page(
    `${t.waybillTitle} ${payload.number}`,
    `
      ${header(t.waybillTitle, t.waybillForm, payload, locale, options)}
      ${linesTable(payload, locale)}
      ${vatNote(payload, locale)}
      <div class="signatures">
        <div class="signature">${t.released}</div>
        <div class="signature">${t.received}</div>
      </div>`,
  );
}

export function invoiceHtml(payload: DocumentPayload, locale: Locale, options: PrintOptions = {}) {
  const t = LABELS[locale];
  return page(
    `${t.invoiceTitle} ${payload.number}`,
    `
      ${header(t.invoiceTitle, null, payload, locale, options)}
      ${linesTable(payload, locale)}
      ${vatNote(payload, locale)}
      <div class="note">${t.payTo}: ${escapeHtml(
        [payload.supplier.iik, payload.supplier.bik, payload.supplier.bankName]
          .filter(Boolean)
          .join(', '),
      )}</div>`,
  );
}

/** Акт расхождений: что отгрузили, что приняли, на сколько уменьшилась сумма. */
export function discrepancyActHtml(
  payload: DocumentPayload,
  locale: Locale,
  options: PrintOptions = {},
) {
  const t = LABELS[locale];
  const rows = (payload.discrepancies ?? [])
    .map(
      (line) => `
      <tr>
        <td class="num">${line.position}</td>
        <td>${escapeHtml(locale === 'kk' ? line.nameKk : line.nameRu)}</td>
        <td class="num">${line.quantityShipped}</td>
        <td class="num">${line.quantityAccepted}</td>
        <td class="num">${line.quantityDefective}</td>
        <td class="num">${line.quantityMismatch}</td>
        <td class="num">${line.amountDifference}</td>
      </tr>`,
    )
    .join('');

  return page(
    `${t.actTitle} ${payload.number}`,
    `
      ${header(t.actTitle, null, payload, locale, options)}
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
        <tbody>${rows}</tbody>
      </table>
      <div class="note">${t.actNote}. ${t.totals}: ${payload.totalWithVat} ${t.currency}</div>
      <div class="signatures">
        <div class="signature">${t.released}</div>
        <div class="signature">${t.received}</div>
      </div>`,
  );
}

/** Возвратная накладная: та же форма, другой заголовок и направление движения. */
export function returnWaybillHtml(
  payload: DocumentPayload,
  locale: Locale,
  options: PrintOptions = {},
) {
  const t = LABELS[locale];
  return page(
    `${t.returnTitle} ${payload.number}`,
    `
      ${header(t.returnTitle, null, payload, locale, options)}
      ${linesTable(payload, locale)}
      ${vatNote(payload, locale)}
      <div class="signatures">
        <div class="signature">${t.received}</div>
        <div class="signature">${t.released}</div>
      </div>`,
  );
}

export function documentHtml(
  type: 'WAYBILL' | 'INVOICE' | 'DISCREPANCY_ACT' | 'RETURN_WAYBILL' | 'SETTLEMENT_ACT',
  payload: DocumentPayload,
  locale: Locale,
  options: PrintOptions = {},
) {
  if (type === 'WAYBILL') return waybillHtml(payload, locale, options);
  if (type === 'INVOICE') return invoiceHtml(payload, locale, options);
  if (type === 'RETURN_WAYBILL') return returnWaybillHtml(payload, locale, options);
  return discrepancyActHtml(payload, locale, options);
}
