import { NextResponse } from 'next/server';
import type { DocumentType } from '@/generated/prisma/enums';
import { requirePermission } from '@/lib/auth/permissions';
import { searchDocuments } from '@/lib/archive/search';

export async function GET(request: Request) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const params = new URL(request.url).searchParams;
  const rows = await searchDocuments(guard.access.companyId, {
    type: (params.get('type') as DocumentType) || undefined,
    search: params.get('search')?.trim() || undefined,
    minTotal: params.get('minTotal') || undefined,
    from: params.get('from') ? new Date(params.get('from')!) : undefined,
    to: params.get('to') ? new Date(params.get('to')!) : undefined,
  });

  return NextResponse.json({ documents: rows });
}
