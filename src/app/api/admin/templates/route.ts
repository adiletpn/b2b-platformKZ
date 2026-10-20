import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import {
  getTemplateEditorData,
  isLocale,
  isPrintableType,
  resetTemplate,
  saveTemplate,
  TEMPLATE_EDITOR_ROLES,
} from '@/lib/admin/templates';

function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

/** Шаблон печатной формы и его история (раздел 3.13 ТЗ). */
export async function GET(request: Request) {
  const guard = await requireAdmin(TEMPLATE_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);

  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  const locale = params.get('locale');
  if (!isPrintableType(type) || !isLocale(locale)) {
    return NextResponse.json({ status: 'invalid_template' }, { status: 400 });
  }
  return NextResponse.json(await getTemplateEditorData(type, locale));
}

/** Сохранение новой версии шаблона или сброс к стандартному. */
export async function POST(request: Request) {
  const guard = await requireAdmin(TEMPLATE_EDITOR_ROLES);
  if (!guard.ok) return denied(guard.status);

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    type?: string;
    locale?: string;
    body?: string;
  };
  if (!isPrintableType(body.type) || !isLocale(body.locale)) {
    return NextResponse.json({ status: 'invalid_template' }, { status: 400 });
  }

  if (body.action === 'reset') {
    await resetTemplate(guard.adminId, body.type, body.locale);
    return NextResponse.json({ status: 'ok' });
  }
  const result = await saveTemplate(guard.adminId, body.type, body.locale, body.body ?? '');
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
