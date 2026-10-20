import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { deleteAttachment, readAttachment } from '@/lib/files/attachments';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Скачивание файла. PDF и картинки открываются в браузере, остальное — загрузкой. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'VIEW');
  if (!guard.ok) return denied(guard.status);

  const { id } = await params;
  const file = await readAttachment(id, guard.access.companyId);
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const inline = file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/');
  const asciiName = file.fileName.replace(/[^\x20-\x7E]/g, '_');
  return new NextResponse(file.data, {
    headers: {
      'content-type': file.mimeType,
      // RFC 5987: кириллица в имени файла только так.
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'DELETE');
  if (!guard.ok) return denied(guard.status);

  const { id } = await params;
  const result = await deleteAttachment(id, guard.access.companyId, guard.access.userId);
  return NextResponse.json({ status: result }, { status: result === 'ok' ? 200 : 404 });
}
