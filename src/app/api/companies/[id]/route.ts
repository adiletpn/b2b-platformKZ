import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireMembership } from '@/lib/auth/membership';
import { prisma } from '@/lib/prisma';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  // Правило 4: чужая компания не отдаётся, и её существование не раскрывается.
  const membership = await requireMembership(session.userId, id);
  if (!membership) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      locations: { include: { city: true } },
      deliveryZones: { include: { city: true } },
    },
  });
  if (!company) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(company);
}
