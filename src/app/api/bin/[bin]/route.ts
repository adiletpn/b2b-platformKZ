import { NextResponse } from 'next/server';
import { isValidBin } from '@/lib/bin/checksum';
import { lookupBin } from '@/mocks/bin-registry';
import { getSession } from '@/lib/auth/session';

export async function GET(_request: Request, { params }: { params: Promise<{ bin: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { bin } = await params;
  if (!isValidBin(bin)) return NextResponse.json({ error: 'invalid_bin' }, { status: 400 });

  const entry = lookupBin(bin);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(entry);
}
