import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { buildCatalogTemplate } from '@/lib/catalog/template';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('CATALOG', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const locale = new URL(request.url).searchParams.get('locale') === 'kk' ? 'kk' : 'ru';
  const [units, categories, vatRates] = await Promise.all([
    prisma.unit.findMany(),
    prisma.category.findMany(),
    prisma.vatRate.findMany({ where: { validTo: null } }),
  ]);

  const buffer = await buildCatalogTemplate(
    {
      units: units.map((unit) => ({
        code: unit.code,
        name: locale === 'kk' ? unit.nameKk : unit.nameRu,
      })),
      categories: categories.map((category) => ({
        code: category.code,
        name: locale === 'kk' ? category.nameKk : category.nameRu,
      })),
      vatRates: vatRates.map((rate) => ({
        code: rate.code,
        name: locale === 'kk' ? rate.nameKk : rate.nameRu,
        rate: rate.rate.toFixed(2),
      })),
    },
    locale,
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="catalog-template.xlsx"',
    },
  });
}
