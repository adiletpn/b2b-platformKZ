import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import {
  isLocale,
  isPrintableType,
  previewTemplate,
  TEMPLATE_EDITOR_ROLES,
} from '@/lib/admin/templates';

export const maxDuration = 60;

/**
 * Предпросмотр шаблона в PDF на образце документа. HTML шаблона в страницу админки
 * не попадает: показываем только готовый PDF.
 */
export async function POST(request: Request) {
  const guard = await requireAdmin(TEMPLATE_EDITOR_ROLES);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    type?: string;
    locale?: string;
    body?: string;
  };
  if (!isPrintableType(body.type) || !isLocale(body.locale)) {
    return NextResponse.json({ status: 'invalid_template' }, { status: 400 });
  }

  const result = await previewTemplate(body.type, body.locale, body.body ?? '');
  if (result.status !== 'ok') return NextResponse.json(result, { status: 400 });
  return new NextResponse(new Uint8Array(result.pdf), {
    headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' },
  });
}
