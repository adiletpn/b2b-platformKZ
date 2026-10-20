import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import type { DocumentType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { appBaseUrl } from '@/lib/documents/verification';
import { buildDocumentsBundle } from '@/lib/exports/bundle';

export const maxDuration = 300;

const TYPES: DocumentType[] = [
  'WAYBILL',
  'INVOICE',
  'DISCREPANCY_ACT',
  'RETURN_WAYBILL',
  'SETTLEMENT_ACT',
];

/** Документы за период одним ZIP-архивом (раздел 4.4 ТЗ). Право EXPORT. */
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
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ status: 'invalid_period' }, { status: 400 });
  }
  const typeParam = params.get('type');
  const type = TYPES.find((item) => item === typeParam);

  const t = await getTranslations({ locale, namespace: 'archive' });
  const types = await getTranslations({ locale, namespace: 'documents.types' });
  const result = await buildDocumentsBundle({
    companyId: guard.access.companyId,
    // Период задаётся датами Казахстана (UTC+5).
    from: new Date(`${from}T00:00:00+05:00`),
    to: new Date(`${to}T23:59:59.999+05:00`),
    type,
    locale,
    baseUrl: appBaseUrl(request),
    labels: {
      types: Object.fromEntries(TYPES.map((item) => [item, types(item)])) as Record<
        DocumentType,
        string
      >,
      registry: {
        sheet: t('bundleRegistry'),
        number: t('number'),
        type: t('type'),
        date: t('date'),
        counterparty: t('counterparty'),
        order: t('order'),
        total: t('total'),
      },
      esf: t('bundleEsf'),
    },
  });

  if (result.status !== 'ok') {
    return NextResponse.json(result, { status: result.status === 'empty' ? 404 : 400 });
  }

  const name = `${t('bundleFile')}-${from}-${to}.zip`;
  return new NextResponse(new Uint8Array(result.zip), {
    headers: {
      'content-type': 'application/zip',
      // RFC 5987: кириллица в имени файла только так.
      'content-disposition': `attachment; filename="documents-${from}-${to}.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
