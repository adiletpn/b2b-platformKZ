'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Decimal from 'decimal.js';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProductPhoto } from '@/components/product-photo';
import type { OfferDetails } from '@/lib/feed/offer-details';
import { money, quantity } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Тап по карточке: подробности товара и сравнение цен (раздел 3.3 ТЗ). */
export function OfferDetailsPanel({
  details,
  locale,
  onClose,
  onTake,
}: {
  details: OfferDetails;
  locale: 'ru' | 'kk';
  onClose: () => void;
  onTake: (offerId: string) => void;
}) {
  const t = useTranslations('feed');
  const panel = useRef<HTMLDivElement>(null);
  const name = locale === 'kk' ? details.nameKk : details.nameRu;

  // Панель открывается под колодой: подводим её к глазам пользователя.
  useEffect(() => {
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [details.offerId]);

  const marks = (
    [
      ['marked', details.isMarked],
      ['excise', details.isExcise],
      ['snt', details.requiresSnt],
      ['licensed', details.isLicensed],
    ] as const
  ).filter(([, value]) => value);

  // Лучшая цена среди тех, у кого товар есть; сравнение в Decimal (правило 1).
  const bestOfferId = details.offers
    .filter((offer) => offer.inStock)
    .reduce<(typeof details.offers)[number] | null>(
      (best, offer) =>
        !best || new Decimal(offer.priceWithVat).lessThan(best.priceWithVat) ? offer : best,
      null,
    )?.offerId;

  return (
    <div
      ref={panel}
      className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
      data-testid="offer-details"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            className="text-[21px] font-black tracking-[-0.02em] break-words"
            data-testid="details-name"
          >
            {name}
          </h2>
          <p className="text-muted-foreground text-[13px] font-bold tabular-nums">
            {details.barcode}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} data-testid="details-close">
          {t('close')}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <ProductPhoto size="md" src={details.photoUrls[0] ?? null} name={name} />

        {/* Макет M04: характеристики плитками на сером. */}
        <dl className="grid min-w-56 flex-1 grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {(
            [
              ['brand', details.brand],
              ['manufacturer', details.manufacturer],
              ['country', details.country],
              ['packSize', details.packSize],
              ['minBatch', details.minBatch],
              ['expiresAt', details.expiresAt],
              ['tnved', details.tnvedCode],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="bg-muted rounded-[14px] px-3 py-2.5">
              <dt className="text-muted-foreground text-[11px] font-semibold">
                {t(`details.${key}`)}
              </dt>
              <dd
                className="mt-0.5 text-sm font-extrabold break-words"
                data-testid={`details-${key}`}
              >
                {value === null || value === undefined
                  ? '—'
                  : key === 'packSize' || key === 'minBatch'
                    ? quantity(value)
                    : value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {marks.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="details-marks">
          {marks.map(([key]) => (
            <Badge key={key} tone="warning">
              {t(`details.${key}`)}
            </Badge>
          ))}
        </div>
      ) : null}

      <h3 className="mt-4 text-[15px] font-extrabold">{t('details.comparison')}</h3>
      {/* Макет M04: поставщики карточками, лучшая цена зелёным. */}
      <ul className="mt-2 space-y-2" data-testid="details-offers">
        {details.offers.map((offer) => {
          const best = offer.offerId === bestOfferId;
          return (
            <li
              key={offer.offerId}
              className={cn(
                'flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3',
                best ? 'bg-success-soft' : 'border-border bg-card border',
              )}
              data-testid={`details-offer-${offer.offerId}`}
            >
              <div className="min-w-40 flex-1">
                <p className="text-sm font-bold break-words">
                  {offer.supplierName}
                  {offer.isCurrent ? (
                    <span className="text-muted-foreground font-semibold">
                      {' '}
                      · {t('details.current')}
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs font-semibold">
                  {offer.supplierRating ? (
                    <span className="inline-flex items-center gap-[3px] font-bold">
                      <Star aria-hidden className="fill-primary text-primary size-[13px]" />
                      {offer.supplierRating}
                      {' · '}
                    </span>
                  ) : null}
                  {t('minBatch')} {quantity(offer.minBatch)} · {t('details.lead')}{' '}
                  {offer.leadTimeDays}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-black tabular-nums">{money(offer.priceWithVat)} ₸</p>
                {best ? (
                  <p className="text-success text-[11px] font-extrabold">
                    {t('details.bestPrice')}
                  </p>
                ) : null}
              </div>
              {offer.inStock ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid={`details-take-${offer.offerId}`}
                  onClick={() => onTake(offer.offerId)}
                >
                  {t('take')}
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs font-semibold">
                  {t('outOfStock')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
