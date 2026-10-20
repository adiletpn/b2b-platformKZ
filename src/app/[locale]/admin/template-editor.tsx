'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import type { TemplateEditorData } from '@/lib/admin/templates';

const TYPES = ['WAYBILL', 'INVOICE', 'DISCREPANCY_ACT', 'RETURN_WAYBILL'] as const;
const LOCALES = ['ru', 'kk'] as const;
const ERRORS = ['empty', 'too_long', 'syntax_error', 'invalid_template', 'forbidden'];

/** Поля, которые можно вставить в шаблон. Перечень совпадает с `templateContext`. */
const FIELDS = [
  '{{number}}',
  '{{issuedAt}}',
  '{{orderNumber}}',
  '{{deliveryAddress}}',
  '{{supplier.name}} / {{store.name}}',
  '{{supplier.bin}} / {{supplier.legalAddress}}',
  '{{supplier.requisites}} / {{supplier.requisitesShort}}',
  '{{#lines}} {{position}} {{name}} {{unit}} {{quantity}} {{priceWithoutVat}} {{vatRate}} {{vatAmount}} {{totalWithVat}} {{/lines}}',
  '{{#discrepancies}} {{quantityShipped}} {{quantityAccepted}} {{amountDifference}} {{/discrepancies}}',
  '{{totalWithoutVat}} {{vatAmount}} {{totalWithVat}}',
  '{{#supplier.isVatPayer}} … {{/supplier.isVatPayer}} · {{^supplier.isVatPayer}} … {{/supplier.isVatPayer}}',
  '{{#correction}} {{correction.version}} {{correction.correctedAt}} {{correction.reason}} {{/correction}}',
  '{{{blocks.qr}}}',
];

/**
 * Редактор печатных форм (раздел 3.13 ТЗ): накладная, счёт и акты на двух языках.
 * Предпросмотр — только готовый PDF: HTML шаблона в страницу админки не вставляется.
 */
export function TemplateEditor({ initial }: { initial: TemplateEditorData }) {
  const t = useTranslations('admin.templates');
  const tTypes = useTranslations('documents.types');
  const [data, setData] = useState(initial);
  const [body, setBody] = useState(initial.body);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error?: string; key?: string; saved?: number } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  async function load(type: string, locale: string) {
    setPending(true);
    setMessage(null);
    const response = await fetch(`/api/admin/templates?type=${type}&locale=${locale}`);
    setPending(false);
    if (!response.ok) {
      setMessage({ error: response.status === 403 ? 'forbidden' : 'unknown' });
      return;
    }
    const next = (await response.json()) as TemplateEditorData;
    setData(next);
    setBody(next.body);
    setPreview(null);
  }

  function fail(data: { status?: string; error?: string; key?: string }) {
    const code = data.status ?? data.error ?? 'unknown';
    setMessage({ error: ERRORS.includes(code) ? code : 'unknown', key: data.key });
  }

  async function showPreview() {
    setPending(true);
    setMessage(null);
    const response = await fetch('/api/admin/templates/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: data.type, locale: data.locale, body }),
    });
    setPending(false);
    if (!response.ok) {
      fail((await response.json().catch(() => ({}))) as { status?: string });
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(await response.blob()));
  }

  async function post(action: 'save' | 'reset') {
    setPending(true);
    setMessage(null);
    const response = await fetch('/api/admin/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, type: data.type, locale: data.locale, body }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      status?: string;
      version?: number;
      key?: string;
    };
    setPending(false);
    if (result.status !== 'ok') {
      fail(result);
      return;
    }
    await load(data.type, data.locale);
    setMessage({ saved: result.version ?? 0 });
  }

  return (
    <Card data-testid="template-editor">
      <CardTitle>{t('title')}</CardTitle>
      <CardHint>{t('hint')}</CardHint>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <Field label={t('type')}>
            <select
              className="border-border bg-card h-11 w-full rounded-lg border px-3"
              value={data.type}
              disabled={pending}
              data-testid="template-type"
              onChange={(event) => void load(event.target.value, data.locale)}
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {tTypes(type)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-full sm:w-40">
          <Field label={t('locale')}>
            <select
              className="border-border bg-card h-11 w-full rounded-lg border px-3"
              value={data.locale}
              disabled={pending}
              data-testid="template-locale"
              onChange={(event) => void load(data.type, event.target.value)}
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {t(`locales.${locale}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Badge tone={data.isDefault ? 'neutral' : 'info'} data-testid="template-state">
          {data.isDefault
            ? t('isDefault')
            : t('activeVersion', {
                version: data.history.find((row) => row.isActive)?.version ?? 0,
              })}
        </Badge>
      </div>

      <textarea
        className="border-border bg-card mt-4 h-96 w-full rounded-lg border p-3 font-mono text-xs"
        spellCheck={false}
        value={body}
        data-testid="template-body"
        onChange={(event) => setBody(event.target.value)}
      />

      <details className="mt-2 text-xs">
        <summary className="text-muted-foreground cursor-pointer">{t('fields')}</summary>
        <p className="text-muted-foreground mt-1">{t('fieldsHint')}</p>
        <ul className="mt-1 space-y-0.5 font-mono break-all">
          {FIELDS.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </details>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          data-testid="template-preview"
          onClick={() => void showPreview()}
        >
          {t('preview')}
        </Button>
        <Button disabled={pending} data-testid="template-save" onClick={() => void post('save')}>
          {t('save')}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          data-testid="template-insert-default"
          onClick={() => setBody(data.defaultBody)}
        >
          {t('insertDefault')}
        </Button>
        <Button
          variant="ghost"
          disabled={pending || data.isDefault}
          data-testid="template-reset"
          onClick={() => void post('reset')}
        >
          {t('reset')}
        </Button>
      </div>

      {message?.error ? (
        <p className="text-danger mt-3 text-sm" role="alert" data-testid="template-error">
          {t(`errors.${message.error}` as 'errors.unknown', { key: message.key ?? '' })}
        </p>
      ) : null}
      {message?.saved !== undefined ? (
        <p className="text-success mt-3 text-sm" data-testid="template-saved">
          {message.saved > 0 ? t('saved', { version: message.saved }) : t('resetDone')}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4">
          <a
            href={preview}
            target="_blank"
            rel="noreferrer"
            className="text-primary text-sm underline"
            data-testid="template-preview-link"
          >
            {t('openPreview')}
          </a>
          <iframe
            title={t('preview')}
            src={preview}
            className="border-border mt-2 h-[32rem] w-full rounded-lg border"
            data-testid="template-preview-frame"
          />
        </div>
      ) : null}

      {data.history.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-medium">{t('history')}</h3>
          <ul className="divide-border mt-2 divide-y text-sm" data-testid="template-history">
            {data.history.map((row) => (
              <li key={row.version} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-mono">v{row.version}</span>
                <span className="text-muted-foreground text-xs">
                  {new Date(row.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })} ·{' '}
                  {row.adminName}
                </span>
                {row.isActive ? <Badge tone="success">{t('active')}</Badge> : null}
                <Button variant="ghost" size="sm" onClick={() => setBody(row.body)}>
                  {t('restore')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
