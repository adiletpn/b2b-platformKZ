'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const ERRORS = ['invalid_number', 'invalid_date', 'forbidden'];

/** Номер лицензии с elicense.kz: открывает лицензируемые товары (раздел 2 ТЗ). */
export function LicenseForm({ initial }: { initial: { number: string; validUntil: string } }) {
  const t = useTranslations('requisites.license');
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<{ saved?: boolean; error?: string }>({});
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    const response = await fetch('/api/company/license', {
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
    <Card className="mt-4" data-testid="license">
      <div className="flex items-start gap-3">
        <IconBadge icon={BadgeCheck} tone="success" />
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardHint>{t('hint')}</CardHint>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('number')}>
          <Input
            value={form.number}
            maxLength={50}
            data-testid="license-number"
            onChange={(event) => setForm({ ...form, number: event.target.value })}
          />
        </Field>
        <Field label={t('validUntil')}>
          <Input
            type="date"
            value={form.validUntil}
            data-testid="license-valid-until"
            onChange={(event) => setForm({ ...form, validUntil: event.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button disabled={pending} data-testid="license-save" onClick={() => void save()}>
          {t('save')}
        </Button>
        {state.saved ? (
          <span className="text-success text-sm" data-testid="license-saved">
            {t('saved')}
          </span>
        ) : null}
        {state.error ? (
          <span className="text-danger text-sm" role="alert" data-testid="license-error">
            {t(`errors.${state.error}` as 'errors.unknown')}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
