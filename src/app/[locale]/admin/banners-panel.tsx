'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Megaphone, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { BannerRow } from '@/lib/admin/banners';

const AUDIENCES = ['ALL', 'STORES', 'SUPPLIERS'] as const;

/** Баннеры в кабинете (раздел 3.13 ТЗ): текст на двух языках, для кого и даты показа. */
export function BannersPanel({ initial, today }: { initial: BannerRow[]; today: string }) {
  const t = useTranslations('admin.banners');
  const [banners, setBanners] = useState(initial);
  const [form, setForm] = useState({
    textRu: '',
    textKk: '',
    audience: 'ALL',
    startsOn: today,
    endsOn: today,
  });
  const [message, setMessage] = useState<string | null>(null);

  async function post(body: unknown) {
    const response = await fetch('/api/admin/banners', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await response.json().catch(() => ({}))) as { status?: string };
  }

  async function reload() {
    const response = await fetch('/api/admin/banners');
    if (response.ok) setBanners(((await response.json()) as { banners: BannerRow[] }).banners);
  }

  async function create() {
    const data = await post(form);
    if (data.status !== 'ok') {
      setMessage(t(`errors.${data.status ?? 'unknown'}` as 'errors.unknown'));
      return;
    }
    setMessage(t('created'));
    setForm({ ...form, textRu: '', textKk: '' });
    await reload();
  }

  async function remove(id: string) {
    await post({ action: 'delete', id });
    await reload();
  }

  const select = 'border-border bg-card h-11 w-full rounded-lg border px-3';
  return (
    <Card data-testid="admin-banners">
      <div className="flex items-start gap-3">
        <IconBadge icon={Megaphone} />
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardHint>{t('hint')}</CardHint>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('textRu')}>
          <Input
            value={form.textRu}
            data-testid="banner-text-ru"
            onChange={(event) => setForm({ ...form, textRu: event.target.value })}
          />
        </Field>
        <Field label={t('textKk')}>
          <Input
            value={form.textKk}
            data-testid="banner-text-kk"
            onChange={(event) => setForm({ ...form, textKk: event.target.value })}
          />
        </Field>
        <Field label={t('audience')}>
          <select
            className={select}
            value={form.audience}
            data-testid="banner-audience"
            onChange={(event) => setForm({ ...form, audience: event.target.value })}
          >
            {AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {t(`audiences.${audience}`)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('startsOn')}>
            <Input
              type="date"
              value={form.startsOn}
              data-testid="banner-starts"
              onChange={(event) => setForm({ ...form, startsOn: event.target.value })}
            />
          </Field>
          <Field label={t('endsOn')}>
            <Input
              type="date"
              value={form.endsOn}
              data-testid="banner-ends"
              onChange={(event) => setForm({ ...form, endsOn: event.target.value })}
            />
          </Field>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button data-testid="banner-create" onClick={() => void create()}>
          {t('create')}
        </Button>
        {message ? (
          <span className="text-sm" role="status" data-testid="banner-message">
            {message}
          </span>
        ) : null}
      </div>
      {banners.length > 0 ? (
        <ul className="divide-border mt-3 divide-y text-sm" data-testid="banner-list">
          {banners.map((banner) => (
            <li key={banner.id} className="flex flex-wrap items-start gap-2 py-2">
              <span className="min-w-0 flex-1 break-words">
                {banner.textRu}
                <span className="text-muted-foreground block text-xs">{banner.textKk}</span>
              </span>
              <Badge tone="info">{t(`audiences.${banner.audience}`)}</Badge>
              <span className="text-muted-foreground text-xs tabular-nums">
                {banner.startsOn} — {banner.endsOn}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('delete')}
                onClick={() => void remove(banner.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
