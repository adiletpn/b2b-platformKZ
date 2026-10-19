'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Page } from '@/components/ui/page';

const CHANNELS = ['whatsapp', 'telegram', 'email'] as const;

export function RequisitesForm({
  initial,
  initialChannels,
}: {
  initial: { iik: string; bik: string; bankName: string };
  initialChannels: string[];
}) {
  const t = useTranslations('requisites');
  const tDashboard = useTranslations('dashboard');
  const [values, setValues] = useState(initial);
  const [channels, setChannels] = useState<string[]>(initialChannels);
  const [channelsSaved, setChannelsSaved] = useState(false);
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

  /** Раздел 3.10 ТЗ: пользователь сам выбирает каналы уведомлений. */
  async function saveChannels(next: string[]) {
    setChannels(next);
    setChannelsSaved(false);
    setError(null);
    if (next.length === 0) {
      setError('no_channels');
      return;
    }

    const response = await fetch('/api/notifications/channels', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channels: next }),
    });
    const data = (await response.json()) as { status?: string };
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    setChannelsSaved(true);
  }

  return (
    <Page width="sm">
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

      <section className="border-border mt-6 rounded-lg border border-dashed p-4">
        <h2 className="text-muted-foreground text-sm font-medium">{t('channelsTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('channelsHint')}</p>

        <div className="mt-3 space-y-2" data-testid="notification-channels">
          {CHANNELS.map((channel) => (
            <label key={channel} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channels.includes(channel)}
                data-testid={`channel-${channel}`}
                onChange={(event) =>
                  void saveChannels(
                    event.target.checked
                      ? [...channels, channel]
                      : channels.filter((item) => item !== channel),
                  )
                }
              />
              {t(`channels.${channel}`)}
            </label>
          ))}
        </div>

        {channelsSaved ? (
          <p className="text-muted-foreground mt-2 text-sm" data-testid="channels-saved">
            {t('channelsSaved')}
          </p>
        ) : null}
      </section>

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
    </Page>
  );
}
