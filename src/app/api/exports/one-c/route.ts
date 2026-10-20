import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import {
  exportCounterpartiesToOneC,
  exportNomenclatureToOneC,
  exportPaymentsToOneC,
  exportReceiptsToOneC,
  exportSalesToOneC,
} from '@/lib/exports/one-c';

const KINDS = ['receipts', 'sales', 'payments', 'nomenclature', 'counterparties'] as const;
type Kind = (typeof KINDS)[number];

const FILE_NAMES: Record<Kind, string> = {
  receipts: 'поступления',
  sales: 'реализации',
  payments: 'оплаты',
  nomenclature: 'номенклатура',
  counterparties: 'контрагенты',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Выгрузки для 1С (раздел 4.4 ТЗ): поступления, реализации, оплаты за период,
 * номенклатура и контрагенты целиком. Период — даты Казахстана, по умолчанию текущий месяц.
 */
export async function GET(request: Request) {
  // Выгрузки — отдельное право в матрице (раздел 3.12 ТЗ).
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'EXPORT');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const params = new URL(request.url).searchParams;
  const kind = KINDS.find((item) => item === (params.get('kind') ?? 'receipts'));
  if (!kind) return NextResponse.json({ status: 'invalid_kind' }, { status: 400 });

  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  const toDay = params.get('to') ?? today;
  const fromDay = params.get('from') ?? `${toDay.slice(0, 8)}01`;
  if (!DATE.test(fromDay) || !DATE.test(toDay)) {
    return NextResponse.json({ status: 'invalid_period' }, { status: 400 });
  }
  const from = new Date(`${fromDay}T00:00:00+05:00`);
  const to = new Date(`${toDay}T23:59:59.999+05:00`);

  const companyId = guard.access.companyId;
  const xml =
    kind === 'receipts'
      ? await exportReceiptsToOneC(companyId, from, to)
      : kind === 'sales'
        ? await exportSalesToOneC(companyId, from, to)
        : kind === 'payments'
          ? // Дата оплаты хранится без времени: сравниваем по календарным дням.
            await exportPaymentsToOneC(
              companyId,
              new Date(`${fromDay}T00:00:00Z`),
              new Date(`${toDay}T00:00:00Z`),
            )
          : kind === 'nomenclature'
            ? await exportNomenclatureToOneC(companyId)
            : await exportCounterpartiesToOneC(companyId);

  const period = kind === 'nomenclature' || kind === 'counterparties' ? '' : `-${fromDay}`;
  const name = `${FILE_NAMES[kind]}${period}.xml`;

  return new NextResponse(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // RFC 5987: кириллица в имени файла только так.
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
