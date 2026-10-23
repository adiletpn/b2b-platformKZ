'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemoHint, Field } from '@/components/ui/field';

export function AdminLogin() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [phone, setPhone] = useState('+7');
  // null — код ещё не запрошен; пустая строка — код ушёл по SMS, показывать нечего.
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = (await response.json()) as { code?: string; error?: string };
    if (!response.ok) {
      setError(data.error ?? 'unknown');
      return;
    }
    setDemoCode(data.code ?? '');
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? 'unknown');
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-muted-foreground text-sm font-medium">{t('loginHint')}</p>

      {demoCode === null ? (
        <form className="space-y-3" onSubmit={requestCode}>
          <Field label={t('phone')}>
            <Input
              inputMode="tel"
              value={phone}
              data-testid="admin-phone"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" data-testid="admin-request-code">
            {t('requestCode')}
          </Button>
        </form>
      ) : (
        <form className="space-y-3" onSubmit={verify}>
          {demoCode ? (
            <DemoHint title={t('loginHint')}>
              <span
                className="text-foreground font-mono text-base font-semibold"
                data-testid="admin-demo-code"
              >
                {demoCode}
              </span>
            </DemoHint>
          ) : (
            <p className="text-muted-foreground text-sm font-medium">{t('codeSentBySms')}</p>
          )}
          <Field label={t('code')}>
            <Input
              inputMode="numeric"
              maxLength={6}
              value={code}
              data-testid="admin-code"
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" data-testid="admin-enter">
            {t('enter')}
          </Button>
        </form>
      )}

      {error ? (
        <p className="text-danger text-sm font-semibold" role="alert" data-testid="admin-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </div>
  );
}
