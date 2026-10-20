import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { exportReceiptsToOneC } from '@/lib/exports/one-c';

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
  const to = params.get('to') ? new Date(`${params.get('to')}T23:59:59.999Z`) : new Date();
  const from = params.get('from')
    ? new Date(`${params.get('from')}T00:00:00.000Z`)
    : new Date(to.getFullYear(), to.getMonth(), 1);

  const xml = await exportReceiptsToOneC(guard.access.companyId, from, to);
  const name = `поступления-${from.toISOString().slice(0, 10)}.xml`;

  return new NextResponse(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // RFC 5987: кириллица в имени файла только так.
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
