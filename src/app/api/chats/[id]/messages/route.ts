import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getMessages, sendMessage } from '@/lib/chat/chat';
import { blockState } from '@/lib/chat/extras';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const chat = await getMessages(id, guard.access.companyId);
  if (!chat) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ...chat, block: await blockState(id, guard.access.companyId) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const body = (await request.json()) as { text?: string };
  const result = await sendMessage(
    id,
    guard.access.companyId,
    guard.access.userId,
    body.text ?? '',
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
