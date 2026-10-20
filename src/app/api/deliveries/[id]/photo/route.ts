import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { attachSignedWaybillPhoto } from '@/lib/deliveries/deliveries';
import { MAX_FILE_SIZE } from '@/lib/files/attachments';

/** Фото подписанной накладной от водителя (раздел 3.5 ТЗ). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DELIVERIES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  if (Number(request.headers.get('content-length') ?? '0') > MAX_FILE_SIZE + 64 * 1024) {
    return NextResponse.json({ status: 'too_large' }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ status: 'empty' }, { status: 400 });

  const { id } = await params;
  const key = form?.get('idempotencyKey');
  const result = await attachSignedWaybillPhoto({
    orderId: id,
    supplierId: guard.access.companyId,
    userId: guard.access.userId,
    fileName: file.name,
    data: new Uint8Array(await file.arrayBuffer()),
    idempotencyKey: typeof key === 'string' ? key : undefined,
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
