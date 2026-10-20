import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { listBrands, PRODUCT_EDITOR_ROLES, renameBrand } from '@/lib/admin/products';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Справочник брендов по полю товара (раздел 3.13 ТЗ). */
export async function GET() {
  const guard = await requireAdmin(PRODUCT_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);
  return NextResponse.json({ brands: await listBrands() });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(PRODUCT_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);
  const body = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
  const result = await renameBrand(guard.adminId, body.from ?? '', body.to ?? '');
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
