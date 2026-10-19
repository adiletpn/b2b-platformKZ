import { NextResponse } from 'next/server';
import { getSession, setActiveCompany } from '@/lib/auth/session';

/** Раздел 3.12 ТЗ: один пользователь работает в нескольких компаниях без повторного входа. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  // Правило 4: переключиться можно только в свою компанию.
  const membership = session.user.memberships.find(
    (item) => item.companyId === body.companyId && item.status === 'ACTIVE',
  );
  if (!membership) return NextResponse.json({ status: 'not_found' }, { status: 400 });

  await setActiveCompany(session.id, membership.companyId);
  return NextResponse.json({ status: 'ok', companyId: membership.companyId });
}
