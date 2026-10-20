import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { listDocumentVersions } from '@/lib/documents/versions';

/** История версий документа (раздел 4.3 ТЗ). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const versions = await listDocumentVersions(id, guard.access.companyId);
  if (!versions) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ versions });
}
