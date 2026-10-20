import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { requireAdmin } from '@/lib/admin/session';
import { buildReport, REPORT_KINDS } from '@/lib/admin/reports';
function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Отчёты админки в Excel: компании, заявки, обороты по городам (раздел 3.13 ТЗ). */
export async function GET(request: Request) {
  const guard = await requireAdmin(['SUPERADMIN', 'FINANCE']);
  if (!guard.ok) return denied(guard.status);
  const params = new URL(request.url).searchParams;
  const kind = REPORT_KINDS.find((item) => item === params.get('kind'));
  if (!kind) return NextResponse.json({ status: 'invalid_kind' }, { status: 400 });

  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  const from = params.get('from') ?? `${today.slice(0, 8)}01`;
  const to = params.get('to') ?? today;
  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ status: 'invalid_period' }, { status: 400 });
  }
  const locale = params.get('locale') === 'kk' ? 'kk' : 'ru';
  const t = await getTranslations({ locale, namespace: 'admin.reports.columns' });
  const keys = [
    'companies',
    'orders',
    'cities',
    'name',
    'bin',
    'type',
    'city',
    'status',
    'plan',
    'createdAt',
    'number',
    'date',
    'store',
    'supplier',
    'total',
    'ordersCount',
    'gmv',
  ] as const;
  const buffer = await buildReport(kind, Object.fromEntries(keys.map((key) => [key, t(key)])), {
    from: new Date(`${from}T00:00:00+05:00`),
    to: new Date(`${to}T23:59:59.999+05:00`),
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${kind}-${from}-${to}.xlsx"`,
    },
  });
}
