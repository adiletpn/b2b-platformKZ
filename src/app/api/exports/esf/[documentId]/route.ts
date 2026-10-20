import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { exportEsf } from '@/lib/exports/esf';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'EXPORT');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { documentId } = await params;
  const result = await exportEsf(documentId, guard.access.companyId);
  if (result.status !== 'ok') return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const name = `эсф-${documentId.slice(0, 8)}.xml`;
  return new NextResponse(result.xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
