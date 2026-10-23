'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Page, PageHeader } from '@/components/ui/page';
import { Notice } from '@/components/ui/field';
import { CATALOG_COLUMNS } from '@/lib/catalog/columns';
import { ManualOfferForm } from './manual-offer-form';

type City = { id: string; name: string };
/** Поля держим строками: так их можно стереть и набрать заново, проверяет API. */
type Zone = {
  cityId: string;
  minOrderAmount: string;
  leadTimeDays: string;
  deliveryDays: number[];
};
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
type Offer = {
  id: string;
  barcode: string;
  nameRu: string;
  nameKk: string;
  unitRu: string;
  unitKk: string;
  priceWithoutVat: string;
  priceWithVat: string;
  vatRate: string;
  stock: string;
  minBatch: string;
};
type Reference = { code: string; name: string };
type ImportError = { row: number; column: string; code: string; hint?: string };

/** Колонка ошибки так, как её видит поставщик в Excel: буква и заголовок. */
function columnLabel(key: string, locale: 'ru' | 'kk'): string | null {
  const index = CATALOG_COLUMNS.findIndex((column) => column.key === key);
  const column = CATALOG_COLUMNS[index];
  if (!column) return null;
  return `${String.fromCharCode(65 + index)} «${locale === 'kk' ? column.titleKk : column.titleRu}»`;
}
type ImportResult = { created: number; updated: number; errors: ImportError[] };

