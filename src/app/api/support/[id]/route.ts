import { NextResponse } from 'next/server';
import { getAccess } from '@/lib/auth/permissions';
import { getTicket, replyAsCompany } from '@/lib/support/tickets';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  // Правило 4: только обращения своей компании.
  const ticket = await getTicket(id, access.companyId);
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ticket });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const result = await replyAsCompany(id, access.companyId, body.text ?? '');
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
