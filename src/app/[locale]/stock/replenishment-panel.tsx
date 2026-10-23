'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardTitle } from '@/components/ui/card';

type Row = {
  productId: string;
  name: string;
  quantity: string;
  minQuantity: string;
  suggested: string;
  supplierName: string | null;
};

/** Минимальный остаток и автозаказ (раздел 4.1 ТЗ). */
export function ReplenishmentPanel({
  rows,
  minimums,
}: {
  rows: Row[];
  minimums: { productId: string; name: string; minQuantity: string }[];
}) {
  const t = useTranslations('stock');
  const router = useRouter();

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(minimums.map((item) => [item.productId, item.minQuantity])),
  );
  const [error, setError] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  async function saveMinimum(productId: string) {
    setPending(true);
    setError(null);
    const response = await fetch('/api/stock/minimum', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId, minQuantity: values[productId] ?? '' }),
    });
    const data = (await response.json()) as { status?: string };
    setPending(false);
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    router.refresh();
  }

  async function draft() {
    setPending(true);
    setError(null);
    setDrafted(null);
    const response = await fetch('/api/stock/replenishment', { method: 'POST' });
    const data = (await response.json()) as { status?: string; added?: number };
    setPending(false);
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    setDrafted(data.added ?? 0);
    router.refresh();
  }

  if (minimums.length === 0) return null;

  return (
    <Card className="mt-4" data-testid="replenishment">
      <CardTitle className="text-[15px]">{t('minimumTitle')}</CardTitle>
      <p className="text-muted-foreground mt-1 text-[13px] font-semibold">{t('minimumHint')}</p>

      <ul className="mt-3 space-y-2 text-sm" data-testid="minimum-list">
        {minimums.map((item) => (
          <li key={item.productId} className="flex flex-wrap items-center gap-3">
            <span className="min-w-40 flex-1 break-words">{item.name}</span>
            <Input
              className="h-9 w-24"
              inputMode="decimal"
              value={values[item.productId] ?? ''}
              data-testid={`minimum-${item.productId}`}
              onChange={(event) =>
                setValues((current) => ({ ...current, [item.productId]: event.target.value }))
              }
            />
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              data-testid={`minimum-save-${item.productId}`}
              onClick={() => void saveMinimum(item.productId)}
            >
              {t('minimumSave')}
            </Button>
          </li>
        ))}
      </ul>

      {rows.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-medium">{t('belowMinimumTitle')}</h3>
          <ul className="mt-2 space-y-1 text-sm" data-testid="below-minimum">
            {rows.map((row) => (
              <li
                key={row.productId}
                className="flex flex-wrap items-baseline justify-between gap-2"
                data-testid={`below-${row.productId}`}
              >
                <span className="break-words">
                  {row.name}
                  <span className="text-muted-foreground">
                    {' '}
                    · {row.quantity} / {row.minQuantity}
                    {row.supplierName ? ` · ${row.supplierName}` : ''}
                  </span>
                </span>
                <span className="tabular-nums">{t('suggested', { quantity: row.suggested })}</span>
              </li>
            ))}
          </ul>

          <Button
            className="mt-3"
            disabled={pending}
            data-testid="replenishment-draft"
            onClick={() => void draft()}
          >
            {t('draftOrder')}
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm" data-testid="below-minimum-empty">
          {t('nothingBelowMinimum')}
        </p>
      )}

      {drafted !== null ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="replenishment-drafted">
          {t('drafted', { count: drafted })}
        </p>
      ) : null}
      {error ? (
        <p
          className="text-danger mt-2 text-sm font-semibold"
          role="alert"
          data-testid="replenishment-error"
        >
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </Card>
  );
}
