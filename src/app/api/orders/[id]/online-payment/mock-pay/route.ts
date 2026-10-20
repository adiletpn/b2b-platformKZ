import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { payInMockGateway } from '@/lib/payments/online';

/** Демо: оплата в тестовом шлюзе вместо приложения банка. С боевым ключом — 400. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const result = await payInMockGateway(id, guard.access.companyId);

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
