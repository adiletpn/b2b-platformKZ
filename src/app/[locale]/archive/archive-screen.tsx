'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DocumentType } from '@/generated/prisma/enums';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { DocumentSignatures, type SignatureMark } from '@/components/document-signatures';
import { AttachmentsPanel, type FileRow } from '@/components/attachments-panel';
import { ExportsPanel } from './exports-panel';

type Row = {
  id: string;
  type: DocumentType;
  number: string;
  issuedAt: string;
  counterpartyName: string;
  orderNumber: string;
  totalWithVat: string;
  version: number;
  outgoing: boolean;
  signatures: SignatureMark[];
  signedByMe: boolean;
};

const TYPES: DocumentType[] = [
  'WAYBILL',
  'INVOICE',
  'DISCREPANCY_ACT',
  'RETURN_WAYBILL',
  'SETTLEMENT_ACT',
];

export function ArchiveScreen({
  locale,
  initialDocuments,
  title,
  canSign,
  exports,
  files,
}: {
  locale: 'ru' | 'kk';
  initialDocuments: Row[];
  title: string;
  canSign: boolean;
  exports: { documents: boolean; catalog: boolean; stock: boolean };
  files: { initial: FileRow[]; canUpload: boolean; canDelete: boolean };
}) {
  const t = useTranslations('archive');
  const tTypes = useTranslations('documents.types');
  const [rows, setRows] = useState(initialDocuments);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function reload(next: { search?: string; type?: string }) {
    const params = new URLSearchParams();
    const query = next.search ?? search;
    const kind = next.type ?? type;
    if (query) params.set('search', query);
    if (kind) params.set('type', kind);

    const response = await fetch(`/api/archive?${params.toString()}`);
    if (!response.ok) return;
    const data = (await response.json()) as { documents: Row[] };
    setRows(data.documents);
  }

  return (
    <Page width="lg">
      <PageHeader
        title={title}
        description={t('subtitle')}
        actions={
          <a
            href={`/api/archive/export?locale=${locale}${type ? `&type=${type}` : ''}${
              search ? `&search=${encodeURIComponent(search)}` : ''
            }`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="archive-export"
          >
            {t('export')}
          </a>
        }
      />

      <ExportsPanel locale={locale} can={exports} />

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('search')}>
            <Input
              value={search}
              data-testid="archive-search"
              onChange={(event) => {
                const value = event.target.value;
                setSearch(value);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => void reload({ search: value }), 250);
              }}
            />
          </Field>
          <Field label={t('type')}>
            <select
              className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
              value={type}
              data-testid="archive-type"
              onChange={(event) => {
                setType(event.target.value);
                void reload({ type: event.target.value });
              }}
            >
              <option value="">{t('allTypes')}</option>
              {TYPES.map((item) => (
                <option key={item} value={item}>
                  {tTypes(item)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState>
            <span data-testid="archive-empty">{t('empty')}</span>
          </EmptyState>
        </div>
      ) : (
        <Card className="mt-4 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="text-muted-foreground border-border bg-muted/50 border-b text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('number')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('type')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('date')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('counterparty')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('total')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('signatures')}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y" data-testid="archive-table">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5 text-[13px] font-bold whitespace-nowrap tabular-nums">
                      {row.number}
                      {row.version > 1 ? (
                        <Badge tone="warning" className="ml-2" data-testid="archive-version">
                          {t('versionShort', { version: row.version })}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={row.outgoing ? 'info' : 'neutral'}>{tTypes(row.type)}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{row.issuedAt}</td>
                    <td className="px-4 py-2.5 break-words">{row.counterpartyName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.totalWithVat}</td>
                    <td className="px-4 py-2.5">
                      <DocumentSignatures
                        documentId={row.id}
                        signatures={row.signatures}
                        canSign={canSign && !row.signedByMe}
                        compact
                        onSigned={() => void reload({})}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`/api/documents/${row.id}/pdf?locale=${locale}`}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        {t('open')}
                      </a>
                      <a
                        href={`/api/documents/${row.id}/xlsx?locale=${locale}`}
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        {t('excel')}
                      </a>
                      {/* ЭСФ выписывает продавец: кнопка только у своего счёта. */}
                      {row.type === 'INVOICE' && row.outgoing ? (
                        <a
                          href={`/api/exports/esf/${row.id}`}
                          className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} ml-2`}
                          data-testid={`export-esf-${row.number}`}
                        >
                          {t('exportEsf')}
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AttachmentsPanel
        initialFiles={files.initial}
        canUpload={files.canUpload}
        canDelete={files.canDelete}
      />
    </Page>
  );
}
