import { NextResponse } from 'next/server';
import { getSession, setActiveCompany } from '@/lib/auth/session';
import { registerCompany, type RegisterCompanyInput } from '@/lib/registration/register-company';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await request.json()) as Omit<RegisterCompanyInput, 'userId'>;
  const result = await registerCompany({ ...body, userId: session.userId });

  if (result.status === 'created') {
    await setActiveCompany(session.id, result.companyId);
    return NextResponse.json(result, { status: 201 });
  }
  if (result.status === 'access_requested') return NextResponse.json(result, { status: 202 });

  return NextResponse.json(result, { status: 400 });
}
