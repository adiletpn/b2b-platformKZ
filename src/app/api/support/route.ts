import { NextResponse } from 'next/server';
import { getAccess } from '@/lib/auth/permissions';
import { createTicket, listCompanyTickets } from '@/lib/support/tickets';

/** Обращения компании в поддержку платформы: доступны любому активному сотруднику. */
export async function GET() {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ tickets: await listCompanyTickets(access.companyId) });
}

export async function POST(request: Request) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { subject?: string; text?: string };
  const result = await createTicket(access.companyId, access.userId, {
    subject: body.subject ?? '',
    text: body.text ?? '',
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
