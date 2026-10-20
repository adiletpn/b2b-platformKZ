import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getSalesReport } from '@/lib/pos/shift';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Отчёт продаж за день или период (раздел 4.2 ТЗ). Даты — по времени Казахстана. */
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
  const report = await getSalesReport(
    guard.access.companyId,
    new Date(`${from}T00:00:00+05:00`),
    new Date(`${to}T23:59:59.999+05:00`),
    guard.access.allowedLocationIds,
  );
  return NextResponse.json({ status: 'ok', report });
}
