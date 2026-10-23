'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';

export type FileRow = {
  id: string;
  kind: 'CONTRACT' | 'CERTIFICATE' | 'LICENSE' | 'PHOTO' | 'OTHER';
  fileName: string;
  size: number;
  createdAt: string;
  companyName: string;
  mine: boolean;
};

const KINDS = ['CONTRACT', 'CERTIFICATE', 'LICENSE', 'PHOTO', 'OTHER'] as const;
const ERRORS = ['empty', 'too_large', 'unsupported_type', 'invalid_kind', 'not_found', 'forbidden'];

/**
 * Свои файлы к заявке или компании (раздел 4.3 ТЗ): договоры, сертификаты, лицензии, фото.
 * Без `orderId` панель показывает файлы компании в архиве.
 */
export function AttachmentsPanel({
  orderId,
  initialFiles,
  canUpload,
  canDelete,
}: {
  orderId?: string;
  initialFiles: FileRow[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations('files');
  const [files, setFiles] = useState<FileRow[]>(initialFiles);
  const [kind, setKind] = useState<(typeof KINDS)[number]>(orderId ? 'PHOTO' : 'CONTRACT');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch(`/api/files${orderId ? `?orderId=${orderId}` : ''}`);
    if (!response.ok) return;
    const data = (await response.json()) as { files: FileRow[] };
    setFiles(data.files);
  }

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) {
      setError('empty');
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set('file', file);
    form.set('kind', kind);
    form.set('idempotencyKey', crypto.randomUUID());
    if (orderId) form.set('orderId', orderId);

    const response = await fetch('/api/files', { method: 'POST', body: form });
    const data = (await response.json().catch(() => ({}))) as { status?: string; error?: string };
    setPending(false);

    if (data.status !== 'ok') {
      const code = data.status ?? data.error ?? 'unknown';
      setError(ERRORS.includes(code) ? code : 'unknown');
      return;
    }
    if (input.current) input.current.value = '';
    await load();
  }

  async function remove(id: string) {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/files/${id}`, { method: 'DELETE' });
    setPending(false);
    if (!response.ok) {
      setError(response.status === 403 ? 'forbidden' : 'unknown');
      return;
    }
    await load();
  }

  return (
    <Card className="mt-5" data-testid={orderId ? 'order-files' : 'company-files'}>
      <CardTitle>{orderId ? t('orderTitle') : t('companyTitle')}</CardTitle>
      <CardHint>{orderId ? t('orderHint') : t('companyHint')}</CardHint>

      {canUpload ? (
        <div className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[12rem_1fr_auto]">
          <Field label={t('kind')}>
            <select
              className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
              value={kind}
              data-testid="file-kind"
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {t(`kinds.${item}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('file')}>
            <input
              ref={input}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx"
              className="border-border bg-card file:bg-muted h-11 w-full min-w-0 rounded-2xl border px-2 py-2 text-sm file:mr-3 file:rounded-xl file:border-0 file:px-2"
              data-testid="file-input"
            />
          </Field>
          <Button disabled={pending} data-testid="file-upload" onClick={() => void upload()}>
            {pending ? t('uploading') : t('upload')}
          </Button>
          <p className="text-muted-foreground text-xs sm:col-span-3">{t('limits')}</p>
        </div>
      ) : null}

      {error ? (
        <p className="text-danger mt-3 text-sm" role="alert" data-testid="file-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}

      {files.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm" data-testid="files-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-border mt-4 divide-y text-sm" data-testid="files-list">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Badge tone="info">{t(`kinds.${file.kind}`)}</Badge>
              <a
                href={`/api/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary min-w-0 flex-1 break-all underline"
                data-testid="file-link"
              >
                {file.fileName}
              </a>
              <span className="text-muted-foreground text-xs font-semibold">
                {t('meta', {
                  size: Math.max(1, Math.round(file.size / 1024)),
                  date: file.createdAt,
                })}
                {orderId && !file.mine ? ` · ${file.companyName}` : ''}
              </span>
              {file.mine && canDelete ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  data-testid="file-delete"
                  onClick={() => void remove(file.id)}
                >
                  {t('delete')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
