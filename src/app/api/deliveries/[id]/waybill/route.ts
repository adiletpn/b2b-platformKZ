import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { waybillForDriver } from '@/lib/deliveries/deliveries';
import { printableHtml } from '@/lib/documents/print';
import { renderPdf } from '@/lib/documents/pdf';
import type { DocumentPayload } from '@/lib/documents/payload';
import { appBaseUrl, verificationUrl } from '@/lib/documents/verification';

export const maxDuration = 60;

/** Накладная в приложении водителя (раздел 3.5 ТЗ): без доступа к остальным документам. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DELIVERIES', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { id } = await params;
  const document = await waybillForDriver(id, guard.access.companyId);
  if (!document) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const locale = new URL(request.url).searchParams.get('locale') === 'kk' ? 'kk' : 'ru';
  const html = await printableHtml(
    document.type,
    document.payload as unknown as DocumentPayload,
    locale,
    {
      verifyUrl: verificationUrl(
        appBaseUrl(request),
        locale,
        document.verificationCode,
        document.version,
      ),
    },
  );
  return new NextResponse(new Uint8Array(await renderPdf(html)), {
    headers: { 'content-type': 'application/pdf' },
  });
}
