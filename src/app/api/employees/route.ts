import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { inviteEmployee } from '@/lib/employees/invitations';
import { prisma } from '@/lib/prisma';
import { maskPhone } from '@/lib/phone';

export async function GET() {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const [memberships, invitations] = await Promise.all([
    prisma.membership.findMany({
      where: { companyId: guard.access.companyId },
      include: { user: true, customRole: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { companyId: guard.access.companyId, status: 'PENDING' },
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({
    employees: memberships.map((membership) => ({
      id: membership.id,
      phone: membership.user.phone,
      role: membership.customRole?.code ?? membership.role,
      status: membership.status,
    })),
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      // Правило 11: номер целиком не показываем в списках.
      phone: maskPhone(invitation.phone),
      role: invitation.role.code,
      expiresAt: invitation.expiresAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json()) as { phone?: string; role?: string };
  const result = await inviteEmployee(
    guard.access.companyId,
    guard.access.userId,
    body.phone ?? '',
    body.role ?? '',
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
