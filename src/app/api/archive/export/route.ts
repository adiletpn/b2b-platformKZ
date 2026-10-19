import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import type { DocumentType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { searchDocuments } from '@/lib/archive/search';
import { exportDocuments } from '@/lib/archive/export';

/** Выгрузка реестра документов в Excel (раздел 4.4 ТЗ). Право EXPORT, не VIEW. */
export async function GET(request: Request) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'EXPORT');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const params = new URL(request.url).searchParams;
  const locale = params.get('locale') === 'kk' ? 'kk' : 'ru';
  const rows = await searchDocuments(guard.access.companyId, {
    type: (params.get('type') as DocumentType) || undefined,
    search: params.get('search')?.trim() || undefined,
  });

  const t = await getTranslations({ locale, namespace: 'archive' });
  const types = await getTranslations({ locale, namespace: 'documents.types' });

  const buffer = await exportDocuments(rows, {
    sheet: t('title'),
    number: t('number'),
    type: t('type'),
    date: t('date'),
    counterparty: t('counterparty'),
    order: t('order'),
    total: t('total'),
    WAYBILL: types('WAYBILL'),
    INVOICE: types('INVOICE'),
    DISCREPANCY_ACT: types('DISCREPANCY_ACT'),
    RETURN_WAYBILL: types('RETURN_WAYBILL'),
    SETTLEMENT_ACT: types('SETTLEMENT_ACT'),
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="documents.xlsx"',
    },
  });
}
