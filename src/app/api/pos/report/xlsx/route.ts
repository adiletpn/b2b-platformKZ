import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { requirePermission } from '@/lib/auth/permissions';
import { salesXlsx } from '@/lib/exports/reports-xlsx';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = [
  'receipts',
  'items',
  'number',
  'date',
  'location',
  'cashier',
  'payment',
  'kind',
  'discount',
  'total',
  'cost',
  'barcode',
  'product',
  'quantity',
  'price',
  'refund',
  'sale',
  'payment_CASH',
  'payment_CARD',
  'payment_QR',
  'payment_MIXED',
];

/** Продажи за период в Excel: чеки и товары (разделы 4.2 и 4.4 ТЗ). Даты — по Казахстану. */
export async function GET(request: Request) {
  const guard = await requirePermission('POS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const params = new URL(request.url).searchParams;
  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  const from = params.get('from') ?? today;
  const to = params.get('to') ?? today;
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ status: 'invalid_period' }, { status: 400 });
  }
  const locale = params.get('locale') === 'kk' ? 'kk' : 'ru';
  const t = await getTranslations({ locale, namespace: 'reportsXlsx' });
  const buffer = await salesXlsx(
    guard.access.companyId,
    { from: new Date(`${from}T00:00:00+05:00`), to: new Date(`${to}T23:59:59.999+05:00`) },
    guard.access.allowedLocationIds,
    Object.fromEntries(KEYS.map((key) => [key, t(key)])),
    locale,
  );
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="sales-${from}-${to}.xlsx"`,
    },
  });
}
