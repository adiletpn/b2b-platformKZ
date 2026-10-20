import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { hasPermission, requirePermission } from '@/lib/auth/permissions';
import { getRoute, routeSheetHtml } from '@/lib/deliveries/routes';
import { renderPdf } from '@/lib/documents/pdf';
import { prisma } from '@/lib/prisma';

export const maxDuration = 60;

const LABELS = ['sheetTitle', 'date', 'driver', 'order', 'store', 'address', 'total', 'signature'];

/** Печатный маршрутный лист (этап 3 ТЗ) через тот же рендер PDF, что и у документов. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DELIVERIES', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const planner = await hasPermission(guard.access, 'DELIVERIES', 'CREATE');
  // Водитель печатает только свой рейс, собирающий — любой рейс своей компании.
  const route = await getRoute(
    guard.access.companyId,
    id,
    planner ? undefined : guard.access.membershipId,
  );
  if (!route) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const locale = new URL(request.url).searchParams.get('locale') === 'kk' ? 'kk' : 'ru';
  const t = await getTranslations({ locale, namespace: 'deliveries.routes' });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: guard.access.companyId } });
  const html = routeSheetHtml(
    route,
    company.name,
    locale,
    Object.fromEntries(LABELS.map((key) => [key, t(key)])),
  );
  return new NextResponse(new Uint8Array(await renderPdf(html)), {
    headers: { 'content-type': 'application/pdf' },
  });
}
