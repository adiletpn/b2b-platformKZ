'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemoHint, Field } from '@/components/ui/field';

type CompanyType = 'STORE' | 'SUPPLIER' | 'BOTH';
type City = { id: string; name: string };
type BinEntry = { bin: string; name: string };
type Found = { name: string; legalForm: string; legalAddress: string; isVatPayer: boolean };

const TYPES: CompanyType[] = ['STORE', 'SUPPLIER', 'BOTH'];
const FORMATS = ['grocery', 'convenience', 'pharmacy', 'cafe'] as const;

export function OnboardingForm({ cities, demoBins }: { cities: City[]; demoBins: BinEntry[] }) {
  const t = useTranslations('onboarding');
  const router = useRouter();

  const [type, setType] = useState<CompanyType>('STORE');
  const [bin, setBin] = useState('');
  const [found, setFound] = useState<Found | null>(null);
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

  async function checkBin() {
    setError(null);
    setFound(null);
    const response = await fetch(`/api/bin/${encodeURIComponent(bin)}`);
    const data = (await response.json()) as Found & { error?: string };
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
      }),
    });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);

    if (response.status === 202) {
      setAccessRequested(true);
      return;
    }
    if (!response.ok) {
      setError(data.status ?? data.error ?? 'unknown');
      return;
    }
    router.push('/dashboard');
  }

  function toggleDeliveryCity(id: string) {
    setDeliveryCityIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  if (accessRequested) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold" data-testid="access-requested">
          {t('accessRequested.title')}
        </h1>
        <p className="text-muted-foreground mt-3">{t('accessRequested.text')}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <form className="mt-6 space-y-8" onSubmit={submit}>
        <section className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-medium">{t('stepType')}</h2>
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
          <h2 className="text-muted-foreground text-sm font-medium">{t('stepBin')}</h2>
          <DemoHint title={t('demoBinTitle')}>
            {t('demoBinHint')}:
            <ul className="mt-1 space-y-0.5">
              {demoBins.map((entry) => (
                <li key={entry.bin}>
                  <button
                    type="button"
                    className="font-mono underline-offset-2 hover:underline"
                    data-testid={`demo-bin-${entry.bin}`}
                    onClick={() => setBin(entry.bin)}
                  >
                    {entry.bin}
                  </button>{' '}
                  — {entry.name}
                </li>
              ))}
            </ul>
          </DemoHint>
          <div className="flex gap-2">
            <Field label={t('binLabel')}>
              <Input
                inputMode="numeric"
                maxLength={12}
                value={bin}
                data-testid="bin-input"
                onChange={(event) => setBin(event.target.value.replace(/\D/g, ''))}
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
              className="border-border bg-card rounded-lg border p-3 text-sm"
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
        </section>

        <section className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-medium">{t('stepDetails')}</h2>

          {needsLocation ? (
            <div className="border-border space-y-3 rounded-lg border p-3">
              <h3 className="text-sm font-medium">{t('storeSection')}</h3>
              <Field label={t('cityLabel')}>
                <select
                  className="border-border bg-card h-11 w-full rounded-lg border px-3"
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
                  className="border-border bg-card h-11 w-full rounded-lg border px-3"
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
            <div className="border-border space-y-2 rounded-lg border p-3">
              <h3 className="text-sm font-medium">{t('supplierSection')}</h3>
              <p className="text-muted-foreground text-xs">{t('supplierHint')}</p>
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
          <p className="text-sm text-red-600" role="alert" data-testid="onboarding-error">
            {t(`errors.${error}` as 'errors.unknown')}
          </p>
        ) : null}
      </form>
    </main>
  );
}
