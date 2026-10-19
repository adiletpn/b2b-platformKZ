'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

export function RequisitesForm({
  initial,
}: {
  initial: { iik: string; bik: string; bankName: string };
}) {
  const t = useTranslations('requisites');
  const tDashboard = useTranslations('dashboard');
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    const response = await fetch('/api/company/requisites', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = (await response.json()) as { status?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    setSaved(true);
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {tDashboard('title')}
        </Link>
      </header>
      <p className="text-muted-foreground mt-2 text-sm">{t('hint')}</p>

      <form className="mt-6 space-y-4" onSubmit={save}>
        <Field label={t('iik')}>
          <Input
            value={values.iik}
            data-testid="iik-input"
            placeholder="KZ00XXXX0000000000"
            onChange={(event) => setValues((current) => ({ ...current, iik: event.target.value }))}
          />
        </Field>
        <Field label={t('bik')}>
          <Input
            value={values.bik}
            data-testid="bik-input"
            placeholder="HSBKKZKX"
            onChange={(event) => setValues((current) => ({ ...current, bik: event.target.value }))}
          />
        </Field>
        <Field label={t('bankName')}>
          <Input
            value={values.bankName}
            data-testid="bank-input"
            onChange={(event) =>
              setValues((current) => ({ ...current, bankName: event.target.value }))
            }
          />
        </Field>

        <Button type="submit" className="w-full" disabled={pending} data-testid="save-requisites">
          {t('save')}
        </Button>
      </form>

      {saved ? (
        <p className="text-muted-foreground mt-3 text-sm" data-testid="requisites-saved">
          {t('saved')}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert" data-testid="requisites-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </main>
  );
}
