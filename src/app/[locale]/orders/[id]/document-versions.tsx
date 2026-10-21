'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export type VersionRow = {
  version: number;
  current: boolean;
  reason: string | null;
  date: string;
  totalWithVat: string;
};

const ERRORS = ['reason_required', 'invalid_address', 'not_issuer', 'conflict', 'not_found'];

/**
 * Раздел 4.3 ТЗ: исправление документа новой версией и история прошлых версий.
 * Исправляет выписавшая сторона; прошлые версии открываются в PDF как были.
 */
export function DocumentVersions({
  documentId,
  locale,
  versions,
  deliveryAddress,
  canCorrect,
}: {
  documentId: string;
  locale: 'ru' | 'kk';
  versions: VersionRow[];
  deliveryAddress: string;
  canCorrect: boolean;
}) {
  const t = useTranslations('documents.versions');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [address, setAddress] = useState(deliveryAddress);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const current = versions.find((row) => row.current);
  const history = versions.filter((row) => !row.current);

  async function submit() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}/correct`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason,
        deliveryAddress: address === deliveryAddress ? undefined : address,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
    setPending(false);

    if (data.status !== 'ok') {
      const code = data.status ?? data.error ?? 'unknown';
      setError(ERRORS.includes(code) ? code : 'unknown');
      return;
    }
    setOpen(false);
    setReason('');
    router.refresh();
  }

  return (
    <div className="space-y-2" data-testid={`versions-${documentId}`}>
      <div className="flex flex-wrap items-center gap-2">
        {current && current.version > 1 ? (
          <Badge tone="warning" className="whitespace-normal" data-testid="document-version">
            {t('corrected', { version: current.version, date: current.date })}
            {current.reason ? ` · ${current.reason}` : ''}
          </Badge>
        ) : null}
        {canCorrect && !open ? (
          <Button
            variant="ghost"
            size="sm"
            data-testid={`correct-document-${documentId}`}
            onClick={() => setOpen(true)}
          >
            {t('correct')}
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="border-border space-y-3 rounded-2xl border-[1.5px] border-dashed p-3">
          <p className="text-muted-foreground text-xs">{t('hint')}</p>
          <Field label={t('reason')}>
            <Input
              value={reason}
              data-testid="correction-reason"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Field label={t('address')}>
            <Input
              value={address}
              data-testid="correction-address"
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              data-testid="correction-submit"
              onClick={() => void submit()}
            >
              {pending ? t('saving') : t('save')}
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
          {error ? (
            <p className="text-danger text-xs" role="alert" data-testid="correction-error">
              {t(`errors.${error}` as 'errors.unknown')}
            </p>
          ) : null}
        </div>
      ) : null}

      {history.length > 0 ? (
        <details className="text-xs" data-testid="version-history">
          <summary className="text-muted-foreground cursor-pointer">
            {t('history', { count: history.length })}
          </summary>
          <ul className="mt-1 space-y-1 pl-3">
            {history.map((row) => (
              <li key={row.version} className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/documents/${documentId}/pdf?locale=${locale}&version=${row.version}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                  data-testid={`version-pdf-${row.version}`}
                >
                  {t('versionLink', { version: row.version, date: row.date })}
                </a>
                {row.reason ? <span className="text-muted-foreground">{row.reason}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
