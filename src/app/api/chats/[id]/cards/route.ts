import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { listShareables, sendCard } from '@/lib/chat/extras';

/** Что можно отправить карточкой: товары поставщика пары и документы её заявок. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const query = new URL(request.url).searchParams.get('q') ?? '';
  const result = await listShareables(id, guard.access.companyId, query);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}

/** Карточка товара или документ в чат (раздел 3.7 ТЗ). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const body = (await request.json()) as { offerId?: string; documentId?: string };
  const result = await sendCard({
    chatId: id,
    companyId: guard.access.companyId,
    userId: guard.access.userId,
    offerId: typeof body.offerId === 'string' ? body.offerId : undefined,
    documentId: typeof body.documentId === 'string' ? body.documentId : undefined,
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
