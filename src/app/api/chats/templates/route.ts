import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { addTemplate, listTemplates } from '@/lib/chat/extras';

/** Шаблоны быстрых ответов компании (раздел 3.7 ТЗ). */
export async function GET() {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  return NextResponse.json({ templates: await listTemplates(guard.access.companyId) });
}

export async function POST(request: Request) {
  const guard = await requirePermission('SWIPE_ORDERS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const result = await addTemplate(guard.access.companyId, body.text ?? '');
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
