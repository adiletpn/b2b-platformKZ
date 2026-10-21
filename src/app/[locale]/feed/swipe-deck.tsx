'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Star, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProductPhoto } from '@/components/product-photo';
import { money, quantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import { initials } from '@/components/ui/controls';
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

  function onPointerUp(event: React.PointerEvent) {
    const start = pointerStart.current;
    if (start === null) return;
    // Смещение считаем по самому событию: состояние dragX после быстрого жеста
    // может ещё не обновиться, и свайп принимался за тап.
    const offsetX = event.clientX - start.x;
    const offsetY = event.clientY - start.y;
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
      <div className="border-border text-muted-foreground rounded-[28px] border-[1.5px] border-dashed p-8 text-center text-sm font-semibold">
        <p data-testid="feed-empty">{t('emptyFeed')}</p>
        {canUndo ? (
          <Button className="mt-4" variant="outline" onClick={onUndo} data-testid="swipe-undo">
            {t('undo')}
          </Button>
        ) : null}
      </div>
    );
  }

  const name = locale === 'kk' ? current.nameKk : current.nameRu;
  const unit = locale === 'kk' ? current.unitKk : current.unitRu;
  const discounted = Number(current.discountPercent) > 0;

  return (
    <div>
      {/* Стопка из трёх карточек, как в макете M03. */}
      <div className="relative pt-[22px]">
        <div className="border-border bg-card absolute inset-x-[26px] top-0 bottom-6 rounded-[28px] border opacity-70" />
        <div className="border-border bg-card absolute inset-x-[13px] top-2.5 bottom-3 rounded-[28px] border shadow-[0_10px_24px_-14px_rgb(70_50_15/0.25)]" />
        <div
          className="border-border bg-card relative flex touch-none flex-col overflow-hidden rounded-[28px] border shadow-[var(--shadow-strong)] select-none"
          style={{ transform: `translate(${dragX}px, ${dragY}px) rotate(${dragX / 40}deg)` }}
          data-testid="swipe-card"
          data-offer-id={current.id}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="bg-surface relative grid h-[300px] place-items-center">
            <ProductPhoto size="hero" src={current.photoUrl} name={name} />
            <div
              className="absolute top-3.5 left-3.5 flex flex-col items-start gap-1.5"
              data-testid="swipe-badges"
            >
              {current.isPromo ? (
                <Badge tone="solid" data-testid="badge-promo">
                  {discounted
                    ? t('promoPercent', { percent: current.discountPercent.replace(/\.0+$/, '') })
                    : t('promo')}
                </Badge>
              ) : null}
              {current.isCheapest ? (
                <Badge className="bg-card text-success" data-testid="badge-cheapest">
                  {t('cheapest')}
                </Badge>
              ) : null}
              {current.isFavorite ? (
                <Badge className="bg-card text-primary-text" data-testid="badge-favorite">
                  {t('favorite')}
                </Badge>
              ) : null}
            </div>
            {current.isNew ? (
              <Badge
                className="bg-card text-foreground absolute top-3.5 right-3.5"
                data-testid="badge-new"
              >
                {t('new')}
              </Badge>
            ) : null}
          </div>

          <div className="px-[18px] pt-3.5 pb-4">
            <h2
              className="text-[19px] leading-tight font-extrabold tracking-[-0.015em] break-words"
              data-testid="swipe-card-name"
            >
              {name}
            </h2>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-[26px] font-black tabular-nums">
                {money(current.priceWithVat)} ₸
              </span>
              <span className="text-muted-foreground text-sm font-semibold">
                {t('perUnitShort', { unit })}
              </span>
              {discounted ? (
                <span
                  className="text-sm font-semibold text-[#bbb4ab] line-through"
                  data-testid="swipe-base-price"
                >
                  {money(current.basePriceWithVat)} ₸
                </span>
              ) : null}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[13px] font-semibold">
              {t('packLine', {
                price: money(current.pricePerPack),
                size: quantity(current.packSize),
                min: quantity(current.minBatch),
                unit,
              })}
            </p>

            <div className="border-border mt-3 flex items-center gap-2.5 border-t pt-3">
              <span className="bg-primary grid size-[34px] shrink-0 place-items-center rounded-xl text-xs font-black text-white">
                {initials(current.supplierName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{current.supplierName}</p>
                <p className="text-muted-foreground text-xs font-semibold">
                  {current.supplierRating ? (
                    <span data-testid="swipe-supplier-rating">
                      <span className="text-foreground font-bold">
                        <Star
                          aria-hidden
                          className="fill-primary text-primary -mt-0.5 mr-0.5 inline size-3.5"
                        />
                        {current.supplierRating.replace('.', ',')}
                      </span>
                      {' · '}
                      {t('ratingsCount', { count: current.supplierRatingCount })}
                    </span>
                  ) : (
                    <span data-testid="swipe-supplier-few-ratings">{t('fewRatings')}</span>
                  )}
                </p>
              </div>
              <Badge tone={current.leadTimeDays <= 1 ? 'success' : 'neutral'}>
                {current.leadTimeDays <= 1
                  ? t('tomorrow')
                  : t('inDays', { days: current.leadTimeDays })}
              </Badge>
            </div>
            {current.supplierCount > 1 ? (
              <p
                className="text-muted-foreground mt-2 text-xs font-semibold"
                data-testid="swipe-compare"
              >
                {t('comparePrices', { count: current.supplierCount })}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Кнопки макета: отменить 50, пропустить 66, избранное 50, беру 66. */}
      <div className="flex items-center justify-center gap-[18px] pt-4 pb-1">
        <RoundButton
          size={50}
          label={t('undo')}
          disabled={!canUndo}
          onClick={onUndo}
          testId="swipe-undo"
        >
          <Undo2 className="text-muted-foreground size-5" strokeWidth={2.6} />
        </RoundButton>
        <RoundButton
          size={66}
          label={t('skip')}
          onClick={() => onDecision(current, 'SKIP')}
          testId="swipe-skip"
        >
          <X className="text-danger size-7" strokeWidth={2.6} />
        </RoundButton>
        <RoundButton
          size={50}
          label={t('toFavorites')}
          onClick={() => onDecision(current, 'FAV')}
          testId="swipe-favorite"
        >
          <Star className="text-primary size-5" strokeWidth={2.6} />
        </RoundButton>
        <RoundButton
          size={66}
          label={t('take')}
          onClick={() => onDecision(current, 'LIKE')}
          testId="swipe-take"
          primary
        >
          <Check className="size-[30px] text-white" strokeWidth={2.6} />
        </RoundButton>
      </div>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground mx-auto mt-1 block text-[13px] font-bold"
        onClick={() => onOpenDetails(current)}
        data-testid="swipe-details"
      >
        {t('detailsButton')}
      </button>
    </div>
  );
}

/** Круглая кнопка свайп-ленты по макету: белая с тенью или оранжевая. */
function RoundButton({
  size,
  label,
  onClick,
  testId,
  primary = false,
  disabled = false,
  children,
}: {
  size: 50 | 66;
  label: string;
  onClick: () => void;
  testId: string;
  primary?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'grid place-items-center rounded-full shadow-[0_10px_22px_-10px_rgb(70_50_15/0.45)] transition-transform active:scale-95 disabled:opacity-40',
        size === 66 ? 'size-[66px]' : 'size-[50px]',
        primary ? 'bg-primary' : 'border-border bg-card border',
      )}
    >
      {children}
    </button>
  );
}
