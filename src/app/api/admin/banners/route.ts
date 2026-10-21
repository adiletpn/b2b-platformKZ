import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { BANNER_EDITOR_ROLES, createBanner, deleteBanner, listBanners } from '@/lib/admin/banners';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Баннеры в кабинете компаний (раздел 3.13 ТЗ). */
export async function GET() {
  const guard = await requireAdmin(BANNER_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);
  return NextResponse.json({ banners: await listBanners() });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(BANNER_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);
  const body = (await request.json().catch(() => ({}))) as Partial<Record<string, string>>;

  if (body.action === 'delete') {
    const result = await deleteBanner(guard.adminId, body.id ?? '');
    return NextResponse.json({ status: result }, { status: result === 'ok' ? 200 : 404 });
  }

  const result = await createBanner(guard.adminId, {
    textRu: body.textRu ?? '',
    textKk: body.textKk ?? '',
    audience: body.audience ?? 'ALL',
    startsOn: body.startsOn ?? '',
    endsOn: body.endsOn ?? '',
  });
  return NextResponse.json(result, { status: result.status === 'ok' ? 201 : 400 });
}
