'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemoHint, Field } from '@/components/ui/field';
import { formatPhone } from '@/lib/phone';

type Step = { name: 'phone' } | { name: 'code'; phone: string; demoCode: string };

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [phoneInput, setPhoneInput] = useState('+7');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch('/api/auth/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: phoneInput }),
    });
    const data = (await response.json()) as { phone?: string; code?: string; error?: string };
    setPending(false);
    if (!response.ok || !data.phone || !data.code) {
      setError(data.error ?? 'unknown');
      return;
    }
    setStep({ name: 'code', phone: data.phone, demoCode: data.code });
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (step.name !== 'code') return;
    setPending(true);
    setError(null);
    const response = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: step.phone, code }),
    });
    const data = (await response.json()) as { hasCompany?: boolean; error?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? 'unknown');
      return;
    }
    router.push(data.hasCompany ? '/dashboard' : '/onboarding');
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{t('subtitle')}</p>

      {step.name === 'phone' ? (
        <form className="mt-6 space-y-4" onSubmit={requestCode}>
          <Field label={t('phoneLabel')}>
            <Input
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              data-testid="phone-input"
              placeholder={t('phonePlaceholder')}
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending} data-testid="request-code">
            {t('requestCode')}
          </Button>
        </form>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={verify}>
          <p className="text-muted-foreground text-sm">
            {t('codeSentTo', { phone: formatPhone(step.phone) })}
          </p>
          <DemoHint title={t('demoCodeTitle')}>
            {t('demoCodeHint')}:{' '}
            <span
              className="text-foreground font-mono text-base font-semibold"
              data-testid="demo-code"
            >
              {step.demoCode}
            </span>
          </DemoHint>
          <Field label={t('codeLabel')}>
            <Input
              name="code"
              inputMode="numeric"
              maxLength={6}
              data-testid="code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={pending} data-testid="verify-code">
            {t('verify')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => setStep({ name: 'phone' })}
          >
            {t('changePhone')}
          </Button>
        </form>
      )}

      {error ? (
        <p className="mt-4 text-sm text-red-600" role="alert" data-testid="auth-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </main>
  );
}
