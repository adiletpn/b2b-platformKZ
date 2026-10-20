'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemoHint, Field } from '@/components/ui/field';
import { formatPhone } from '@/lib/phone';
import { Card } from '@/components/ui/card';
import { FileCheck2, ShieldCheck, Zap } from 'lucide-react';

/** demoCode есть только у мока SMS; с настоящим провайдером код приходит в SMS. */
type Step = { name: 'phone' } | { name: 'code'; phone: string; demoCode: string | null };

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const locale = useLocale();
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
      body: JSON.stringify({ phone: phoneInput, locale }),
    });
    const data = (await response.json()) as { phone?: string; code?: string; error?: string };
    setPending(false);
    if (!response.ok || !data.phone) {
      setError(data.error ?? 'unknown');
      return;
    }
    setStep({ name: 'code', phone: data.phone, demoCode: data.code ?? null });
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
    // Шапка живёт в макете и при клиентском переходе не перерисовывается сама.
    router.refresh();
  }

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-16">
      <section className="bg-sidebar hidden rounded-3xl bg-[radial-gradient(40rem_20rem_at_100%_0%,oklch(0.5_0.13_228/0.55),transparent_60%)] p-10 text-white shadow-[var(--shadow-strong)] lg:block">
        <p className="text-sm font-medium tracking-wide text-white/70 uppercase">
          {t('side.kicker')}
        </p>
        <h2 className="mt-3 text-3xl leading-tight font-semibold">{t('side.title')}</h2>
        <ul className="mt-8 space-y-5">
          {(
            [
              ['p1', Zap],
              ['p2', FileCheck2],
              ['p3', ShieldCheck],
            ] as const
          ).map(([key, Icon]) => (
            <li key={key} className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm leading-relaxed text-white/85">{t(`side.${key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      <Card className="mx-auto w-full max-w-md p-6 sm:p-8">
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
            {step.demoCode ? (
              <DemoHint title={t('demoCodeTitle')}>
                {t('demoCodeHint')}:{' '}
                <span
                  className="text-foreground font-mono text-base font-semibold"
                  data-testid="demo-code"
                >
                  {step.demoCode}
                </span>
              </DemoHint>
            ) : null}
            <Field label={t('codeLabel')}>
              <Input
                name="code"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
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
          <p className="text-danger mt-4 text-sm" role="alert" data-testid="auth-error">
            {t(`errors.${error}` as 'errors.unknown')}
          </p>
        ) : null}
      </Card>
    </main>
  );
}
