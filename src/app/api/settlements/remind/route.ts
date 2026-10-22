import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { remindStore } from '@/lib/settlements/receivables';

/** «Напомнить» в дебиторке поставщика (макет D06). */
export async function POST(request: Request) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { storeId?: string };
  if (!body.storeId) return NextResponse.json({ status: 'nothing_due' }, { status: 400 });

  const result = await remindStore(guard.access.companyId, body.storeId);
  return NextResponse.json(result, { status: result.status === 'sent' ? 200 : 409 });
}
