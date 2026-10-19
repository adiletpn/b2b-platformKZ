'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { FeedOffer } from './types';

const SWIPE_THRESHOLD = 80;

/** Свайп-колода (раздел 3.3 ТЗ): вправо — беру, влево — пропустить. */
export function SwipeDeck({
  offers,
  locale,
  onDecision,
  onUndo,
  canUndo,
}: {
  offers: FeedOffer[];
  locale: 'ru' | 'kk';
  onDecision: (offer: FeedOffer, action: 'LIKE' | 'SKIP') => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const t = useTranslations('feed');
  const [dragX, setDragX] = useState(0);
  const pointerStart = useRef<number | null>(null);
  const current = offers[0];

  function onPointerDown(event: React.PointerEvent) {
    pointerStart.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (pointerStart.current === null) return;
    setDragX(event.clientX - pointerStart.current);
  }

  function onPointerUp() {
    if (pointerStart.current === null) return;
    const offset = dragX;
    pointerStart.current = null;
    setDragX(0);
    if (!current || Math.abs(offset) < SWIPE_THRESHOLD) return;
    onDecision(current, offset > 0 ? 'LIKE' : 'SKIP');
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
        style={{ transform: `translateX(${dragX}px) rotate(${dragX / 40}deg)` }}
        data-testid="swipe-card"
        data-offer-id={current.id}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <p className="text-muted-foreground text-xs">
          {t('supplier')}: {current.supplierName}
        </p>
        <h2 className="mt-1 text-lg font-semibold break-words" data-testid="swipe-card-name">
          {locale === 'kk' ? current.nameKk : current.nameRu}
        </h2>
        {current.brand ? <p className="text-muted-foreground text-sm">{current.brand}</p> : null}

        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('perUnit')}</dt>
            <dd className="font-medium tabular-nums">{current.priceWithVat} ₸</dd>
          </div>
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

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => onDecision(current, 'SKIP')}
          data-testid="swipe-skip"
        >
          {t('skip')}
        </Button>
        <Button
          className="flex-1"
          onClick={() => onDecision(current, 'LIKE')}
          data-testid="swipe-take"
        >
          {t('take')}
        </Button>
        <Button
          variant="ghost"
          className="w-full"
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
