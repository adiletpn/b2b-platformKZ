import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/session';
import { getTicket } from '@/lib/support/tickets';
function denied(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(['SUPERADMIN', 'SUPPORT']);
  if (!guard.ok) return denied(guard.status);
  const { id } = await params;
  const ticket = await getTicket(id, null);
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ticket });
}
