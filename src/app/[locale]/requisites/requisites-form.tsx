'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Page, PageHeader } from '@/components/ui/page';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { BellRing, Calculator, Landmark } from 'lucide-react';

const CHANNELS = ['whatsapp', 'telegram', 'email'] as const;

export function RequisitesForm({
  initial,
  initialChannels,
  initialCostMethod,
  extra,
}: {
  initial: { iik: string; bik: string; bankName: string };
  initialChannels: string[];
  initialCostMethod: 'AVERAGE' | 'FIFO';
  /** Блоки страницы, которые зависят от типа компании (условия оплаты поставщика). */
  extra?: React.ReactNode;
}) {
  const t = useTranslations('requisites');
  const [values, setValues] = useState(initial);
  const [channels, setChannels] = useState<string[]>(initialChannels);
  const [channelsSaved, setChannelsSaved] = useState(false);
  const [costMethod, setCostMethod] = useState(initialCostMethod);
  const [costSaved, setCostSaved] = useState(false);
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

  /** Раздел 4.1 ТЗ: себестоимость средневзвешенная или FIFO. */
  async function saveCostMethod(next: 'AVERAGE' | 'FIFO') {
    setCostMethod(next);
    setCostSaved(false);
    setError(null);

    const response = await fetch('/api/company/cost-method', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ costMethod: next }),
    });
    const data = (await response.json()) as { status?: string };
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    setCostSaved(true);
  }

  return (
    <Page width="md">
      <PageHeader title={t('title')} description={t('hint')} />

      <Card>
        <div className="flex items-start gap-3">
          <IconBadge icon={Landmark} />
          <CardTitle className="mt-1.5">{t('bankTitle')}</CardTitle>
        </div>
        <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={save}>
          <Field label={t('iik')}>
            <Input
              value={values.iik}
              data-testid="iik-input"
              placeholder="KZ00XXXX0000000000"
              onChange={(event) =>
                setValues((current) => ({ ...current, iik: event.target.value }))
              }
            />
          </Field>
          <Field label={t('bik')}>
            <Input
              value={values.bik}
              data-testid="bik-input"
              placeholder="HSBKKZKX"
              onChange={(event) =>
                setValues((current) => ({ ...current, bik: event.target.value }))
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t('bankName')}>
              <Input
                value={values.bankName}
                data-testid="bank-input"
                onChange={(event) =>
                  setValues((current) => ({ ...current, bankName: event.target.value }))
                }
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending} data-testid="save-requisites">
              {t('save')}
            </Button>
            {saved ? (
              <span className="text-success text-sm" data-testid="requisites-saved">
                {t('saved')}
              </span>
            ) : null}
            {error ? (
              <span
                className="text-danger text-sm font-semibold"
                role="alert"
                data-testid="requisites-error"
              >
                {t(`errors.${error}` as 'errors.unknown')}
              </span>
            ) : null}
          </div>
        </form>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <div className="flex items-start gap-3">
            <IconBadge icon={Calculator} tone="accent" />
            <div>
              <CardTitle>{t('costMethodTitle')}</CardTitle>
              <CardHint>{t('costMethodHint')}</CardHint>
            </div>
          </div>
          <select
            className="border-border bg-card mt-4 h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
            value={costMethod}
            data-testid="cost-method"
            onChange={(event) => void saveCostMethod(event.target.value as 'AVERAGE' | 'FIFO')}
          >
            {(['AVERAGE', 'FIFO'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`costMethods.${value}`)}
              </option>
            ))}
          </select>
          {costSaved ? (
            <p className="text-muted-foreground mt-2 text-sm" data-testid="cost-method-saved">
              {t('costMethodSaved')}
            </p>
          ) : null}
        </Card>

        <Card>
          <div className="flex items-start gap-3">
            <IconBadge icon={BellRing} tone="success" />
            <div>
              <CardTitle>{t('channelsTitle')}</CardTitle>
              <CardHint>{t('channelsHint')}</CardHint>
            </div>
          </div>

          <div className="mt-4 space-y-2" data-testid="notification-channels">
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
        </Card>
      </div>
      {extra}
    </Page>
  );
}
