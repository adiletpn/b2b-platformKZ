'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import type { BarcodeLookup } from '@/lib/catalog/manual';

type Reference = { code: string; name: string };

const EMPTY = {
  barcode: '',
  nameRu: '',
  nameKk: '',
  brand: '',
  manufacturer: '',
  country: '',
  sku: '',
  tnvedCode: '',
  priceWithoutVat: '',
  packSize: '1',
  minBatch: '1',
  stock: '0',
  expiresAt: '',
};

/** Ручной ввод карточки товара с автозаполнением по штрихкоду (раздел 3.2 ТЗ). */
export function ManualOfferForm({
  units,
  categories,
  vatRates,
  defaultVatCode,
  onSaved,
}: {
  units: Reference[];
  categories: Reference[];
  vatRates: Reference[];
  defaultVatCode: string;
  onSaved: () => void;
}) {
  const t = useTranslations('catalog');

  const [form, setForm] = useState(EMPTY);
  // «шт» — самая частая единица, остальное выбирается руками.
  const [unitCode, setUnitCode] = useState(
    (units.find((unit) => unit.code === 'pcs') ?? units[0])?.code ?? '',
  );
  const [categoryCode, setCategoryCode] = useState('');
  const [vatCode, setVatCode] = useState(defaultVatCode);
  const [marks, setMarks] = useState({
    isMarked: false,
    isExcise: false,
    requiresSnt: false,
    isLicensed: false,
  });
  const [lookupNotice, setLookupNotice] = useState<'found' | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function field(key: keyof typeof EMPTY) {
    return {
      value: form[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setForm((current) => ({ ...current, [key]: event.target.value })),
    };
  }

  async function lookup() {
    setError(null);
    setLookupNotice(null);
    const response = await fetch(`/api/catalog/barcode?code=${encodeURIComponent(form.barcode)}`);
    if (!response.ok) {
      setError('invalid_barcode');
      return;
    }
    const data = (await response.json()) as BarcodeLookup;
    if (!data.found) {
      setLookupNotice('new');
      return;
    }

    // Карточка берётся из общего справочника платформы: один штрихкод — один товар.
    setForm((current) => ({
      ...current,
      nameRu: data.nameRu,
      nameKk: data.nameKk,
      brand: data.brand ?? '',
      manufacturer: data.manufacturer ?? '',
      country: data.country ?? '',
      tnvedCode: data.tnvedCode ?? '',
    }));
    if (data.unitCode) setUnitCode(data.unitCode);
    setCategoryCode(data.categoryCode ?? '');
    setMarks({
      isMarked: data.isMarked,
      isExcise: data.isExcise,
      requiresSnt: data.requiresSnt,
      isLicensed: data.isLicensed,
    });
    setLookupNotice('found');
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    const response = await fetch('/api/catalog/offer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, unitCode, categoryCode, vatCode, ...marks }),
    });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status ?? data.error ?? 'unknown');
      return;
    }
    setSaved(true);
    setForm(EMPTY);
    setLookupNotice(null);
    onSaved();
  }

  return (
    <form
      className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
      data-testid="manual-offer-form"
      onSubmit={save}
    >
      <p className="text-muted-foreground text-sm">{t('manualHint')}</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label={t('barcode')}>
          <Input inputMode="numeric" data-testid="manual-barcode" {...field('barcode')} />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          data-testid="manual-lookup"
          onClick={() => void lookup()}
        >
          {t('manualLookup')}
        </Button>
        {lookupNotice ? (
          <p className="text-muted-foreground text-sm" data-testid="manual-lookup-notice">
            {t(`manualLookup${lookupNotice === 'found' ? 'Found' : 'New'}`)}
          </p>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('nameRu')}>
          <Input data-testid="manual-name-ru" {...field('nameRu')} />
        </Field>
        <Field label={t('nameKk')}>
          <Input data-testid="manual-name-kk" {...field('nameKk')} />
        </Field>
        <Field label={t('brand')}>
          <Input data-testid="manual-brand" {...field('brand')} />
        </Field>
        <Field label={t('manufacturer')}>
          <Input data-testid="manual-manufacturer" {...field('manufacturer')} />
        </Field>
        <Field label={t('country')}>
          <Input data-testid="manual-country" {...field('country')} />
        </Field>
        <Field label={t('sku')}>
          <Input data-testid="manual-sku" {...field('sku')} />
        </Field>

        <Field label={t('unit')}>
          <select
            className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
            value={unitCode}
            data-testid="manual-unit"
            onChange={(event) => setUnitCode(event.target.value)}
          >
            {units.map((unit) => (
              <option key={unit.code} value={unit.code}>
                {unit.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('category')}>
          <select
            className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
            value={categoryCode}
            data-testid="manual-category"
            onChange={(event) => setCategoryCode(event.target.value)}
          >
            <option value="">—</option>
            {categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('vatRate')}>
          <select
            className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
            value={vatCode}
            data-testid="manual-vat"
            onChange={(event) => setVatCode(event.target.value)}
          >
            {vatRates.map((rate) => (
              <option key={rate.code} value={rate.code}>
                {rate.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('priceWithoutVat')}>
          <Input inputMode="decimal" data-testid="manual-price" {...field('priceWithoutVat')} />
        </Field>
        <Field label={t('packSize')}>
          <Input inputMode="decimal" data-testid="manual-pack-size" {...field('packSize')} />
        </Field>
        <Field label={t('minBatch')}>
          <Input inputMode="decimal" data-testid="manual-min-batch" {...field('minBatch')} />
        </Field>
        <Field label={t('stock')}>
          <Input inputMode="decimal" data-testid="manual-stock" {...field('stock')} />
        </Field>
        <Field label={t('expiresAt')}>
          <Input type="date" data-testid="manual-expires" {...field('expiresAt')} />
        </Field>
        <Field label={t('tnved')}>
          <Input data-testid="manual-tnved" {...field('tnvedCode')} />
        </Field>
      </div>

      <fieldset className="mt-3 flex flex-wrap gap-4 text-sm">
        {(['isMarked', 'isExcise', 'requiresSnt', 'isLicensed'] as const).map((mark) => (
          <label key={mark} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={marks[mark]}
              data-testid={`manual-${mark}`}
              onChange={(event) =>
                setMarks((current) => ({ ...current, [mark]: event.target.checked }))
              }
            />
            {t(`marks.${mark}`)}
          </label>
        ))}
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} data-testid="manual-save">
          {pending ? t('manualSaving') : t('manualSave')}
        </Button>
        {saved ? (
          <p className="text-muted-foreground text-sm" data-testid="manual-saved">
            {t('manualSaved')}
          </p>
        ) : null}
        {error ? (
          <p className="text-danger text-sm font-semibold" role="alert" data-testid="manual-error">
            {t(`manualErrors.${error}` as 'manualErrors.unknown')}
          </p>
        ) : null}
      </div>
    </form>
  );
}
