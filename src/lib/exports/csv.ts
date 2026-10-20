import { prisma } from '@/lib/prisma';
import { formatDate } from '@/lib/format';

/**
 * CSV каталога и остатков для обмена с другими системами (раздел 4.4 ТЗ).
 * RFC 4180: запятая, кавычки, CRLF; UTF-8 с BOM — иначе Excel ломает кириллицу.
 * Заголовки — машинные имена колонок: их читает программа, а не человек.
 */
const BOM = '﻿';

type Cell = string | number | boolean | null;

/**
 * Текст из карточек пишут поставщики. Ячейка, начинающаяся с «=», «+», «-», «@»,
 * в Excel станет формулой — такие значения экранируем апострофом (OWASP CSV injection).
 */
function text(value: string | null | undefined): string {
  if (!value) return '';
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: Cell): string {
  if (value === null) return '';
  const raw = String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return BOM + [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Каталог поставщика: все предложения с ценами, НДС и остатком. */
export async function catalogCsv(supplierId: string): Promise<string> {
  const offers = await prisma.supplierOffer.findMany({
    // Правило 4: только предложения своей компании.
    where: { supplierId },
    include: { product: { include: { unit: true, category: true } }, vatRate: true },
    orderBy: { product: { nameRu: 'asc' } },
  });

  return toCsv(
    [
      'barcode',
      'sku',
      'name_ru',
      'name_kk',
      'brand',
      'category',
      'unit',
      'pack_size',
      'min_batch',
      'price_without_vat',
      'vat_rate',
      'price_with_vat',
      'stock',
      'expires_at',
      'is_active',
    ],
    offers.map((offer) => [
      offer.product.barcode,
      text(offer.sku),
      text(offer.product.nameRu),
      text(offer.product.nameKk),
      text(offer.product.brand),
      offer.product.category?.code ?? '',
      offer.product.unit.code,
      offer.packSize.toFixed(3),
      offer.minBatch.toFixed(3),
      offer.priceWithoutVat.toFixed(2),
      offer.vatRate.rate.toFixed(2),
      offer.priceWithVat.toFixed(2),
      offer.stock.toFixed(3),
      offer.expiresAt ? formatDate(offer.expiresAt) : '',
      offer.isActive,
    ]),
  );
}

/**
 * Остатки компании по точкам. Сотрудник с ограничением видит только свои точки,
 * себестоимость — только при праве на закупочные цены (раздел 3.12 ТЗ).
 */
export async function stockCsv(
  companyId: string,
  options: { allowedLocationIds: string[]; withCost: boolean },
): Promise<string> {
  const balances = await prisma.stockBalance.findMany({
    where: {
      location: {
        companyId,
        ...(options.allowedLocationIds.length > 0
          ? { id: { in: options.allowedLocationIds } }
          : {}),
      },
    },
    include: { product: { include: { unit: true } }, location: { include: { city: true } } },
    orderBy: [{ location: { createdAt: 'asc' } }, { product: { nameRu: 'asc' } }],
  });

  return toCsv(
    [
      'location',
      'barcode',
      'name_ru',
      'name_kk',
      'unit',
      'quantity',
      'min_quantity',
      ...(options.withCost ? ['average_cost'] : []),
    ],
    balances.map((balance) => [
      text(`${balance.location.city.nameRu}, ${balance.location.address}`),
      balance.product.barcode,
      text(balance.product.nameRu),
      text(balance.product.nameKk),
      balance.product.unit.code,
      balance.quantity.toFixed(3),
      balance.minQuantity?.toFixed(3) ?? '',
      ...(options.withCost ? [balance.averageCost.toFixed(2)] : []),
    ]),
  );
}
