'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const TERMS = ['PREPAY', 'ON_DELIVERY', 'DEFERRED'] as const;
const ERRORS = ['invalid_terms', 'invalid_days', 'invalid_limit', 'forbidden'];

/** Условия оплаты поставщика и кредитный лимит на магазин (разделы 3.1 и 3.6 ТЗ). */
export function PaymentTermsForm({
  initial,
}: {
  initial: { paymentTerms: (typeof TERMS)[number]; deferralDays: string; creditLimit: string };
}) {
  const t = useTranslations('requisites.terms');
  const tMethods = useTranslations('payment.methods');
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<{ saved?: boolean; error?: string }>({});
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const response = await fetch('/api/company/payment-terms', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
    setPending(false);
    const code = data.status ?? data.error ?? 'unknown';
    setState(code === 'ok' ? { saved: true } : { error: ERRORS.includes(code) ? code : 'unknown' });
  }

  return (
    <Card className="mt-4" data-testid="payment-terms">
      <div className="flex items-start gap-3">
        <IconBadge icon={Wallet} tone="warning" />
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardHint>{t('hint')}</CardHint>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('terms')}>
          <select
            className="border-border bg-card h-11 w-full rounded-lg border px-3"
            value={form.paymentTerms}
            data-testid="terms-select"
            onChange={(event) =>
              setForm({ ...form, paymentTerms: event.target.value as (typeof TERMS)[number] })
            }
          >
            {TERMS.map((term) => (
              <option key={term} value={term}>
                {tMethods(term)}
              </option>
            ))}
          </select>
        </Field>
        {form.paymentTerms === 'DEFERRED' ? (
          <Field label={t('days')}>
            <Input
              inputMode="numeric"
              value={form.deferralDays}
              data-testid="terms-days"
              onChange={(event) => setForm({ ...form, deferralDays: event.target.value })}
            />
          </Field>
        ) : null}
        <Field label={t('creditLimit')}>
          <Input
            inputMode="decimal"
            value={form.creditLimit}
            placeholder={t('noLimit')}
            data-testid="terms-limit"
            onChange={(event) => setForm({ ...form, creditLimit: event.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={pending} data-testid="terms-save" onClick={() => void save()}>
          {t('save')}
        </Button>
        {state.saved ? (
          <span className="text-success text-sm" data-testid="terms-saved">
            {t('saved')}
          </span>
        ) : null}
        {state.error ? (
          <span className="text-danger text-sm" role="alert" data-testid="terms-error">
            {t(`errors.${state.error}` as 'errors.unknown')}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
