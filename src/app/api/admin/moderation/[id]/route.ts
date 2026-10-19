import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { decideVerification } from '@/lib/admin/moderation';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Проверка компаний доступна модератору и суперадмину (раздел 3.13 ТЗ).
  const guard = await requireAdmin(['SUPERADMIN', 'MODERATOR']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json()) as { approve?: boolean; reason?: string };
  const result = await decideVerification(guard.adminId, id, body.approve === true, body.reason);

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
