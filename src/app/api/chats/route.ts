import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { listChats, openChat } from '@/lib/chat/chat';

export async function GET() {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  return NextResponse.json({ chats: await listChats(guard.access.companyId) });
}

export async function POST(request: Request) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json()) as { counterpartyId?: string; orderId?: string };
  const result = await openChat({
    companyId: guard.access.companyId,
    counterpartyId: body.counterpartyId ?? '',
    orderId: body.orderId ?? null,
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
