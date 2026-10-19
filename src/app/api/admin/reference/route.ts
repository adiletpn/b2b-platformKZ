import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { getReferenceData, saveReferenceEntry, type ReferenceInput } from '@/lib/admin/reference';

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  return NextResponse.json(await getReferenceData());
}

export async function POST(request: Request) {
  // Справочники ведут контент-менеджер и суперадмин (раздел 3.13 ТЗ).
  const guard = await requireAdmin(['SUPERADMIN', 'CONTENT_MANAGER']);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<ReferenceInput>;
  const kind = body.kind ?? 'unit';
  if (!['vatRate', 'unit', 'category'].includes(kind)) {
    return NextResponse.json({ status: 'invalid_entry' }, { status: 400 });
  }

  const result = await saveReferenceEntry(guard.adminId, {
    kind,
    code: body.code ?? '',
    nameRu: body.nameRu ?? '',
    nameKk: body.nameKk ?? '',
    rate: body.rate,
    isDefault: body.isDefault,
  });

  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
