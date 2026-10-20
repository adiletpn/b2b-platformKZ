'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type SignatureMark = { signerName: string; signedAt: string; certificate: string };

const ERRORS = ['not_found', 'not_a_party', 'forbidden'];

/**
 * Отметка «подписано ЭЦП, кто и когда» и кнопка подписи (раздел 3.5 ТЗ).
 * Общая для карточки заявки и архива документов.
 */
export function DocumentSignatures({
  documentId,
  signatures,
  canSign,
  compact = false,
  onSigned,
}: {
  documentId: string;
  signatures: SignatureMark[];
  canSign: boolean;
  compact?: boolean;
  /** Экран со своим состоянием (архив) перечитывает список сам. */
  onSigned?: () => void;
}) {
  const t = useTranslations('documents.signature');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sign() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}/sign`, { method: 'POST' });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);

    if (data.status !== 'ok') {
      const code = data.status ?? data.error ?? 'unknown';
      setError(ERRORS.includes(code) ? code : 'unknown');
      return;
    }
    if (onSigned) onSigned();
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`signatures-${documentId}`}>
      {signatures.map((signature) => (
        <Badge
          key={`${signature.signerName}-${signature.signedAt}`}
          tone="success"
          title={t('certificate', { certificate: signature.certificate })}
          data-testid="signature-mark"
          className="whitespace-normal"
        >
          {compact
            ? t('signedShort', { name: signature.signerName })
            : t('signed', { name: signature.signerName, date: signature.signedAt })}
        </Badge>
      ))}
      {signatures.length === 0 && compact ? <Badge tone="neutral">{t('notSigned')}</Badge> : null}
      {canSign ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          data-testid={`sign-document-${documentId}`}
          onClick={() => void sign()}
        >
          {pending ? t('signing') : t('sign')}
        </Button>
      ) : null}
      {error ? (
        <span className="text-danger text-xs" role="alert" data-testid="sign-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </span>
      ) : null}
    </div>
  );
}
