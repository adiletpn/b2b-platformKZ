'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemoHint, Field, Notice } from '@/components/ui/field';
import { Page } from '@/components/ui/page';

type CompanyType = 'STORE' | 'SUPPLIER' | 'BOTH';
type City = { id: string; name: string };
type BinEntry = { bin: string; name: string };
type Found = { name: string; legalForm: string; legalAddress: string; isVatPayer: boolean };
type LegalForm = 'IP' | 'TOO' | 'AO';

const TYPES: CompanyType[] = ['STORE', 'SUPPLIER', 'BOTH'];
const LEGAL_FORMS: LegalForm[] = ['TOO', 'IP', 'AO'];
const EMPTY_MANUAL = {
  name: '',
  legalAddress: '',
  legalForm: 'TOO' as LegalForm,
  isVatPayer: false,
};
const FORMATS = ['grocery', 'convenience', 'pharmacy', 'cafe'] as const;

export function OnboardingForm({ cities, demoBins }: { cities: City[]; demoBins: BinEntry[] }) {
  const t = useTranslations('onboarding');
  const router = useRouter();

  const [type, setType] = useState<CompanyType>('STORE');
  const [bin, setBin] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  // БИН нет в реестре: название и адрес вводит сам пользователь, их сверит администратор.
  const [manual, setManual] = useState<typeof EMPTY_MANUAL | null>(null);
  const [cityId, setCityId] = useState(cities[0]?.id ?? '');
  const [address, setAddress] = useState('');
  const [format, setFormat] = useState<string>(FORMATS[0]);
  const [deliveryCityIds, setDeliveryCityIds] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessRequested, setAccessRequested] = useState(false);
  const [pending, setPending] = useState(false);

  const needsLocation = type === 'STORE' || type === 'BOTH';
  const needsDelivery = type === 'SUPPLIER' || type === 'BOTH';

  function changeBin(value: string) {
    setBin(value);
    setFound(null);
    setManual(null);
    setError(null);
  }

  async function checkBin() {
    setError(null);
    setFound(null);
    setManual(null);
    const response = await fetch(`/api/bin/${encodeURIComponent(bin)}`);
    const data = (await response.json()) as Found & { error?: string; legalForm?: LegalForm };
    if (response.status === 404) {
      setManual({ ...EMPTY_MANUAL, legalForm: data.legalForm ?? 'TOO' });
      return;
    }
    if (!response.ok) {
      setError(data.error ?? 'unknown');
      return;
    }
    setFound(data);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const response = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        bin,
        type,
        location: needsLocation ? { cityId, address, format } : undefined,
        deliveryCityIds: needsDelivery ? deliveryCityIds : undefined,
        consentAccepted: consent,
        manual: manual ?? undefined,
      }),
    });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);

    if (response.status === 202) {
      setAccessRequested(true);
      return;
    }
    if (!response.ok) {
      // Отправили, не проверив БИН, а в реестре его нет — открываем поля для ручного ввода.
      if (data.status === 'missing_company_details' && !manual) setManual(EMPTY_MANUAL);
      setError(data.status ?? data.error ?? 'unknown');
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  function toggleDeliveryCity(id: string) {
    setDeliveryCityIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  if (accessRequested) {
    return (
      <Page width="sm">
        <h1 className="text-2xl font-semibold" data-testid="access-requested">
          {t('accessRequested.title')}
        </h1>
        <p className="text-muted-foreground mt-3">{t('accessRequested.text')}</p>
      </Page>
    );
  }

  return (
    <Page width="sm">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <form className="mt-6 space-y-8" onSubmit={submit}>
        <section className="space-y-3">
          <h2 className="text-[15px] font-extrabold">{t('stepType')}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TYPES.map((value) => (
              <Button
                key={value}
                type="button"
                variant={type === value ? 'default' : 'outline'}
                data-testid={`type-${value}`}
                onClick={() => setType(value)}
              >
                {t(`type.${value}`)}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-extrabold">{t('stepBin')}</h2>
          {demoBins.length > 0 ? (
            <DemoHint title={t('demoBinTitle')}>
              {t('demoBinHint')}:
              <ul className="mt-1 space-y-0.5">
                {demoBins.map((entry) => (
                  <li key={entry.bin}>
                    <button
                      type="button"
                      className="tabular-nums underline-offset-2 hover:underline"
                      data-testid={`demo-bin-${entry.bin}`}
                      onClick={() => changeBin(entry.bin)}
                    >
                      {entry.bin}
                    </button>{' '}
                    — {entry.name}
                  </li>
                ))}
              </ul>
            </DemoHint>
          ) : null}
          <div className="flex gap-2">
            <Field label={t('binLabel')}>
              <Input
                inputMode="numeric"
                maxLength={12}
                value={bin}
                data-testid="bin-input"
                onChange={(event) => changeBin(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              className="mt-7"
              onClick={checkBin}
              data-testid="bin-check"
            >
              {t('binCheck')}
            </Button>
          </div>

          {found ? (
            <dl
              className="border-border bg-card rounded-[14px] border-[1.5px] p-3.5 text-sm font-medium"
              data-testid="bin-found"
            >
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('companyName')}</dt>
                <dd className="text-right font-medium">{found.name}</dd>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('legalAddress')}</dt>
                <dd className="text-right">{found.legalAddress}</dd>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('vatPayer')}</dt>
                <dd className="text-right">{found.isVatPayer ? t('vatYes') : t('vatNo')}</dd>
              </div>
            </dl>
          ) : null}

          {manual ? (
            <div
              className="border-border space-y-3 rounded-2xl border p-3"
              data-testid="bin-manual"
            >
              <Notice tone="info">{t('manualHint')}</Notice>
              <Field label={t('companyName')}>
                <Input
                  value={manual.name}
                  maxLength={200}
                  placeholder={t('companyNamePlaceholder')}
                  data-testid="manual-company-name"
                  onChange={(event) => setManual({ ...manual, name: event.target.value })}
                />
              </Field>
              <Field label={t('legalAddress')}>
                <Input
                  value={manual.legalAddress}
                  maxLength={300}
                  data-testid="manual-legal-address"
                  onChange={(event) => setManual({ ...manual, legalAddress: event.target.value })}
                />
              </Field>
              <Field label={t('legalForm')}>
                <select
                  className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
                  value={manual.legalForm}
                  data-testid="manual-legal-form"
                  onChange={(event) =>
                    setManual({ ...manual, legalForm: event.target.value as LegalForm })
                  }
                >
                  {LEGAL_FORMS.map((value) => (
                    <option key={value} value={value}>
                      {t(`legalForms.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={manual.isVatPayer}
                  data-testid="manual-vat"
                  onChange={(event) => setManual({ ...manual, isVatPayer: event.target.checked })}
                />
                {t('vatPayer')}
              </label>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-extrabold">{t('stepDetails')}</h2>

          {needsLocation ? (
            <div className="border-border space-y-3 rounded-2xl border p-3">
              <h3 className="text-sm font-medium">{t('storeSection')}</h3>
              <Field label={t('cityLabel')}>
                <select
                  className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
                  value={cityId}
                  data-testid="city-select"
                  onChange={(event) => setCityId(event.target.value)}
                >
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('addressLabel')}>
                <Input
                  value={address}
                  data-testid="address-input"
                  onChange={(event) => setAddress(event.target.value)}
                />
              </Field>
              <Field label={t('formatLabel')}>
                <select
                  className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
                  value={format}
                  data-testid="format-select"
                  onChange={(event) => setFormat(event.target.value)}
                >
                  {FORMATS.map((value) => (
                    <option key={value} value={value}>
                      {t(`formats.${value}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          {needsDelivery ? (
            <div className="border-border space-y-2 rounded-2xl border p-3">
              <h3 className="text-sm font-medium">{t('supplierSection')}</h3>
              <p className="text-muted-foreground text-xs">{t('supplierHint')}</p>
              <p className="text-muted-foreground text-xs">{t('supplierZonesLater')}</p>
              <ul className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                {cities.map((city) => (
                  <li key={city.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        data-testid={`delivery-city-${city.id}`}
                        checked={deliveryCityIds.includes(city.id)}
                        onChange={() => toggleDeliveryCity(city.id)}
                      />
                      {city.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={consent}
            data-testid="consent-checkbox"
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>{t('consentLabel')}</span>
        </label>

        <Button type="submit" className="w-full" disabled={pending} data-testid="submit-company">
          {t('submit')}
        </Button>

        {error ? (
          <p className="text-danger text-sm" role="alert" data-testid="onboarding-error">
            {t(`errors.${error}` as 'errors.unknown')}
          </p>
        ) : null}
      </form>
    </Page>
  );
}
