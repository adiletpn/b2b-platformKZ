'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProductPhoto } from '@/components/product-photo';
import type { FeedOffer } from './types';

const SWIPE_THRESHOLD = 80;
/** Перемещение меньше этого считается тапом по карточке, а не свайпом. */
const TAP_THRESHOLD = 8;

/** Свайп-колода (раздел 3.3 ТЗ): вправо — беру, влево — пропустить, вверх — в избранное. */
export function SwipeDeck({
  offers,
  locale,
  onDecision,
  onUndo,
  onOpenDetails,
  canUndo,
}: {
  offers: FeedOffer[];
  locale: 'ru' | 'kk';
  onDecision: (offer: FeedOffer, action: 'LIKE' | 'SKIP' | 'FAV') => void;
  onUndo: () => void;
  onOpenDetails: (offer: FeedOffer) => void;
  canUndo: boolean;
}) {
  const t = useTranslations('feed');
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const current = offers[0];

  function onPointerDown(event: React.PointerEvent) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (pointerStart.current === null) return;
    setDragX(event.clientX - pointerStart.current.x);
    setDragY(event.clientY - pointerStart.current.y);
  }

  function onPointerUp() {
    if (pointerStart.current === null) return;
    const offsetX = dragX;
    const offsetY = dragY;
    pointerStart.current = null;
    setDragX(0);
    setDragY(0);
    if (!current) return;

    // Свайп вверх сильнее горизонтального — избранное (раздел 3.3 ТЗ).
    if (-offsetY > SWIPE_THRESHOLD && -offsetY > Math.abs(offsetX)) {
      onDecision(current, 'FAV');
      return;
    }
    // Короткое нажатие без перемещения — подробности и сравнение цен.
    if (Math.abs(offsetX) < TAP_THRESHOLD && Math.abs(offsetY) < TAP_THRESHOLD) {
      onOpenDetails(current);
      return;
    }
    if (Math.abs(offsetX) < SWIPE_THRESHOLD) return;
    onDecision(current, offsetX > 0 ? 'LIKE' : 'SKIP');
  }

  if (!current) {
    return (
      <div className="border-border text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        <p data-testid="feed-empty">{t('emptyFeed')}</p>
        {canUndo ? (
          <Button className="mt-4" variant="outline" onClick={onUndo} data-testid="swipe-undo">
            {t('undo')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="border-border bg-card touch-none rounded-xl border p-5 shadow-sm select-none"
        style={{ transform: `translate(${dragX}px, ${dragY}px) rotate(${dragX / 40}deg)` }}
        data-testid="swipe-card"
        data-offer-id={current.id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <ProductPhoto
          size="lg"
          src={current.photoUrl}
          name={locale === 'kk' ? current.nameKk : current.nameRu}
          className="mb-4"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground min-w-0 truncate text-xs">
            {t('supplier')}: {current.supplierName}
          </p>
          {current.supplierRating ? (
            <Badge tone="success" data-testid="swipe-supplier-rating">
              ★ {current.supplierRating}
            </Badge>
          ) : (
            <Badge data-testid="swipe-supplier-few-ratings">{t('fewRatings')}</Badge>
          )}
        </div>
        <h2 className="mt-1 text-xl font-semibold break-words" data-testid="swipe-card-name">
          {locale === 'kk' ? current.nameKk : current.nameRu}
        </h2>
        {current.brand ? <p className="text-muted-foreground text-sm">{current.brand}</p> : null}

        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="swipe-badges">
          {current.isPromo ? (
            <Badge tone="danger" data-testid="badge-promo">
              {t('promo')}
            </Badge>
          ) : null}
          {current.isNew ? (
            <Badge tone="info" data-testid="badge-new">
              {t('new')}
            </Badge>
          ) : null}
          {current.isCheapest ? (
            <Badge tone="success" data-testid="badge-cheapest">
              {t('cheapest')}
            </Badge>
          ) : null}
          {current.isFavorite ? (
            <Badge tone="warning" data-testid="badge-favorite">
              {t('favorite')}
            </Badge>
          ) : null}
        </div>

        <p className="mt-3 text-3xl font-semibold tabular-nums">
          {current.priceWithVat} <span className="text-muted-foreground text-base">₸</span>
          {Number(current.discountPercent) > 0 ? (
            <span
              className="text-muted-foreground ml-2 text-base font-normal line-through"
              data-testid="swipe-base-price"
            >
              {current.basePriceWithVat}
            </span>
          ) : null}
        </p>

        {current.supplierCount > 1 ? (
          <p className="text-muted-foreground mt-1 text-xs" data-testid="swipe-compare">
            {t('comparePrices', { count: current.supplierCount })}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-1 text-xs">{t('tapForDetails')}</p>

        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('perPack')}</dt>
            <dd className="tabular-nums">{current.pricePerPack} ₸</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('minBatch')}</dt>
            <dd className="tabular-nums">
              {current.minBatch} {locale === 'kk' ? current.unitKk : current.unitRu}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {t('leadTime', { days: current.leadTimeDays })}
            </dt>
            <dd />
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-12"
          onClick={() => onDecision(current, 'SKIP')}
          data-testid="swipe-skip"
        >
          {t('skip')}
        </Button>
        <Button
          className="h-12"
          onClick={() => onDecision(current, 'LIKE')}
          data-testid="swipe-take"
        >
          {t('take')}
        </Button>
        <Button
          variant="outline"
          className="col-span-2 h-12"
          onClick={() => onDecision(current, 'FAV')}
          data-testid="swipe-favorite"
        >
          {t('toFavorites')}
        </Button>
        <Button
          variant="ghost"
          className="col-span-2"
          onClick={() => onOpenDetails(current)}
          data-testid="swipe-details"
        >
          {t('detailsButton')}
        </Button>
        <Button
          variant="ghost"
          className="col-span-2"
          disabled={!canUndo}
          onClick={onUndo}
          data-testid="swipe-undo"
        >
          {t('undo')}
        </Button>
      </div>
    </div>
  );
}
