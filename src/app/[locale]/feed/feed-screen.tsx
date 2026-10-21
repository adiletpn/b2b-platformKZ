'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Decimal from 'decimal.js';
import { ChevronRight, MapPin, Repeat2, Search, Star } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProductPhoto } from '@/components/product-photo';
import { ChipToggle, Chip, PillSelect, Segmented, Stepper } from '@/components/ui/controls';
import { CartGroupCard } from '@/components/cart-group-card';
import { Link } from '@/i18n/navigation';
import { money, quantity as formatQuantity } from '@/lib/format';
import type { CartSupplierGroup } from '@/lib/cart/cart';
import { SwipeDeck } from './swipe-deck';
import { OfferDetailsPanel } from './offer-details-panel';
import { GeographyPanel } from './geography-panel';
import type { OfferDetails } from '@/lib/feed/offer-details';
import type { FeedOffer, Option } from './types';
import { EmptyState, Page } from '@/components/ui/page';

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
  initialCartGroups,
}: {
  locale: 'ru' | 'kk';
  cityName: string;
  initialSwipeOffers: FeedOffer[];
  initialListOffers: FeedOffer[];
  categories: Option[];
  suppliers: Option[];
  brands: string[];
  cartQuantities: Record<string, string>;
  initialCartGroups: CartSupplierGroup[];
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
  const [cartGroups, setCartGroups] = useState<CartSupplierGroup[]>(initialCartGroups);

  /** Правая панель корзины (макет D01): обновляется после каждого изменения количества. */
  async function reloadCart() {
    const response = await fetch('/api/cart');
    if (!response.ok) return;
    setCartGroups(((await response.json()) as { groups: CartSupplierGroup[] }).groups);
  }

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
      void reloadCart();
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
    const data = (await response.json()) as {
      quantity: string;
      removed: boolean;
      rounded: boolean;
    };
    setQuantities((current) => ({ ...current, [offer.id]: data.removed ? '' : data.quantity }));
    // Магазин должен видеть, что количество поменяли не просто так.
    if (data.rounded) setNotice('quantityAdjusted');
    void reloadCart();
  }

  /** Шаг степпера — кратность упаковки; первый «+» кладёт минимальную партию. */
  function step(offer: FeedOffer, direction: 1 | -1) {
    const current = new Decimal(quantities[offer.id] || '0');
    const pack = new Decimal(offer.packSize);
    const next =
      direction === 1
        ? current.isZero()
          ? new Decimal(offer.minBatch)
          : current.plus(pack)
        : Decimal.max(current.minus(pack), 0);
    void setQuantity(offer, next.isZero() ? '' : next.toFixed(3));
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

  const cartItems = cartGroups.reduce((sum, group) => sum + group.items.length, 0);
  const cartTotal = cartGroups
    .reduce((sum, group) => sum.plus(group.total), new Decimal(0))
    .toFixed(2);
  const swipeActive = mode === 'swipe' ? 'swipe' : mode === 'list' ? 'list' : null;

  return (
    <Page width="lg">
      {/* Шапка: на телефоне — город доставки (M03), на компьютере — полоса 80 px (D01). */}
      <header className="border-border mb-4 flex flex-wrap items-center gap-2.5 pt-1.5 lg:-mx-8 lg:mb-5 lg:min-h-20 lg:border-b lg:px-8 lg:py-3">
        <h1 className="hidden text-2xl font-black tracking-[-0.02em] lg:block">{t('title')}</h1>
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:order-2 lg:flex-none">
          <div className="lg:bg-primary-soft lg:text-primary-text flex items-center gap-2 lg:h-11 lg:rounded-full lg:pr-4 lg:pl-3">
            <span className="bg-primary-soft grid size-9 shrink-0 place-items-center rounded-xl lg:size-auto lg:bg-transparent">
              <MapPin aria-hidden className="text-primary size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-muted-foreground text-[11px] font-semibold lg:hidden">
                {t('cityDelivery')}
              </p>
              <p className="truncate text-base font-extrabold lg:text-sm" data-testid="feed-city">
                {cityName}
              </p>
            </div>
          </div>
        </div>
        <div className="flex-1 lg:order-1" />
        <Segmented
          className="w-full lg:order-3 lg:w-auto"
          value={swipeActive}
          onChange={(next) => setMode(next)}
          options={[
            {
              value: 'swipe',
              label: t('modeSwipe'),
              testId: 'mode-swipe',
              activeClass:
                mode === 'auto'
                  ? 'max-md:bg-card max-md:text-foreground max-md:shadow-[0_1px_4px_rgb(0_0_0/0.08)]'
                  : undefined,
            },
            {
              value: 'list',
              label: t('modeList'),
              testId: 'mode-list',
              activeClass:
                mode === 'auto'
                  ? 'md:bg-card md:text-foreground md:shadow-[0_1px_4px_rgb(0_0_0/0.08)]'
                  : undefined,
            },
          ]}
        />
      </header>

      {notice ? (
        <p
          className="bg-primary-soft text-primary-text mb-3 rounded-2xl px-4 py-2.5 text-sm font-bold"
          data-testid="feed-notice"
        >
          {notice.startsWith('repeated:')
            ? t('repeated', { count: Number(notice.split(':')[1]) })
            : t(notice as 'added')}
        </p>
      ) : null}

      {suppliers.length === 0 ? (
        // Пустая лента без объяснения выглядит как поломка: говорим, почему пусто и что дальше.
        <div className="mt-2" data-testid="feed-no-suppliers">
          <EmptyState>
            <span className="text-foreground block font-extrabold">
              {t('noSuppliersTitle', { city: cityName })}
            </span>
            <span className="mt-2 block">{t('noSuppliersText')}</span>
          </EmptyState>
        </div>
      ) : null}

      <section className={suppliers.length === 0 ? 'hidden' : swipeClass} data-testid="swipe-mode">
        {/* Свайп — мобильный сценарий: на широком экране колода остаётся карточкой. */}
        <div className="mx-auto w-full max-w-[350px]">
          <SwipeDeck
            offers={swipeOffers}
            locale={locale}
            onDecision={decide}
            onUndo={undo}
            onOpenDetails={openDetails}
            canUndo={swipeCount > 0}
          />
        </div>

        {details ? (
          <OfferDetailsPanel
            details={details}
            locale={locale}
            onClose={() => setDetails(null)}
            onTake={takeFromDetails}
          />
        ) : null}
      </section>

      <section className={suppliers.length === 0 ? 'hidden' : listClass} data-testid="list-mode">
        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            {/* Поиск по названию или штрихкоду (M05), фильтры-«пилюли» и чипы (D01). */}
            <label className="bg-muted flex h-[46px] items-center gap-2.5 rounded-full px-4 lg:h-11">
              <Search aria-hidden className="size-[18px] shrink-0 text-[#a49c92]" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-[#a49c92]"
                placeholder={t('searchPlaceholder')}
                aria-label={t('filters.search')}
                value={search}
                data-testid="feed-search"
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>

            <div className="mt-3 flex scrollbar-none gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible">
              <PillSelect
                aria-label={t('filters.category')}
                value={categoryId}
                data-testid="filter-category"
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  void reloadList({ categoryId: event.target.value });
                }}
              >
                <option value="">{t('filters.category')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </PillSelect>
              <PillSelect
                aria-label={t('filters.supplier')}
                value={supplierId}
                data-testid="filter-supplier"
                onChange={(event) => {
                  setSupplierId(event.target.value);
                  void reloadList({ supplierId: event.target.value });
                }}
              >
                <option value="">{t('filters.supplier')}</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </PillSelect>
              <PillSelect
                aria-label={t('filters.brand')}
                value={brand}
                data-testid="filter-brand"
                onChange={(event) => {
                  setBrand(event.target.value);
                  void reloadList({ brand: event.target.value });
                }}
              >
                <option value="">{t('filters.brand')}</option>
                {brands.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </PillSelect>
              <input
                inputMode="decimal"
                placeholder={t('filters.priceMax')}
                aria-label={t('filters.priceMax')}
                className="border-border bg-card placeholder:text-foreground h-[38px] w-36 shrink-0 rounded-full border px-3.5 text-[13px] font-bold outline-none"
                value={priceMax}
                data-testid="filter-price-max"
                onChange={(event) => {
                  setPriceMax(event.target.value);
                  void reloadList({ priceMax: event.target.value });
                }}
              />
              <Chip
                active={!Object.values(flags).some(Boolean)}
                onClick={resetFilters}
                data-testid="filter-reset"
              >
                {t('chipAll')}
              </Chip>
              {(['onlyTomorrow', 'onlyPromo', 'onlyNew', 'onlyFavorites'] as const).map((flag) => (
                <ChipToggle
                  key={flag}
                  label={t(`filters.${flag}`)}
                  checked={flags[flag]}
                  testId={`filter-${flag}`}
                  onChange={(checked) => {
                    const nextFlags = { ...flags, [flag]: checked };
                    setFlags(nextFlags);
                    void reloadList(undefined, nextFlags);
                  }}
                />
              ))}
            </div>

            {/* «Повторить прошлый заказ»: баннер на телефоне (M05), кнопка-пилюля на компьютере (D01). */}
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={repeatLastOrder}
                data-testid="repeat-last-order"
                className="bg-primary-soft flex w-full items-center gap-3 rounded-[20px] px-4 py-3.5 text-left lg:w-auto lg:rounded-full lg:py-2.5 lg:pr-4 lg:pl-3"
              >
                <span className="bg-primary grid size-[42px] shrink-0 place-items-center rounded-[14px] lg:size-auto lg:bg-transparent">
                  <Repeat2 aria-hidden className="lg:text-primary size-5 text-white" />
                </span>
                <span className="text-primary-text flex-1 text-[15px] font-extrabold lg:text-sm">
                  {t('repeatLastOrder')}
                </span>
                <ChevronRight aria-hidden className="text-primary size-[18px] lg:hidden" />
              </button>
              <GeographyPanel locale={locale} />
            </div>

            {listOffers.length === 0 ? (
              <p
                className="text-muted-foreground mt-4 text-sm font-semibold"
                data-testid="list-empty"
              >
                {t('emptyList')}
              </p>
            ) : (
              <div className="border-border bg-card mt-4 overflow-hidden rounded-[20px] border max-md:border-0 max-md:bg-transparent">
                <table className="w-full table-fixed text-sm max-md:block">
                  <colgroup className="max-md:hidden">
                    <col />
                    <col className="w-[22%]" />
                    <col className="w-[92px]" />
                    <col className="w-[100px]" />
                    <col className="w-[88px]" />
                    <col className="w-[136px]" />
                  </colgroup>
                  <thead className="border-border border-b text-left max-md:hidden">
                    <tr>
                      <th className="h-11 px-5 font-bold">{t('productColumn')}</th>
                      <th className="px-3 font-bold">{t('supplier')}</th>
                      <th className="px-3 text-right font-bold">{t('pricePerUnitColumn')}</th>
                      <th className="px-3 text-right font-bold">{t('boxColumn')}</th>
                      <th className="px-3 font-bold">{t('deliveryColumn')}</th>
                      <th className="px-5 text-right font-bold">{t('quantity')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y max-md:block" data-testid="list-table">
                    {listOffers.map((offer) => {
                      const name = locale === 'kk' ? offer.nameKk : offer.nameRu;
                      const unit = locale === 'kk' ? offer.unitKk : offer.unitRu;
                      const discounted = Number(offer.discountPercent) > 0;
                      return (
                        <tr
                          key={offer.id}
                          data-testid={`list-row-${offer.id}`}
                          className="max-md:flex max-md:items-center max-md:gap-3 max-md:py-2.5"
                        >
                          <td className="overflow-hidden py-2.5 pr-3 pl-5 max-md:min-w-0 max-md:flex-1 max-md:p-0">
                            <span className="flex items-center gap-3">
                              <ProductPhoto
                                size="md"
                                src={offer.photoUrl}
                                name={name}
                                className="shrink-0 max-md:size-[54px] md:size-11 md:rounded-xl"
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-bold">{name}</span>
                                <span className="text-muted-foreground block truncate text-xs font-semibold max-md:hidden">
                                  {offer.barcode}
                                </span>
                                <span className="text-muted-foreground block truncate text-xs font-semibold md:hidden">
                                  {offer.supplierName} · {formatQuantity(offer.packSize)} {unit}
                                </span>
                                <span className="block text-sm font-black md:hidden">
                                  {money(offer.priceWithVat)} ₸
                                </span>
                                {!offer.inStock ? (
                                  <Badge tone="danger" className="mt-1">
                                    {t('outOfStock')}
                                  </Badge>
                                ) : null}
                              </span>
                            </span>
                          </td>
                          <td className="overflow-hidden px-3 py-2.5 max-md:hidden">
                            <span className="block truncate font-bold">{offer.supplierName}</span>
                            <span className="text-muted-foreground text-xs font-semibold">
                              {offer.supplierRating ? (
                                <span className="text-foreground font-bold">
                                  <Star
                                    aria-hidden
                                    className="fill-primary text-primary -mt-0.5 mr-0.5 inline size-3.5"
                                  />
                                  {offer.supplierRating.replace('.', ',')}
                                </span>
                              ) : (
                                t('fewRatings')
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap max-md:hidden">
                            <span
                              className={
                                discounted
                                  ? 'text-primary block font-black'
                                  : 'block font-extrabold'
                              }
                            >
                              {money(offer.priceWithVat)} ₸
                            </span>
                            {discounted ? (
                              <span className="block text-xs font-semibold text-[#bbb4ab] line-through">
                                {money(offer.basePriceWithVat)} ₸
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap max-md:hidden">
                            <span className="block font-bold">{money(offer.pricePerPack)} ₸</span>
                            <span className="text-muted-foreground text-xs font-semibold">
                              {formatQuantity(offer.packSize)} {unit}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 max-md:hidden">
                            <Badge tone={offer.leadTimeDays <= 1 ? 'success' : 'neutral'}>
                              {offer.leadTimeDays <= 1
                                ? t('tomorrow')
                                : t('inDays', { days: offer.leadTimeDays })}
                            </Badge>
                          </td>
                          <td className="px-5 py-2.5 text-right max-md:p-0">
                            <div className="flex justify-end">
                              <Stepper
                                disabled={!offer.inStock}
                                value={quantities[offer.id] ?? ''}
                                onDecrease={() => step(offer, -1)}
                                onIncrease={() => step(offer, 1)}
                                inputProps={{
                                  'aria-label': t('quantity'),
                                  // @ts-expect-error data-атрибут для автотестов
                                  'data-testid': `list-qty-${offer.id}`,
                                  onChange: (event) =>
                                    setQuantities((current) => ({
                                      ...current,
                                      [offer.id]: event.target.value,
                                    })),
                                  onBlur: (event) => void setQuantity(offer, event.target.value),
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Корзина справа (макет D01): группы по поставщикам и отправка заявок. */}
          <aside className="border-border bg-card hidden w-[320px] shrink-0 flex-col gap-3 self-start rounded-[20px] border p-[22px] xl:flex">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xl font-black">{t('cartPanel')}</span>
              <span className="text-muted-foreground text-[13px] font-semibold">
                {t('cartPanelMeta', { orders: cartGroups.length, items: cartItems })}
              </span>
            </div>
            {cartGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm font-semibold">{t('cartPanelEmpty')}</p>
            ) : (
              <>
                {cartGroups.map((group, index) => (
                  <CartGroupCard key={group.supplierId} group={group} index={index} />
                ))}
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-muted-foreground text-sm font-semibold">{t('total')}</span>
                  <span className="text-2xl font-black tabular-nums">{money(cartTotal)} ₸</span>
                </div>
                <Link href="/cart" className={buttonVariants({ size: 'lg' })}>
                  {t('sendOrders')}
                </Link>
              </>
            )}
          </aside>
        </div>
      </section>
    </Page>
  );
}
