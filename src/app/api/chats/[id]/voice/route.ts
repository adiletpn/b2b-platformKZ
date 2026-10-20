import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { sendVoice } from '@/lib/chat/extras';
import { MAX_FILE_SIZE } from '@/lib/files/attachments';

/** Голосовое сообщение в переписку (раздел 3.7 ТЗ): запись MediaRecorder и её длина. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
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
  const result = await sendVoice({
    chatId: id,
    companyId: guard.access.companyId,
    userId: guard.access.userId,
    durationMs: Number(form?.get('durationMs') ?? '0'),
    data: new Uint8Array(await file.arrayBuffer()),
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
