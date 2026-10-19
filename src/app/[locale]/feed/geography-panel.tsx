'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Geography } from '@/lib/feed/geography';

/**
 * Раздел 3.9 ТЗ: точки и склады поставщиков в городе и поставщики соседних городов.
 * Карта с тайлами требует внешнего провайдера, в демо внешних вызовов нет —
 * показывается список адресов, на который карта и опирается.
 */
export function GeographyPanel({ locale }: { locale: 'ru' | 'kk' }) {
  const t = useTranslations('feed');
  const [geography, setGeography] = useState<Geography | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    setOpen(true);
    if (geography) return;
    const response = await fetch('/api/feed/geography');
    if (!response.ok) return;
    setGeography((await response.json()) as Geography);
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        data-testid="open-geography"
        onClick={() => void load()}
      >
        {t('geography.open')}
      </Button>
    );
  }

  return (
    <Card className="mt-4" data-testid="geography">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm">{t('geography.title')}</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          data-testid="close-geography"
          onClick={() => setOpen(false)}
        >
          {t('close')}
        </Button>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">{t('geography.hint')}</p>

      {geography === null ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('geography.loading')}</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1 text-sm" data-testid="geography-points">
            {geography.points.length === 0 ? (
              <li className="text-muted-foreground">{t('geography.noPoints')}</li>
            ) : (
              geography.points.map((point) => (
                <li
                  key={`${point.companyId}-${point.address}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="break-words">
                    {point.companyName} — {point.address}
                  </span>
                  <Badge tone={point.deliversToCity ? 'success' : undefined}>
                    {t(`geography.${point.type === 'WAREHOUSE' ? 'warehouse' : 'point'}`)}
                  </Badge>
                </li>
              ))
            )}
          </ul>

          <h3 className="mt-4 text-sm font-medium">{t('geography.nearbyTitle')}</h3>
          <ul className="mt-2 space-y-1 text-sm" data-testid="geography-nearby">
            {geography.nearby.length === 0 ? (
              <li className="text-muted-foreground">{t('geography.noNearby')}</li>
            ) : (
              geography.nearby.map((supplier) => (
                <li key={supplier.companyId} className="break-words">
                  {supplier.companyName} ·{' '}
                  {locale === 'kk' ? supplier.cityNameKk : supplier.cityNameRu}
                  <span className="text-muted-foreground"> — {t('geography.askInChat')}</span>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </Card>
  );
}
