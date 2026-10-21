'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';

type Approval = {
  orderId: string;
  number: string;
  supplierName: string;
  total: string;
  authorPhone: string;
};

/** Раздел 3.12 ТЗ: заявки выше лимита сотрудника согласует Владелец. */
export function ApprovalList({ approvals }: { approvals: Approval[] }) {
  const t = useTranslations('orders');
  const router = useRouter();

  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (approvals.length === 0) return null;

  async function decide(orderId: string, approved: boolean) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/orders/${orderId}/approval`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved, reason: reasons[orderId] ?? '' }),
    });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);
    if (data.status !== 'ok') {
      setError(data.status ?? data.error ?? 'unknown');
      return;
    }
    router.refresh();
  }

  return (
    <Card className="mt-4" data-testid="approvals">
      <CardTitle className="text-sm">{t('approvalsTitle')}</CardTitle>
      <p className="text-muted-foreground mt-1 text-sm">{t('approvalsHint')}</p>

      <ul className="mt-3 space-y-3">
        {approvals.map((approval) => (
          <li
            key={approval.orderId}
            className="border-border flex flex-wrap items-end gap-3 border-b pb-3 last:border-0"
            data-testid={`approval-${approval.number}`}
          >
            <div className="min-w-48 flex-1">
              <p className="font-mono text-xs">{approval.number}</p>
              <p className="text-sm break-words">{approval.supplierName}</p>
              <p className="text-muted-foreground text-xs">
                {t('approvalAuthor')}: {approval.authorPhone} · {money(approval.total)} ₸
              </p>
            </div>

            <div className="min-w-40 flex-1">
              <Field label={t('approvalReason')}>
                <Input
                  value={reasons[approval.orderId] ?? ''}
                  data-testid={`approval-reason-${approval.number}`}
                  onChange={(event) =>
                    setReasons((current) => ({
                      ...current,
                      [approval.orderId]: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>

            <Button
              size="sm"
              disabled={pending}
              data-testid={`approval-approve-${approval.number}`}
              onClick={() => void decide(approval.orderId, true)}
            >
              {t('approve')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              data-testid={`approval-reject-${approval.number}`}
              onClick={() => void decide(approval.orderId, false)}
            >
              {t('rejectApproval')}
            </Button>
          </li>
        ))}
      </ul>

      {error ? (
        <p className="text-danger mt-2 text-sm" role="alert" data-testid="approval-error">
          {t(`errors.${error}` as 'errors.reason_required')}
        </p>
      ) : null}
    </Card>
  );
}
