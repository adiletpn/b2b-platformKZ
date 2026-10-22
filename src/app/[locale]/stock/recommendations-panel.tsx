'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';

type Row = {
  productId: string;
  name: string;
  quantity: string;
  dailySales: string;
  daysLeft: string;
  suggested: string;
  supplierName: string | null;
};

/** Рекомендации закупок по скорости продаж кассы (этап 3 ТЗ, аналитика закупок). */
export function RecommendationsPanel({ rows }: { rows: Row[] }) {
  const t = useTranslations('stock.recommendations');
  const router = useRouter();
  const [drafted, setDrafted] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function draft() {
    setPending(true);
    setError(false);
    const response = await fetch('/api/stock/replenishment?kind=recommendations', {
      method: 'POST',
    });
    const data = (await response.json()) as { status?: string; added?: number };
    setPending(false);
    if (data.status !== 'ok') {
      setError(true);
      return;
    }
    setDrafted(data.added ?? 0);
    router.refresh();
  }

  return (
    <Card className="mt-4" data-testid="recommendations">
      <CardTitle className="text-[15px]">{t('title')}</CardTitle>
      <p className="text-muted-foreground mt-1 text-sm">{t('hint')}</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm" data-testid="recommendations-empty">
          {t('empty')}
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-1 text-sm">
            {rows.map((row) => (
              <li
                key={row.productId}
                className="flex flex-wrap items-baseline justify-between gap-2"
                data-testid="recommendation-row"
              >
                <span className="break-words">
                  {row.name}
                  <span className="text-muted-foreground">
                    {' '}
                    · {t('line', { daily: row.dailySales, days: row.daysLeft })}
                    {row.supplierName ? ` · ${row.supplierName}` : ''}
                  </span>
                </span>
                <span className="tabular-nums">{t('order', { quantity: row.suggested })}</span>
              </li>
            ))}
          </ul>
          <Button
            className="mt-3"
            disabled={pending}
            data-testid="recommendations-draft"
            onClick={() => void draft()}
          >
            {t('toCart')}
          </Button>
        </>
      )}
      {drafted !== null ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="recommendations-drafted">
          {t('drafted', { count: drafted })}
        </p>
      ) : null}
      {error ? (
        <p className="text-danger mt-2 text-sm" role="alert">
          {t('error')}
        </p>
      ) : null}
    </Card>
  );
}
