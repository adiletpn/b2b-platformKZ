import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { lookupBarcode } from '@/lib/catalog/manual';

export async function GET(request: Request) {
  const guard = await requirePermission('CATALOG', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const code = new URL(request.url).searchParams.get('code') ?? '';
  const lookup = await lookupBarcode(code);
  if (!lookup) return NextResponse.json({ error: 'invalid_barcode' }, { status: 400 });

  return NextResponse.json(lookup);
}
