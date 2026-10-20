import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { sendElectronicReceipt } from '@/lib/pos/sale';

/** Электронный чек по SMS или WhatsApp (раздел 4.2 ТЗ). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('POS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { phone?: string; channel?: string };
  const result = await sendElectronicReceipt(
    guard.access.companyId,
    id,
    body.phone ?? '',
    body.channel === 'whatsapp' ? 'whatsapp' : 'sms',
  );
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
