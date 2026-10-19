import { NextResponse } from 'next/server';
import { requireAdmin, writeAdminAudit } from '@/lib/admin/session';
import { prisma } from '@/lib/prisma';

/** Флаги функций и настройки платформы (раздел 3.13 ТЗ) — только суперадмин. */
export async function PUT(request: Request) {
  const guard = await requireAdmin(['SUPERADMIN']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json()) as { key?: string; value?: string };
  if (!body.key || body.value === undefined) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  await prisma.platformSetting.upsert({
    where: { key: body.key },
    update: { value: body.value },
    create: { key: body.key, value: body.value },
  });
  await writeAdminAudit(guard.adminId, 'setting_changed', {
    entity: 'PlatformSetting',
    entityId: body.key,
    reason: body.value,
  });

  return NextResponse.json({ status: 'ok' });
}
