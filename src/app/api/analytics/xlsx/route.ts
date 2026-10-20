import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';
import { parsePeriod, storeAnalytics, supplierAnalytics } from '@/lib/analytics/analytics';
import { analyticsXlsx } from '@/lib/exports/analytics-xlsx';

const LABELS = [
  'byDay',
  'byCategory',
  'abc',
  'turnover',
  'byStore',
  'byProduct',
  'fulfillment',
  'day',
  'revenue',
  'profit',
  'category',
  'product',
  'share',
  'group',
  'stock',
  'sold',
  'daysOfStock',
  'stale',
  'store',
  'orders',
  'quantity',
  'turnoverTotal',
  'fulfilled',
  'notFulfilled',
  'noCategory',
  'yes',
] as const;

/** Аналитика в Excel (этап 3 ТЗ) с теми же правами, что и экран. */
export async function GET(request: Request) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: access.companyId } });
  const storeAllowed =
    company.type !== 'SUPPLIER' && (await hasPermission(access, 'PURCHASE_PRICES', 'VIEW'));
  const supplierAllowed =
    company.type !== 'STORE' && (await hasPermission(access, 'SWIPE_ORDERS', 'VIEW'));
  if (!storeAllowed && !supplierAllowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const locale = params.get('locale') === 'kk' ? 'kk' : 'ru';
  const period = parsePeriod(params.get('from'), params.get('to'));
  const t = await getTranslations({ locale, namespace: 'analytics' });
  const labels = Object.fromEntries(LABELS.map((key) => [key, t(key)]));

  const file = await analyticsXlsx(
    storeAllowed ? await storeAnalytics(access.companyId, period, access.allowedLocationIds) : null,
    supplierAllowed ? await supplierAnalytics(access.companyId, period) : null,
    labels,
    locale,
  );
  const name = `${t('fileName')}.xlsx`;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="analytics.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
