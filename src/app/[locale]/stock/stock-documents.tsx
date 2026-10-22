'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardTitle } from '@/components/ui/card';
import { CameraScanButton } from '@/components/camera-scanner';

type Location = { id: string; address: string };
type Balance = { productId: string; name: string; quantity: string; barcode: string };
type DocumentRow = {
  id: string;
  type: 'TRANSFER' | 'WRITE_OFF' | 'STOCKTAKE';
  number: string;
  createdAt: string;
  locationAddress: string;
  targetAddress: string | null;
  reason: string | null;
  lineCount: number;
};
type LedgerEntry = {
  id: string;
  createdAt: string;
  type: string;
  quantity: string;
  costPrice: string;
  locationAddress: string;
  documentNumber: string | null;
};

const REASONS = ['DAMAGE', 'EXPIRED', 'BREAKAGE', 'OTHER'] as const;

/** Раздел 4.1 ТЗ: перемещение, списание и инвентаризация — только документами. */
export function StockDocuments({
  locations,
  balances,
  documents,
}: {
  locations: Location[];
  balances: Balance[];
  documents: DocumentRow[];
}) {
  const t = useTranslations('stock');
  const locale = useLocale();
  const router = useRouter();

  const [type, setType] = useState<DocumentRow['type']>('WRITE_OFF');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [targetLocationId, setTargetLocationId] = useState(locations[1]?.id ?? '');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('DAMAGE');
  const [productId, setProductId] = useState(balances[0]?.productId ?? '');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [scan, setScan] = useState('');
  const [scanError, setScanError] = useState(false);

  /**
   * Сканер (USB или Bluetooth) печатает штрихкод как клавиатура и жмёт Enter:
   * находим позицию и подставляем её в документ (раздел 4.1 ТЗ).
   */
  function applyScan(code: string) {
    const found = balances.find((balance) => balance.barcode === code.trim());
    setScanError(!found);
    if (found) setProductId(found.productId);
    setScan('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setCreated(null);

    const response = await fetch('/api/stock/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type,
        locationId,
        targetLocationId: type === 'TRANSFER' ? targetLocationId : undefined,
        reason: type === 'WRITE_OFF' ? reason : undefined,
        comment: comment || undefined,
        // У инвентаризации вводится пересчитанное количество, у остальных — сколько списать.
        lines: [{ productId, quantity, actualQuantity: quantity }],
      }),
    });
    const data = (await response.json()) as { status?: string; number?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    setCreated(data.number ?? null);
    setQuantity('');
    setComment('');
    router.refresh();
  }

  async function openLedger(product: string) {
    const response = await fetch(`/api/stock/ledger/${product}`);
    if (!response.ok) return;
    const data = (await response.json()) as { entries: LedgerEntry[] };
    setLedger(data.entries);
  }

  // Пока нечего считать: товар попадает на склад приёмкой по накладной.
  if (balances.length === 0) {
    return (
      <p className="text-muted-foreground mt-5 text-sm" data-testid="stock-documents-empty">
        {t('documentsEmpty')}
      </p>
    );
  }

  return (
    <>
      <form
        className="border-border bg-card shadow-card mt-5 rounded-xl border p-4 sm:p-5"
        data-testid="stock-document-form"
        onSubmit={submit}
      >
        <h2 className="text-lg font-medium">{t('documentsTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('documentsHint')}</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label={t('documentType')}>
            <select
              className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
              value={type}
              data-testid="document-type"
              onChange={(event) => setType(event.target.value as DocumentRow['type'])}
            >
              {(['WRITE_OFF', 'TRANSFER', 'STOCKTAKE'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`documentTypes.${value}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('location')}>
            <select
              className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
              value={locationId}
              data-testid="document-location"
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.address}
                </option>
              ))}
            </select>
          </Field>

          {type === 'TRANSFER' ? (
            <Field label={t('targetLocation')}>
              <select
                className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={targetLocationId}
                data-testid="document-target"
                onChange={(event) => setTargetLocationId(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.address}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {type === 'WRITE_OFF' ? (
            <Field label={t('reason')}>
              <select
                className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={reason}
                data-testid="document-reason"
                onChange={(event) => setReason(event.target.value as (typeof REASONS)[number])}
              >
                {REASONS.map((value) => (
                  <option key={value} value={value}>
                    {t(`reasons.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label={t('scan')}>
            <Input
              className="w-44"
              value={scan}
              placeholder={t('scanPlaceholder')}
              data-testid="document-scan"
              onChange={(event) => setScan(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                applyScan(scan);
              }}
            />
          </Field>
          <CameraScanButton onCode={applyScan} />

          <Field label={t('product')}>
            <select
              className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
              value={productId}
              data-testid="document-product"
              onChange={(event) => setProductId(event.target.value)}
            >
              {balances.map((balance) => (
                <option key={balance.productId} value={balance.productId}>
                  {balance.name} ({balance.quantity})
                </option>
              ))}
            </select>
          </Field>

          <Field label={type === 'STOCKTAKE' ? t('actualQuantity') : t('quantity')}>
            <Input
              className="w-28"
              inputMode="decimal"
              value={quantity}
              data-testid="document-quantity"
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>

          <div className="min-w-40 flex-1">
            <Field label={t('comment')}>
              <Input
                value={comment}
                data-testid="document-comment"
                onChange={(event) => setComment(event.target.value)}
              />
            </Field>
          </div>

          <Button type="submit" disabled={pending} data-testid="document-save">
            {pending ? t('creating') : t('create')}
          </Button>
        </div>

        {scanError ? (
          <p className="text-danger mt-2 text-sm" role="alert" data-testid="scan-error">
            {t('scanNotFound')}
          </p>
        ) : null}
        {created ? (
          <p className="text-muted-foreground mt-2 text-sm" data-testid="document-created">
            {t('created', { number: created })}
          </p>
        ) : null}
        {error ? (
          <p className="text-danger mt-2 text-sm" role="alert" data-testid="document-error">
            {t(`errors.${error}` as 'errors.unknown')}
          </p>
        ) : null}
      </form>

      {documents.length > 0 ? (
        <Card className="mt-4">
          <CardTitle className="text-[15px]">{t('documentsListTitle')}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm" data-testid="stock-documents">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-baseline justify-between gap-2"
                data-testid={`stock-document-${document.number}`}
              >
                <span>
                  <span className="text-[13px] font-bold tabular-nums">{document.number}</span>{' '}
                  {t(`documentTypes.${document.type}`)}
                  {document.targetAddress ? ` → ${document.targetAddress}` : ''}
                  {document.reason
                    ? ` · ${t(`reasons.${document.reason}` as 'reasons.OTHER')}`
                    : ''}
                </span>
                <span className="text-muted-foreground text-xs">{document.createdAt}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {balances.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label={t('ledgerFor')}>
            <select
              className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
              value={productId}
              data-testid="ledger-product"
              onChange={(event) => setProductId(event.target.value)}
            >
              {balances.map((balance) => (
                <option key={balance.productId} value={balance.productId}>
                  {balance.name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            variant="outline"
            data-testid="open-ledger"
            onClick={() => void openLedger(productId)}
          >
            {t('openLedger')}
          </Button>
          <a
            href={`/api/stock/ledger/${productId}/xlsx?locale=${locale}`}
            className={buttonVariants({ variant: 'ghost' })}
            data-testid="ledger-xlsx"
          >
            {t('downloadLedger')}
          </a>
        </div>
      ) : null}

      {ledger ? (
        <Card className="mt-4" data-testid="ledger">
          <CardTitle className="text-[15px]">{t('ledgerTitle')}</CardTitle>
          {ledger.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">{t('ledgerEmpty')}</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm" data-testid="ledger-entries">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {t(`movementTypes.${entry.type}` as 'movementTypes.RECEIPT')}
                    {entry.documentNumber ? (
                      <span className="text-muted-foreground text-[13px] font-bold tabular-nums">
                        {' '}
                        {entry.documentNumber}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground"> · {entry.locationAddress}</span>
                  </span>
                  <span className="tabular-nums">{entry.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}
