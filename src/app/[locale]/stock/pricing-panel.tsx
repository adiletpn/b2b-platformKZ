'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardTitle } from '@/components/ui/card';

type Category = { id: string; name: string };
type Price = { productId: string; name: string; price: string };

/** Наценка, массовая переоценка и ценники со штрихкодом (раздел 4.1 ТЗ). */
export function PricingPanel({
  locale,
  categories,
  prices,
  markups,
}: {
  locale: 'ru' | 'kk';
  categories: Category[];
  prices: Price[];
  markups: { categoryId: string | null; percent: string }[];
}) {
  const t = useTranslations('stock');
  const router = useRouter();

  const [categoryId, setCategoryId] = useState('');
  const [percent, setPercent] = useState(
    markups.find((rule) => rule.categoryId === null)?.percent ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [repriced, setRepriced] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  async function post(body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch('/api/stock/pricing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { status?: string; updated?: number };
    setPending(false);
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return null;
    }
    router.refresh();
    return data;
  }

  return (
    <Card className="mt-4" data-testid="pricing">
      <CardTitle className="text-sm">{t('pricingTitle')}</CardTitle>
      <p className="text-muted-foreground mt-1 text-sm">{t('pricingHint')}</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label={t('markupCategory')}>
          <select
            className="border-border bg-card h-11 rounded-lg border px-3"
            value={categoryId}
            data-testid="markup-category"
            onChange={(event) => {
              setCategoryId(event.target.value);
              const rule = markups.find((item) => (item.categoryId ?? '') === event.target.value);
              setPercent(rule?.percent ?? '');
            }}
          >
            <option value="">{t('markupCommon')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('markupPercent')}>
          <Input
            className="w-24"
            inputMode="decimal"
            value={percent}
            data-testid="markup-percent"
            onChange={(event) => setPercent(event.target.value)}
          />
        </Field>

        <Button
          variant="outline"
          disabled={pending}
          data-testid="markup-save"
          onClick={() => void post({ action: 'markup', categoryId: categoryId || null, percent })}
        >
          {t('markupSave')}
        </Button>

        <Button
          disabled={pending}
          data-testid="reprice"
          onClick={async () => {
            const data = await post({ action: 'reprice' });
            if (data) setRepriced(data.updated ?? 0);
          }}
        >
          {t('reprice')}
        </Button>

        {prices.length > 0 ? (
          <a
            href={`/api/stock/labels?locale=${locale}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline' })}
            data-testid="print-labels"
          >
            {t('printLabels')}
          </a>
        ) : null}
      </div>

      {repriced !== null ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="repriced">
          {t('repriced', { count: repriced })}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert" data-testid="pricing-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}

      {prices.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm" data-testid="retail-prices">
          {prices.map((price) => (
            <li key={price.productId} className="flex flex-wrap justify-between gap-2">
              <span className="break-words">{price.name}</span>
              <span className="tabular-nums">{price.price} ₸</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
