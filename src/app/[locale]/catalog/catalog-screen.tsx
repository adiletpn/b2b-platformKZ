'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Link } from '@/i18n/navigation';

type City = { id: string; name: string };
type Zone = { cityId: string; minOrderAmount: string; leadTimeDays: number };
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
type ImportError = { row: number; column: string; code: string; hint?: string };
type ImportResult = { created: number; updated: number; errors: ImportError[] };

export function CatalogScreen({
  locale,
  cities,
  selectedZones,
  initialOffers,
  initialTotal,
}: {
  locale: 'ru' | 'kk';
  cities: City[];
  selectedZones: Zone[];
  initialOffers: Offer[];
  initialTotal: number;
}) {
  const t = useTranslations('catalog');
  const tDashboard = useTranslations('dashboard');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState('');
  const [offers, setOffers] = useState<Offer[]>(initialOffers);
  const [total, setTotal] = useState(initialTotal);
  const [zones, setZones] = useState<Zone[]>(selectedZones);
  const [zonesSaved, setZonesSaved] = useState<number | null>(null);

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

  async function upload(event: React.FormEvent) {
    event.preventDefault();
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
        : [...current, { cityId, minOrderAmount: '0.00', leadTimeDays: 1 }],
    );
  }

  function updateZone(cityId: string, patch: Partial<Zone>) {
    setZonesSaved(null);
    setZones((current) =>
      current.map((zone) => (zone.cityId === cityId ? { ...zone, ...patch } : zone)),
    );
  }

  async function saveZones() {
    const response = await fetch('/api/delivery-zones', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ zones }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as { saved: number };
    setZonesSaved(data.saved);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {tDashboard('title')}
        </Link>
      </header>
      <p className="text-muted-foreground mt-2 text-sm">{t('subtitle')}</p>

      <section className="border-border bg-card mt-6 space-y-3 rounded-lg border p-4">
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
              <input
                type="file"
                accept=".xlsx"
                data-testid="catalog-file"
                className="w-full text-sm"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending} data-testid="upload-catalog">
            {pending ? t('uploading') : t('upload')}
          </Button>
        </form>

        {uploadError ? (
          <p className="text-sm text-red-600" role="alert" data-testid="upload-error">
            {t(`errors.${uploadError}` as 'errors.unknown')}
          </p>
        ) : null}

        {result ? (
          <div className="space-y-2 text-sm" data-testid="import-result">
            <p data-testid="import-created">{t('resultCreated', { count: result.created })}</p>
            <p data-testid="import-updated">{t('resultUpdated', { count: result.updated })}</p>
            <p data-testid="import-errors-count">
              {t('resultErrors', { count: result.errors.length })}
            </p>

            {result.errors.length > 0 ? (
              <div className="border-border mt-2 max-h-72 overflow-y-auto rounded-lg border">
                <h3 className="border-border bg-muted border-b px-3 py-2 text-sm font-medium">
                  {t('errorsTitle')}
                </h3>
                <ul className="divide-border divide-y text-sm" data-testid="import-errors">
                  {result.errors.map((error, index) => (
                    <li key={`${error.row}-${error.column}-${index}`} className="px-3 py-2">
                      <span className="font-medium">{t('errorRow', { row: error.row })}</span>
                      {', '}
                      <span className="text-muted-foreground">{error.column}</span>
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

      <section className="border-border bg-card mt-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">{t('listTitle')}</h2>
          <p className="text-muted-foreground text-sm" data-testid="offers-total">
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
                    <td className="py-2 pr-3 font-mono text-xs">{offer.barcode}</td>
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

      <section className="border-border bg-card mt-6 rounded-lg border p-4">
        <h2 className="text-lg font-medium">{t('zonesTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('zonesHint')}</p>

        <ul className="mt-3 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto">
          {cities.map((city) => {
            const zone = zones.find((item) => item.cityId === city.id);
            return (
              <li key={city.id} className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-40 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    data-testid={`zone-city-${city.id}`}
                    checked={Boolean(zone)}
                    onChange={() => toggleZone(city.id)}
                  />
                  {city.name}
                </label>

                {zone ? (
                  <>
                    <label className="text-muted-foreground flex items-center gap-1 text-xs">
                      {t('zoneMinOrder')}
                      <Input
                        className="h-9 w-28 text-right"
                        inputMode="decimal"
                        value={zone.minOrderAmount}
                        data-testid={`zone-min-${city.id}`}
                        onChange={(event) =>
                          updateZone(city.id, { minOrderAmount: event.target.value })
                        }
                      />
                    </label>
                    <label className="text-muted-foreground flex items-center gap-1 text-xs">
                      {t('zoneLeadTime')}
                      <Input
                        className="h-9 w-20 text-right"
                        inputMode="numeric"
                        value={String(zone.leadTimeDays)}
                        data-testid={`zone-lead-${city.id}`}
                        onChange={(event) =>
                          updateZone(city.id, { leadTimeDays: Number(event.target.value) || 1 })
                        }
                      />
                    </label>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>

        <Button className="mt-3" variant="outline" onClick={saveZones} data-testid="save-zones">
          {t('zonesSave')}
        </Button>
        {zonesSaved !== null ? (
          <p className="text-muted-foreground mt-2 text-sm" data-testid="zones-saved">
            {t('zonesSaved', { count: zonesSaved })}
          </p>
        ) : null}
      </section>
    </main>
  );
}
