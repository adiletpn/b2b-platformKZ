import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { signDocumentByCompany } from '@/lib/documents/signature';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Подписание — отдельное действие в матрице прав (раздел 3.12 ТЗ).
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'SIGN');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const result = await signDocumentByCompany(id, guard.access.companyId, guard.access.userId);

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