export function CatalogScreen({
  locale,
  cities,
  selectedZones,
  initialOffers,
  initialTotal,
  units,
  categories,
  vatRates,
  defaultVatCode,
}: {
  locale: 'ru' | 'kk';
  cities: City[];
  selectedZones: Zone[];
  initialOffers: Offer[];
  initialTotal: number;
  units: Reference[];
  categories: Reference[];
  vatRates: Reference[];
  defaultVatCode: string;
}) {
  const t = useTranslations('catalog');
  const tDays = useTranslations('weekdays');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState('');
  const [offers, setOffers] = useState<Offer[]>(initialOffers);
  const [total, setTotal] = useState(initialTotal);
  const [zones, setZones] = useState<Zone[]>(selectedZones);
  const [zonesSaved, setZonesSaved] = useState<number | null>(null);
  const [zonesError, setZonesError] = useState<string | null>(null);

  const loadOffers = useCallback(async (query: string) => {
    const response = await fetch(`/api/catalog/offers?search=${encodeURIComponent(query)}`);
    if (!response.ok) return;
    const data = (await response.json()) as { total: number; offers: Offer[] };
    setOffers(data.offers);
    setTotal(data.total);
  }, []);

  function onSearchChange(value: string) {
    setSearch(value);
    void loadOffers(value);
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Файл берём и из поля: выбранный до гидратации не проходит через onChange.
    const input = event.currentTarget.elements.namedItem('catalog-file') as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      setUploadError('no_file');
      return;
    }
    setPending(true);
    setUploadError(null);
    setResult(null);

    const body = new FormData();
    body.append('file', file);
    const response = await fetch('/api/catalog/import', { method: 'POST', body });
    setPending(false);

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setUploadError(data.error ?? 'unknown');
      return;
    }

    setResult((await response.json()) as ImportResult);
    await loadOffers(search);
  }

  function toggleZone(cityId: string) {
    setZonesSaved(null);
    setZones((current) =>
      current.some((zone) => zone.cityId === cityId)
        ? current.filter((zone) => zone.cityId !== cityId)
        : [...current, { cityId, minOrderAmount: '0.00', leadTimeDays: '1', deliveryDays: [] }],
    );
  }

  function updateZone(cityId: string, patch: Partial<Zone>) {
    setZonesSaved(null);
    setZones((current) =>
      current.map((zone) => (zone.cityId === cityId ? { ...zone, ...patch } : zone)),
    );
  }

  function toggleDay(zone: Zone, day: number) {
    const days = zone.deliveryDays.includes(day)
      ? zone.deliveryDays.filter((value) => value !== day)
      : [...zone.deliveryDays, day].sort();
    updateZone(zone.cityId, { deliveryDays: days });
  }

  async function saveZones() {
    setZonesError(null);
    const response = await fetch('/api/delivery-zones', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        zones: zones.map((zone) => ({
          ...zone,
          // Поставщики часто пишут сумму с пробелами и запятой: «15 000,50».
          minOrderAmount: zone.minOrderAmount.replace(/\s/g, '').replace(',', '.') || '0',
          leadTimeDays: Number(zone.leadTimeDays),
        })),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      saved?: number;
      error?: string;
      cityId?: string;
    };
    if (!response.ok || data.saved === undefined) {
      const city = cities.find((item) => item.id === data.cityId)?.name ?? '';
      setZonesError(t(`zoneErrors.${data.error ?? 'unknown'}` as 'zoneErrors.unknown', { city }));
      return;
    }
    setZonesSaved(data.saved);
  }

  const selectedCities = cities.filter((city) => zones.some((zone) => zone.cityId === city.id));

  return (
    <Page width="lg">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <section className="border-border bg-card mt-6 space-y-3 rounded-2xl border p-4">
        <a
          href={`/api/catalog/template?locale=${locale}`}
          className={buttonVariants({ variant: 'outline' })}
          data-testid="download-template"
        >
          {t('downloadTemplate')}
        </a>

        <form className="flex flex-wrap items-end gap-3" onSubmit={upload}>
          <div className="min-w-0 flex-1">
            <Field label={t('uploadLabel')}>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  className={`${buttonVariants({ variant: 'outline' })} cursor-pointer`}
                  htmlFor="catalog-file"
                >
                  {t('chooseFile')}
                </label>
                <input
                  id="catalog-file"
                  name="catalog-file"
                  type="file"
                  accept=".xlsx"
                  data-testid="catalog-file"
                  className="sr-only"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <span className="text-muted-foreground min-w-0 truncate text-sm">
                  {file ? file.name : t('noFileChosen')}
                </span>
              </div>
            </Field>
          </div>
          <Button type="submit" disabled={pending} data-testid="upload-catalog">
            {pending ? t('uploading') : t('upload')}
          </Button>
        </form>

        {uploadError ? (
          <p className="text-danger text-sm font-semibold" role="alert" data-testid="upload-error">
            {t(`errors.${uploadError}` as 'errors.unknown')}
          </p>
        ) : null}

        <p className="text-muted-foreground text-xs font-semibold">{t('templateHint')}</p>

        {result ? (
          <div className="space-y-2 text-sm" data-testid="import-result">
            <p data-testid="import-created">{t('resultCreated', { count: result.created })}</p>
            <p data-testid="import-updated">{t('resultUpdated', { count: result.updated })}</p>
            <p data-testid="import-errors-count">
              {t('resultErrors', { count: result.errors.length })}
            </p>

            {result.errors.length > 0 ? <Notice tone="warning">{t('errorsHint')}</Notice> : null}

            {result.errors.length > 0 ? (
              <div className="border-border mt-2 max-h-72 overflow-y-auto rounded-2xl border">
                <h3 className="border-border bg-muted border-b px-3 py-2 text-sm font-medium">
                  {t('errorsTitle')}
                </h3>
                <ul className="divide-border divide-y text-sm" data-testid="import-errors">
                  {result.errors.map((error, index) => (
                    <li key={`${error.row}-${error.column}-${index}`} className="px-3 py-2">
                      <span className="font-medium">{t('errorRow', { row: error.row })}</span>
                      {columnLabel(error.column, locale) ? (
                        <>
                          {', '}
                          <span className="text-muted-foreground">
                            {t('errorColumnLabel', { column: columnLabel(error.column, locale)! })}
                          </span>
                        </>
                      ) : null}
                      {' — '}
                      {t(`errors.${error.code}` as 'errors.unknown', { hint: error.hint ?? '' })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium" data-testid="manual-toggle">
          {t('manualTitle')}
        </summary>
        <ManualOfferForm
          units={units}
          categories={categories}
          vatRates={vatRates}
          defaultVatCode={defaultVatCode}
          onSaved={() => void loadOffers(search)}
        />
      </details>

      <section className="border-border bg-card shadow-card mt-6 rounded-xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">{t('listTitle')}</h2>
          <p className="text-muted-foreground text-sm font-medium" data-testid="offers-total">
            {t('total', { count: total })}
          </p>
        </div>

        <Input
          className="mt-3"
          placeholder={t('searchPlaceholder')}
          value={search}
          data-testid="catalog-search"
          onChange={(event) => onSearchChange(event.target.value)}
        />

        {offers.length === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">{t('empty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">{t('columns.name')}</th>
                  <th className="py-2 pr-3 font-medium">{t('columns.barcode')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('columns.price')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('columns.priceWithVat')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('columns.vat')}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t('columns.stock')}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y" data-testid="offers-table">
                {offers.map((offer) => (
                  <tr key={offer.id}>
                    <td className="py-2 pr-3">{locale === 'kk' ? offer.nameKk : offer.nameRu}</td>
                    <td className="py-2 pr-3 text-[13px] font-bold tabular-nums">
                      {offer.barcode}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{offer.priceWithoutVat}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{offer.priceWithVat}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{offer.vatRate}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {offer.stock} {locale === 'kk' ? offer.unitKk : offer.unitRu}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border-border bg-card shadow-card mt-6 rounded-xl border p-4 sm:p-5">
        <h2 className="text-lg font-medium">{t('zonesTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-xs font-semibold">{t('zonesHint')}</p>

        {selectedCities.length === 0 ? (
          <Notice tone="warning" className="mt-3">
            {t('zonesEmpty')}
          </Notice>
        ) : (
          <ul className="mt-3 space-y-3" data-testid="zone-settings">
            {selectedCities.map((city) => {
              const zone = zones.find((item) => item.cityId === city.id)!;
              return (
                <li
                  key={city.id}
                  className="border-border space-y-3 rounded-2xl border p-3"
                  data-testid={`zone-${city.id}`}
                >
                  <p className="font-medium">{city.name}</p>
                  <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                    <label className="text-muted-foreground block text-xs">
                      {t('zoneMinOrder')}
                      <Input
                        className="mt-1 h-9 text-right"
                        inputMode="decimal"
                        value={zone.minOrderAmount}
                        data-testid={`zone-min-${city.id}`}
                        onChange={(event) =>
                          updateZone(city.id, { minOrderAmount: event.target.value })
                        }
                      />
                    </label>
                    <label className="text-muted-foreground block text-xs">
                      {t('zoneLeadTime')}
                      <Input
                        className="mt-1 h-9 text-right"
                        inputMode="numeric"
                        value={zone.leadTimeDays}
                        data-testid={`zone-lead-${city.id}`}
                        onChange={(event) =>
                          updateZone(city.id, {
                            leadTimeDays: event.target.value.replace(/\D/g, ''),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-semibold">
                      {t('zoneDeliveryDays')}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((day) => (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={zone.deliveryDays.includes(day) ? 'default' : 'outline'}
                          aria-pressed={zone.deliveryDays.includes(day)}
                          data-testid={`zone-day-${city.id}-${day}`}
                          onClick={() => toggleDay(zone, day)}
                        >
                          {tDays(String(day) as '1')}
                        </Button>
                      ))}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs font-semibold">
                      {zone.deliveryDays.length === 0 ? t('zoneEveryDay') : t('zoneDaysHint')}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3">
          <h3 className="text-sm font-medium">{t('zonesCities')}</h3>
          <ul className="mt-2 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-3">
            {cities.map((city) => (
              <li key={city.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    data-testid={`zone-city-${city.id}`}
                    checked={zones.some((zone) => zone.cityId === city.id)}
                    onChange={() => toggleZone(city.id)}
                  />
                  {city.name}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <Button className="mt-3" onClick={saveZones} data-testid="save-zones">
          {t('zonesSave')}
        </Button>
        {zonesSaved !== null ? (
          <p className="text-muted-foreground mt-2 text-sm" data-testid="zones-saved">
            {t('zonesSaved', { count: zonesSaved })}
          </p>
        ) : null}
        {zonesError ? (
          <p
            className="text-danger mt-2 text-sm font-semibold"
            role="alert"
            data-testid="zones-error"
          >
            {zonesError}
          </p>
        ) : null}
      </section>
    </Page>
  );
}
