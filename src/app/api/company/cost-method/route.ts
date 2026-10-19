import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';

export async function PUT(request: Request) {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { costMethod?: string };
  if (body.costMethod !== 'AVERAGE' && body.costMethod !== 'FIFO') {
    return NextResponse.json({ status: 'invalid_method' }, { status: 400 });
  }

  // Правило 4: метод меняется только у своей компании.
  await prisma.company.update({
    where: { id: guard.access.companyId },
    data: { costMethod: body.costMethod },
  });

  return NextResponse.json({ status: 'ok', costMethod: body.costMethod });
}
