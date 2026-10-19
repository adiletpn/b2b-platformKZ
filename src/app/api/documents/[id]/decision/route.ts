import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { decideDiscrepancyAct } from '@/lib/documents/returns';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json()) as { confirm?: boolean; reason?: string };
  const result = await decideDiscrepancyAct(
    id,
    guard.access.companyId,
    guard.access.userId,
    body.confirm === true,
    body.reason,
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
