import { NextResponse } from 'next/server';
import { verifyLoginCode } from '@/lib/auth/otp';
import { normalizePhone } from '@/lib/phone';
import { prisma } from '@/lib/prisma';
import { createAdminSession, writeAdminAudit } from '@/lib/admin/session';

export async function POST(request: Request) {
  const body = (await request.json()) as { phone?: string; code?: string };
  const phone = normalizePhone(body.phone ?? '');
  if (!phone || !body.code) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  const admin = await prisma.adminUser.findUnique({ where: { phone } });
  if (!admin || !admin.isActive) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await verifyLoginCode(phone, body.code);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  await createAdminSession(admin.id);
  await writeAdminAudit(admin.id, 'admin_signed_in');

  return NextResponse.json({ role: admin.role });
}
