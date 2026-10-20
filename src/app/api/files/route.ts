import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { listAttachments, MAX_FILE_SIZE, uploadAttachment } from '@/lib/files/attachments';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Файлы компании (без `orderId`) или заявки (раздел 4.3 ТЗ). */
export async function GET(request: Request) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'VIEW');
  if (!guard.ok) return denied(guard.status);

  const orderId = new URL(request.url).searchParams.get('orderId') ?? undefined;
  const files = await listAttachments(guard.access.companyId, orderId);
  if (!files) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ files });
}

/** Загрузка файла: multipart с полями file, kind, orderId и idempotencyKey. */
export async function POST(request: Request) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'CREATE');
  if (!guard.ok) return denied(guard.status);

  // Слишком большой запрос отсекается до чтения тела в память.
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_FILE_SIZE + 64 * 1024) {
    return NextResponse.json({ status: 'too_large' }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ status: 'empty' }, { status: 400 });
  }

  const orderId = form.get('orderId');
  const idempotencyKey = form.get('idempotencyKey');
  const result = await uploadAttachment({
    companyId: guard.access.companyId,
    userId: guard.access.userId,
    orderId: typeof orderId === 'string' && orderId ? orderId : undefined,
    kind: String(form.get('kind') ?? ''),
    fileName: file.name,
    data: new Uint8Array(await file.arrayBuffer()),
    idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
  });

  const status = result.status === 'ok' ? 200 : result.status === 'not_found' ? 404 : 400;
  return NextResponse.json(result, { status });
}
