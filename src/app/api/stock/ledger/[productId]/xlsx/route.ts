import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { requirePermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';
import { getProductLedger } from '@/lib/stock/documents';
import { ledgerXlsx } from '@/lib/exports/reports-xlsx';

const KEYS = ['ledger', 'date', 'type', 'quantity', 'costPrice', 'location', 'document', 'author'];
const TYPES = ['RECEIPT', 'ISSUE', 'WRITE_OFF', 'TRANSFER', 'INVENTORY'] as const;

/** Журнал движения по товару в Excel (раздел 4.4 ТЗ). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { productId } = await params;
  const search = new URL(request.url).searchParams;
  const locale = search.get('locale') === 'kk' ? 'kk' : 'ru';
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { nameRu: true, nameKk: true, barcode: true },
  });
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Правило 4: журнал собирается только по точкам компании пользователя.
  const entries = await getProductLedger(
    guard.access.companyId,
    productId,
    search.get('locationId') ?? undefined,
  );
  const t = await getTranslations({ locale, namespace: 'reportsXlsx' });
  const types = await getTranslations({ locale, namespace: 'stock.movementTypes' });
  const labels: Record<string, string> = Object.fromEntries(KEYS.map((key) => [key, t(key)]));
  for (const type of TYPES) labels[`type_${type}`] = types(type);

  const name = locale === 'kk' ? product.nameKk : product.nameRu;
  const buffer = await ledgerXlsx(entries, `${name} · ${product.barcode}`, labels);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="ledger-${product.barcode}.xlsx"`,
    },
  });
}
