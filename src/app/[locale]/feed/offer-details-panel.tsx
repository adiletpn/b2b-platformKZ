'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProductPhoto } from '@/components/product-photo';
import type { OfferDetails } from '@/lib/feed/offer-details';

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
  const name = locale === 'kk' ? details.nameKk : details.nameRu;

  const marks = (
    [
      ['marked', details.isMarked],
      ['excise', details.isExcise],
      ['snt', details.requiresSnt],
      ['licensed', details.isLicensed],
    ] as const
  ).filter(([, value]) => value);

  return (
    <div
      className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
      data-testid="offer-details"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium break-words" data-testid="details-name">
            {name}
          </h2>
          <p className="text-muted-foreground font-mono text-xs">{details.barcode}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} data-testid="details-close">
          {t('close')}
        </Button>
      </div>

      <ProductPhoto size="lg" src={details.photoUrls[0] ?? null} name={name} className="mt-3" />

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
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
          <div key={key}>
            <dt className="text-muted-foreground text-xs">{t(`details.${key}`)}</dt>
            <dd className="break-words" data-testid={`details-${key}`}>
              {value ?? '—'}
            </dd>
          </div>
        ))}
      </dl>

      {marks.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="details-marks">
          {marks.map(([key]) => (
            <Badge key={key} tone="warning">
              {t(`details.${key}`)}
            </Badge>
          ))}
        </div>
      ) : null}

      <h3 className="mt-4 text-sm font-medium">{t('details.comparison')}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="px-2 py-2 font-medium">{t('supplier')}</th>
              <th className="px-2 py-2 font-medium">{t('details.price')}</th>
              <th className="px-2 py-2 font-medium">{t('minBatch')}</th>
              <th className="px-2 py-2 font-medium">{t('details.lead')}</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y" data-testid="details-offers">
            {details.offers.map((offer) => (
              <tr key={offer.offerId} data-testid={`details-offer-${offer.offerId}`}>
                <td className="px-2 py-2 break-words">
                  {offer.supplierName}
                  {offer.supplierRating ? ` · ★ ${offer.supplierRating}` : ''}
                  {offer.isCurrent ? ` · ${t('details.current')}` : ''}
                </td>
                <td className="px-2 py-2 tabular-nums">{offer.priceWithVat} ₸</td>
                <td className="px-2 py-2 tabular-nums">{offer.minBatch}</td>
                <td className="px-2 py-2 tabular-nums">{offer.leadTimeDays}</td>
                <td className="px-2 py-2 text-right">
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
                    <span className="text-muted-foreground text-xs">{t('outOfStock')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
