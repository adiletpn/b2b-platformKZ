import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';
import { NOTIFICATION_CHANNELS } from '@/mocks/notifications';

export async function PUT(request: Request) {
  // Каналы меняет тот, кто ведёт профиль компании (раздел 3.12 ТЗ).
  const guard = await requirePermission('EMPLOYEES_REQUISITES', 'UPDATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { channels?: string[] };
  const channels = (body.channels ?? []).filter((channel) =>
    (NOTIFICATION_CHANNELS as readonly string[]).includes(channel),
  );
  if (channels.length === 0) return NextResponse.json({ status: 'no_channels' }, { status: 400 });

  // Правило 4: меняем каналы только своей компании.
  await prisma.company.update({
    where: { id: guard.access.companyId },
    data: { notificationChannels: channels },
  });

  return NextResponse.json({ status: 'ok', channels });
}
