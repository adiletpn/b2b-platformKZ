import { NextResponse } from 'next/server';
import { hasPermission, requirePermission, writeAudit } from '@/lib/auth/permissions';
import { refund } from '@/lib/pos/sale';
import { checkApproval, requestApprovalCode } from '@/lib/pos/approval';

/**
 * Возврат на кассе. С правом «Касса → изменение» — сразу, иначе нужен код старшего
 * (разделы 4.2 и 3.12 ТЗ). `action: 'request_code'` выдаёт код старшему.
 */
export async function POST(request: Request) {
  const guard = await requirePermission('POS', 'CREATE');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }
  const { companyId, userId } = guard.access;

  const body = (await request.json().catch(() => ({}))) as {
    receiptId?: string;
    action?: string;
    approverPhone?: string;
    approverCode?: string;
  };

  if (body.action === 'request_code') {
    const result = await requestApprovalCode(companyId, body.approverPhone ?? '');
    return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
  }

  let approvedById: string | null = null;
  if (!(await hasPermission(guard.access, 'POS', 'UPDATE'))) {
    if (!body.approverPhone || !body.approverCode) {
      return NextResponse.json({ status: 'approval_required' }, { status: 403 });
    }
    const approval = await checkApproval(companyId, body.approverPhone, body.approverCode);
    if (approval.status !== 'ok') return NextResponse.json(approval, { status: 400 });
    approvedById = approval.approverId;
  }

  const result = await refund(companyId, userId, body.receiptId ?? '', approvedById);
  if (result.status === 'ok' && approvedById) {
    await writeAudit(companyId, approvedById, 'refund_approved', 'Receipt', result.receiptId);
  }
  return NextResponse.json(result, { status: result.status === 'ok' ? 200 : 400 });
}
