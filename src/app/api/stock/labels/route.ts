import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getLabels } from '@/lib/stock/pricing';
import { barcodeSvg } from '@/lib/stock/barcode';
import { renderPdf } from '@/lib/documents/pdf';

export async function GET(request: Request) {
  const guard = await requirePermission('STOCK', 'EXPORT');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const params = new URL(request.url).searchParams;
  const locale = params.get('locale') === 'kk' ? 'kk' : 'ru';
  const rows = await getLabels(guard.access.companyId);
  if (rows.length === 0) return NextResponse.json({ error: 'no_prices' }, { status: 400 });

  const labels = rows
    .map(
      (row) => `
        <div class="label">
          <div class="name">${locale === 'kk' ? row.nameKk : row.nameRu}</div>
          <div class="price">${row.price} ₸</div>
          ${barcodeSvg(row.barcode)}
        </div>`,
    )
    .join('');

  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
    <style>
      body { font-family: Arial, sans-serif; margin: 8mm; }
      .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
      .label { width: 60mm; height: 40mm; border: 1px dashed #999; padding: 2mm;
               display: flex; flex-direction: column; justify-content: space-between; }
      .name { font-size: 10pt; }
      .price { font-size: 18pt; font-weight: 700; }
      svg { height: 14mm; }
    </style></head><body><div class="sheet">${labels}</div></body></html>`;

  const pdf = await renderPdf(html);
  const name = locale === 'kk' ? 'бағажапсырмалар.pdf' : 'ценники.pdf';

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      // RFC 5987: кириллица в имени файла только так.
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
