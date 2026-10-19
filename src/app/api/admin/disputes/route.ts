import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { listDisputes, resolveDispute, type DisputeResolution } from '@/lib/admin/dashboard';

export async function GET() {
  const guard = await requireAdmin(['SUPERADMIN', 'MODERATOR', 'SUPPORT']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  return NextResponse.json({ disputes: await listDisputes() });
}

export async function POST(request: Request) {
  // Разбор споров — модератор и суперадмин (раздел 3.13 ТЗ).
  const guard = await requireAdmin(['SUPERADMIN', 'MODERATOR']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json()) as {
    orderId?: string;
    resolution?: DisputeResolution;
    comment?: string;
  };

  const result = await resolveDispute(
    guard.adminId,
    body.orderId ?? '',
    body.resolution ?? 'AWAITING_PAYMENT',
    body.comment ?? '',
  );

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
