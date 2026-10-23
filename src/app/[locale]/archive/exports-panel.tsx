'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardHint, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const ONE_C_KINDS = ['receipts', 'sales', 'payments', 'nomenclature', 'counterparties'] as const;
const BUNDLE_ERRORS = ['empty', 'too_many', 'invalid_period'];

/** Сегодня и первое число месяца по времени Казахстана (UTC+5). */
function defaultPeriod() {
  const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * Выгрузки раздела 4.4 ТЗ: документы за период одним архивом, файлы для 1С и CSV.
 * Кнопки видны по правам матрицы; сервер проверяет права ещё раз.
 */
export function ExportsPanel({
  locale,
  can,
}: {
  locale: 'ru' | 'kk';
  can: { documents: boolean; catalog: boolean; stock: boolean };
}) {
  const t = useTranslations('archive.exports');
  const [period, setPeriod] = useState(defaultPeriod);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const query = `from=${period.from}&to=${period.to}&locale=${locale}`;

  /** Архив собирается долго: качаем через fetch, чтобы показать ожидание и ошибку. */
  async function downloadBundle() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/archive/bundle?${query}`);
    setPending(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { status?: string };
      setError(data.status && BUNDLE_ERRORS.includes(data.status) ? data.status : 'unknown');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('bundleFile')}-${period.from}-${period.to}.zip`;
    // Ссылка должна быть в документе, иначе часть браузеров теряет имя файла.
    document.body.append(link);
    link.click();
    link.remove();
    // Ссылку освобождаем позже: сразу после клика браузер ещё не начал скачивание.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (!can.documents && !can.catalog && !can.stock) return null;

  return (
    <Card className="mt-4" data-testid="exports-panel">
      <CardTitle>{t('title')}</CardTitle>
      <CardHint>{t('hint')}</CardHint>

      {can.documents ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
            <Field label={t('from')}>
              <Input
                type="date"
                value={period.from}
                data-testid="export-from"
                onChange={(event) =>
                  setPeriod((current) => ({ ...current, from: event.target.value }))
                }
              />
            </Field>
            <Field label={t('to')}>
              <Input
                type="date"
                value={period.to}
                data-testid="export-to"
                onChange={(event) =>
                  setPeriod((current) => ({ ...current, to: event.target.value }))
                }
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              disabled={pending}
              data-testid="export-bundle"
              onClick={() => void downloadBundle()}
            >
              {pending ? t('bundlePending') : t('bundle')}
            </Button>
            {error ? (
              <span
                className="text-danger text-sm font-semibold"
                role="alert"
                data-testid="export-error"
              >
                {t(`errors.${error}` as 'errors.unknown')}
              </span>
            ) : null}
          </div>

          <p className="text-muted-foreground mt-4 text-xs">{t('oneC')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ONE_C_KINDS.map((kind) => (
              <a
                key={kind}
                href={`/api/exports/one-c?kind=${kind}&${query}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid={`export-one-c-${kind}`}
              >
                {t(`oneCKinds.${kind}`)}
              </a>
            ))}
          </div>
        </>
      ) : null}

      {can.catalog || can.stock ? (
        <>
          <p className="text-muted-foreground mt-4 text-xs">{t('csv')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {can.catalog ? (
              <a
                href={`/api/exports/csv/catalog?${query}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="export-csv-catalog"
              >
                {t('csvCatalog')}
              </a>
            ) : null}
            {can.stock ? (
              <a
                href={`/api/exports/csv/stock?${query}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="export-csv-stock"
              >
                {t('csvStock')}
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </Card>
  );
}
