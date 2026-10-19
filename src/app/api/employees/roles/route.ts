import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { createCustomRole, type PermissionCell } from '@/lib/employees/roles';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const roles = await prisma.role.findMany({
    where: { OR: [{ companyId: null }, { companyId: guard.access.companyId }] },
    include: { permissions: true },
    orderBy: [{ isTemplate: 'desc' }, { code: 'asc' }],
  });

  return NextResponse.json({
    roles: roles.map((role) => ({
      id: role.id,
      code: role.code,
      nameRu: role.nameRu,
      nameKk: role.nameKk,
      isTemplate: role.isTemplate,
      permissions: role.permissions.map((permission) => ({
        section: permission.section,
        action: permission.action,
      })),
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

  const body = (await request.json().catch(() => ({}))) as {
    nameRu?: string;
    nameKk?: string;
    permissions?: PermissionCell[];
  };

  const result = await createCustomRole(guard.access.companyId, guard.access.userId, {
    nameRu: body.nameRu ?? '',
    nameKk: body.nameKk ?? '',
    permissions: body.permissions ?? [],
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
