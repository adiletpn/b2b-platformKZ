import { NextResponse } from 'next/server';
import type { WriteOffReason } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';
import {
  stocktake,
  transferStock,
  writeOffStock,
  type DocumentLineInput,
  type StocktakeLine,
} from '@/lib/stock/documents';

export async function GET() {
  const guard = await requirePermission('STOCK', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  // Правило 4: только документы своей компании.
  const documents = await prisma.stockDocument.findMany({
    where: { companyId: guard.access.companyId },
    include: {
      location: { select: { address: true } },
      targetLocation: { select: { address: true } },
      lines: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({
    documents: documents.map((document) => ({
      id: document.id,
      type: document.type,
      number: document.number,
      createdAt: document.createdAt.toISOString(),
      locationAddress: document.location.address,
      targetAddress: document.targetLocation?.address ?? null,
      reason: document.reason,
      comment: document.comment,
      lineCount: document.lines.length,
    })),
  });
}

export async function POST(request: Request) {
  // Складские документы создаёт тот, кто ведёт остатки (раздел 3.12 ТЗ).
  const guard = await requirePermission('STOCK', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    type?: 'TRANSFER' | 'WRITE_OFF' | 'STOCKTAKE';
    locationId?: string;
    targetLocationId?: string;
    reason?: WriteOffReason;
    comment?: string;
    lines?: (DocumentLineInput & StocktakeLine)[];
  };

  const { companyId, userId } = guard.access;
  const lines = body.lines ?? [];

  const result =
    body.type === 'TRANSFER'
      ? await transferStock(companyId, userId, {
          fromLocationId: body.locationId ?? '',
          toLocationId: body.targetLocationId ?? '',
          lines,
          comment: body.comment,
        })
      : body.type === 'STOCKTAKE'
        ? await stocktake(companyId, userId, {
            locationId: body.locationId ?? '',
            lines,
            comment: body.comment,
          })
        : await writeOffStock(companyId, userId, {
            locationId: body.locationId ?? '',
            reason: body.reason ?? 'OTHER',
            lines,
            comment: body.comment,
          });

  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
