import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import {
  findMergeConflicts,
  mergeProducts,
  PRODUCT_EDITOR_ROLES,
  searchProducts,
} from '@/lib/admin/products';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Поиск по единому справочнику товаров для объединения дублей (раздел 3.13 ТЗ). */
export async function GET(request: Request) {
  const guard = await requireAdmin(PRODUCT_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);
  const query = new URL(request.url).searchParams.get('q') ?? '';
  return NextResponse.json({ products: await searchProducts(query) });
}

/** `preview` показывает, что мешает объединению, `merge` переносит ссылки и удаляет дубль. */
export async function POST(request: Request) {
  const guard = await requireAdmin(PRODUCT_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    mainId?: string;
    duplicateId?: string;
  };
  const mainId = body.mainId ?? '';
  const duplicateId = body.duplicateId ?? '';

  if (body.action === 'preview') {
    if (!mainId || !duplicateId || mainId === duplicateId) {
      return NextResponse.json({ status: 'same_product' }, { status: 400 });
    }
    const conflicts = await findMergeConflicts(mainId, duplicateId);
    return NextResponse.json({ status: 'ok', conflicts });
  }

  const result = await mergeProducts(guard.adminId, mainId, duplicateId);
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
