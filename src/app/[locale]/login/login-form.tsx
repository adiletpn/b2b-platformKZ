'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemoHint, Field } from '@/components/ui/field';
import { formatPhone } from '@/lib/phone';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/controls';
import { NotYetBadge, NotYetButton } from '@/components/ui/not-yet';
import { FileCheck2, KeyRound, ShieldCheck, Zap } from 'lucide-react';

/** demoCode есть только у мока SMS; с настоящим провайдером код приходит в SMS. */
type Step = { name: 'phone' } | { name: 'code'; phone: string; demoCode: string | null };

/** passwordLogin — временный вход по паролю, выключается флагом в админке. */
export function LoginForm({ passwordLogin }: { passwordLogin: boolean }) {
  const t = useTranslations('auth');
  const tApp = useTranslations('app');
  const tSoon = useTranslations('common.notYetItems');
  const router = useRouter();
  const locale = useLocale();
  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [phoneInput, setPhoneInput] = useState('+7');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<'code' | 'password'>('code');
  const [register, setRegister] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (register && password !== passwordConfirm) {
      setError('password_mismatch');
      return;
    }
    setPending(true);
    const response = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: phoneInput, password, mode: register ? 'register' : 'login' }),
    });
    const data = (await response.json()) as { hasCompany?: boolean; error?: string };
    setPending(false);
    if (!response.ok) {
      setError(data.error ?? 'unknown');
      return;
    }
    router.push(data.hasCompany ? '/dashboard' : '/onboarding');
    router.refresh();
  }

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
      <section className="hidden rounded-[28px] bg-[#3e342e] bg-[radial-gradient(40rem_20rem_at_100%_0%,rgb(245_130_12/0.55),transparent_60%)] p-10 text-white shadow-[var(--shadow-strong)] lg:block">
        <p className="text-sm font-medium tracking-wide text-white/70 uppercase">
          {t('side.kicker')}
        </p>
        <h2 className="mt-3 text-[32px] leading-[1.05] font-black tracking-[-0.025em]">
          {t('side.title')}
        </h2>
        <ul className="mt-8 space-y-5">
          {(
            [
              ['p1', Zap],
              ['p2', FileCheck2],
              ['p3', ShieldCheck],
            ] as const
          ).map(([key, Icon]) => (
            <li key={key} className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-white/12 text-[#ff9a2e]">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm leading-relaxed text-white/85">{t(`side.${key}`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* На телефоне — как макет M01: без карточки, крупный заголовок и поле телефона. */}
      <Card className="mx-auto w-full max-w-md max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:shadow-none sm:p-8">
        <p className="text-[32px] leading-[1.05] font-black tracking-[-0.025em] sm:hidden">
          {tApp('tagline')}
        </p>
        <h1 className="mt-6 text-2xl font-black tracking-[-0.02em] sm:mt-0">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 text-[15px] font-medium">{t('subtitle')}</p>

        {passwordLogin && step.name === 'phone' ? (
          <Segmented
            className="mt-6"
            value={mode}
            onChange={(value) => {
              setMode(value);
              setError(null);
            }}
            options={[
              { value: 'code', label: t('modeCode'), testId: 'mode-code' },
              { value: 'password', label: t('modePassword'), testId: 'mode-password' },
            ]}
          />
        ) : null}

        {mode === 'password' && step.name === 'phone' ? (
          <form className="mt-6 space-y-4" onSubmit={submitPassword}>
            <Field label={t('phoneLabel')}>
              <Input
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                data-testid="phone-input"
                className="h-[60px] rounded-[18px] border-2 px-[18px] text-xl font-bold tracking-[0.02em]"
                placeholder={t('phonePlaceholder')}
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
              />
            </Field>
            <Field label={t('passwordLabel')}>
              <Input
                type="password"
                name="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                data-testid="password-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {register ? (
                <p className="text-muted-foreground mt-1.5 text-xs font-medium">
                  {t('passwordHint')}
                </p>
              ) : null}
            </Field>
            {register ? (
              <Field label={t('passwordConfirmLabel')}>
                <Input
                  type="password"
                  name="password-confirm"
                  autoComplete="new-password"
                  data-testid="password-confirm"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                />
              </Field>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending}
              data-testid="password-submit"
            >
              {register ? t('register') : t('login')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              data-testid="password-toggle"
              onClick={() => {
                setRegister(!register);
                setError(null);
              }}
            >
              {register ? t('toLogin') : t('toRegister')}
            </Button>
          </form>
        ) : step.name === 'phone' ? (
          <form className="mt-6 space-y-4" onSubmit={requestCode}>
            {/* Макет M01: канал кода. WhatsApp ждёт ключа WhatsApp Business API. */}
            <div className="bg-muted flex rounded-full p-[3px]">
              <span className="bg-card flex h-[38px] flex-1 items-center justify-center rounded-full text-[13px] font-bold shadow-[0_1px_4px_rgb(0_0_0/0.08)]">
                {tSoon('smsCode')}
              </span>
              <span className="text-muted-foreground flex h-[38px] flex-1 cursor-not-allowed items-center justify-center rounded-full text-[13px] font-bold">
                {tSoon('whatsappCode')}
              </span>
            </div>
            <p className="text-muted-foreground -mt-2 flex items-center justify-end gap-1.5 text-xs font-semibold">
              {tSoon('whatsappCode')}
              <NotYetBadge />
            </p>
            <Field label={t('phoneLabel')}>
              <Input
                name="phone"
                inputMode="tel"
                autoComplete="tel"
                data-testid="phone-input"
                className="h-[60px] rounded-[18px] border-2 px-[18px] text-xl font-bold tracking-[0.02em]"
                placeholder={t('phonePlaceholder')}
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending}
              data-testid="request-code"
            >
              {t('requestCode')}
            </Button>
            <NotYetButton icon={<KeyRound aria-hidden className="size-4" />}>
              {tSoon('ecpLogin')}
            </NotYetButton>
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
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending}
              data-testid="verify-code"
            >
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
