'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { ProductPhoto } from '@/components/product-photo';
import { SwipeDeck } from './swipe-deck';
import { OfferDetailsPanel } from './offer-details-panel';
import type { OfferDetails } from '@/lib/feed/offer-details';
import type { FeedOffer, Option } from './types';
import { Page } from '@/components/ui/page';

type Mode = 'auto' | 'swipe' | 'list';

export function FeedScreen({
  locale,
  cityName,
  initialSwipeOffers,
  initialListOffers,
  categories,
  suppliers,
  brands,
  cartQuantities,
}: {
  locale: 'ru' | 'kk';
  cityName: string;
  initialSwipeOffers: FeedOffer[];
  initialListOffers: FeedOffer[];
  categories: Option[];
  suppliers: Option[];
  brands: string[];
  cartQuantities: Record<string, string>;
}) {
  const t = useTranslations('feed');
  const [mode, setMode] = useState<Mode>('auto');
  const [swipeOffers, setSwipeOffers] = useState(initialSwipeOffers);
  /** Последний отправленный свайп: «отменить» ждёт его, чтобы не обогнать запись. */
  const lastSwipe = useRef<Promise<unknown> | null>(null);
  const [listOffers, setListOffers] = useState(initialListOffers);
  const [quantities, setQuantities] = useState<Record<string, string>>(cartQuantities);
  const [swipeCount, setSwipeCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [brand, setBrand] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [flags, setFlags] = useState({
    onlyPromo: false,
    onlyNew: false,
    onlyTomorrow: false,
    onlyFavorites: false,
  });
  const [details, setDetails] = useState<OfferDetails | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const swipeClass = mode === 'auto' ? 'md:hidden' : mode === 'swipe' ? '' : 'hidden';
  const listClass = mode === 'auto' ? 'hidden md:block' : mode === 'list' ? '' : 'hidden';

  async function reloadList(
    next?: Partial<Record<string, string>>,
    nextFlags?: Partial<typeof flags>,
  ) {
    const active = { ...flags, ...nextFlags };
    const params = new URLSearchParams({
      mode: 'list',
      search: next?.search ?? search,
      categoryId: next?.categoryId ?? categoryId,
      supplierId: next?.supplierId ?? supplierId,
      brand: next?.brand ?? brand,
      priceMax: next?.priceMax ?? priceMax,
      ...(active.onlyPromo ? { onlyPromo: 'true' } : {}),
      ...(active.onlyNew ? { onlyNew: 'true' } : {}),
      ...(active.onlyTomorrow ? { onlyTomorrow: 'true' } : {}),
      ...(active.onlyFavorites ? { onlyFavorites: 'true' } : {}),
    });
    for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);

    const response = await fetch(`/api/feed?${params.toString()}`);
    if (!response.ok) return;
    const data = (await response.json()) as { offers: FeedOffer[] };
    setListOffers(data.offers);
  }

  /** Раздел 3.3 ТЗ: «отменить» возвращает именно последнюю карточку, поэтому она идёт первой. */
  async function reloadSwipe(bringToFrontId?: string) {
    const response = await fetch('/api/feed?mode=swipe');
    if (!response.ok) return;
    const data = (await response.json()) as { offers: FeedOffer[] };

    const returned = bringToFrontId
      ? data.offers.find((offer) => offer.id === bringToFrontId)
      : undefined;
    setSwipeOffers(
      returned
        ? [returned, ...data.offers.filter((offer) => offer.id !== returned.id)]
        : data.offers,
    );
  }

  async function decide(offer: FeedOffer, action: 'LIKE' | 'SKIP' | 'FAV') {
    setSwipeOffers((current) => current.filter((item) => item.id !== offer.id));
    setSwipeCount((count) => count + 1);
    setNotice(action === 'LIKE' ? 'added' : action === 'FAV' ? 'favorited' : null);

    // Карточка уходит сразу, но «отменить» должно ждать записи свайпа, иначе отменять нечего.
    const saving = fetch('/api/feed/swipe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerId: offer.id, action }),
    });
    lastSwipe.current = saving;
    await saving;

    if (action === 'LIKE') {
      setQuantities((current) => ({ ...current, [offer.id]: offer.minBatch }));
    }
  }

  async function undo() {
    await lastSwipe.current;
    const response = await fetch('/api/feed/undo', { method: 'POST' });
    if (!response.ok) return;
    const data = (await response.json()) as { undone: { offerId: string } | null };
    if (!data.undone) return;

    setSwipeCount((count) => Math.max(0, count - 1));
    setNotice('undone');
    setQuantities((current) => {
      const next = { ...current };
      delete next[data.undone!.offerId];
      return next;
    });
    await reloadSwipe(data.undone.offerId);
  }

  /** Тап по карточке: подробности товара и сравнение цен (раздел 3.3 ТЗ). */
  async function openDetails(offer: FeedOffer) {
    const response = await fetch(`/api/feed/${offer.id}`);
    if (!response.ok) return;
    setDetails((await response.json()) as OfferDetails);
  }

  /** Из сравнения можно взять товар у того поставщика, у кого дешевле. */
  async function takeFromDetails(offerId: string) {
    const chosen =
      swipeOffers.find((offer) => offer.id === offerId) ??
      listOffers.find((offer) => offer.id === offerId);
    setDetails(null);
    if (chosen) {
      await decide(chosen, 'LIKE');
      return;
    }

    // Карточка другого поставщика может быть вне текущей выборки — кладём напрямую.
    await fetch('/api/feed/swipe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerId, action: 'LIKE' }),
    });
    setNotice('added');
    await Promise.all([reloadSwipe(), reloadList()]);
  }

  async function setQuantity(offer: FeedOffer, value: string) {
    setQuantities((current) => ({ ...current, [offer.id]: value }));
    const response = await fetch('/api/cart/item', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offerId: offer.id, quantity: value || '0' }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as { quantity: string; removed: boolean };
    setQuantities((current) => ({ ...current, [offer.id]: data.removed ? '' : data.quantity }));
  }

  async function repeatLastOrder() {
    const response = await fetch('/api/cart/repeat', { method: 'POST' });
    if (!response.ok) return;
    const data = (await response.json()) as { repeated: number };
    setNotice(data.repeated > 0 ? `repeated:${data.repeated}` : 'noPreviousOrder');
  }

  /** Дебаунс: без него запрос уходит на каждую букву и таблица перерисовывается под руками. */
  function onSearchChange(value: string) {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void reloadList({ search: value }), 250);
  }

  function resetFilters() {
    setSearch('');
    setCategoryId('');
    setSupplierId('');
    setBrand('');
    setPriceMax('');
    const cleared = {
      onlyPromo: false,
      onlyNew: false,
      onlyTomorrow: false,
      onlyFavorites: false,
    };
    setFlags(cleared);
    void reloadList(
      { search: '', categoryId: '', supplierId: '', brand: '', priceMax: '' },
      cleared,
    );
  }

  return (
    <Page width="lg">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">
            {t('cityLabel')}: <span data-testid="feed-city">{cityName}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={mode === 'swipe' ? 'default' : 'outline'}
            onClick={() => setMode('swipe')}
            data-testid="mode-swipe"
          >
            {t('modeSwipe')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'list' ? 'default' : 'outline'}
            onClick={() => setMode('list')}
            data-testid="mode-list"
          >
            {t('modeList')}
          </Button>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={repeatLastOrder}
          data-testid="repeat-last-order"
        >
          {t('repeatLastOrder')}
        </Button>
      </div>

      {notice ? (
        <p className="text-muted-foreground mt-3 text-sm" data-testid="feed-notice">
          {notice.startsWith('repeated:')
            ? t('repeated', { count: Number(notice.split(':')[1]) })
            : t(notice as 'added')}
        </p>
      ) : null}

      <section className={`mt-5 ${swipeClass}`} data-testid="swipe-mode">
        <SwipeDeck
          offers={swipeOffers}
          locale={locale}
          onDecision={decide}
          onUndo={undo}
          onOpenDetails={openDetails}
          canUndo={swipeCount > 0}
        />

        {details ? (
          <OfferDetailsPanel
            details={details}
            locale={locale}
            onClose={() => setDetails(null)}
            onTake={takeFromDetails}
          />
        ) : null}
      </section>

      <section className={`mt-5 ${listClass}`} data-testid="list-mode">
        <div className="border-border bg-card rounded-lg border p-4">
          <h2 className="text-muted-foreground text-sm font-medium">{t('filters.title')}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('filters.search')}>
              <Input
                value={search}
                data-testid="feed-search"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </Field>
            <Field label={t('filters.category')}>
              <select
                className="border-border bg-card h-11 w-full rounded-lg border px-3"
                value={categoryId}
                data-testid="filter-category"
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  void reloadList({ categoryId: event.target.value });
                }}
              >
                <option value="">{t('filters.all')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('filters.supplier')}>
              <select
                className="border-border bg-card h-11 w-full rounded-lg border px-3"
                value={supplierId}
                data-testid="filter-supplier"
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  void reloadList({ supplierId: event.target.value });
                }}
              >
                <option value="">{t('filters.all')}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('filters.brand')}>
              <select
                className="border-border bg-card h-11 w-full rounded-lg border px-3"
                value={brand}
                data-testid="filter-brand"
                onChange={(event) => {
                  setBrand(event.target.value);
                  void reloadList({ brand: event.target.value });
                }}
              >
                <option value="">{t('filters.all')}</option>
                {brands.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('filters.priceMax')}>
              <Input
                inputMode="decimal"
                value={priceMax}
                data-testid="filter-price-max"
                onChange={(event) => {
                  setPriceMax(event.target.value);
                  void reloadList({ priceMax: event.target.value });
                }}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-3">
              {(['onlyPromo', 'onlyNew', 'onlyTomorrow', 'onlyFavorites'] as const).map((flag) => (
                <label key={flag} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={flags[flag]}
                    data-testid={`filter-${flag}`}
                    onChange={(event) => {
                      const nextFlags = { ...flags, [flag]: event.target.checked };
                      setFlags(nextFlags);
                      void reloadList(undefined, nextFlags);
                    }}
                  />
                  {t(`filters.${flag}`)}
                </label>
              ))}

              <Button variant="ghost" onClick={resetFilters} data-testid="filter-reset">
                {t('filters.reset')}
              </Button>
            </div>
          </div>
        </div>

        {listOffers.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm" data-testid="list-empty">
            {t('emptyFeed')}
          </p>
        ) : (
          <div className="border-border bg-card shadow-card mt-4 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('filters.search')}</th>
                  <th className="px-3 py-2 font-medium">{t('supplier')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('perUnit')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('minBatch')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('quantity')}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y" data-testid="list-table">
                {listOffers.map((offer) => (
                  <tr key={offer.id} data-testid={`list-row-${offer.id}`}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2.5">
                        <ProductPhoto
                          size="sm"
                          src={offer.photoUrl}
                          name={locale === 'kk' ? offer.nameKk : offer.nameRu}
                          className="shrink-0"
                        />
                        <span className="break-words">
                          {locale === 'kk' ? offer.nameKk : offer.nameRu}
                        </span>
                      </span>
                      {!offer.inStock ? (
                        <span className="bg-muted text-muted-foreground ml-2 rounded px-1.5 py-0.5 text-xs">
                          {t('outOfStock')}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-3 py-2">{offer.supplierName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{offer.priceWithVat}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{offer.minBatch}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        className="ml-auto h-9 w-28 text-right"
                        inputMode="decimal"
                        disabled={!offer.inStock}
                        value={quantities[offer.id] ?? ''}
                        data-testid={`list-qty-${offer.id}`}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [offer.id]: event.target.value,
                          }))
                        }
                        onBlur={(event) => void setQuantity(offer, event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  );
}
