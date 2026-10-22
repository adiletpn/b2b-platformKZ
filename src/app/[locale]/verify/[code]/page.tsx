import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { verifyDocument } from '@/lib/documents/verification';
import { money } from '@/lib/format';

// Страница открыта без входа: в поисковики она попадать не должна.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Проверка документа по QR с печатной формы (раздел 4.4 ТЗ). */
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const { v } = await searchParams;
  const t = await getTranslations('verify');
  const tTypes = await getTranslations('documents.types');

  const printed = v && /^\d+$/.test(v) ? Number(v) : undefined;
  const document = await verifyDocument(code, printed);

  if (!document) {
    return (
      <Page width="sm">
        <PageHeader title={t('title')} />
        <EmptyState>
          <span data-testid="verify-not-found">{t('notFound')}</span>
        </EmptyState>
      </Page>
    );
  }

  const rows: [string, string][] = [
    [t('type'), tTypes(document.type)],
    [t('number'), document.number],
    [t('date'), document.issuedAt],
    [t('issuer'), `${document.issuer.name} · ${document.issuer.bin}`],
    [t('recipient'), `${document.recipient.name} · ${document.recipient.bin}`],
    [t('total'), `${money(document.totalWithVat)} ₸`],
    [
      t('version'),
      t('versionValue', { version: document.currentVersion, date: document.currentVersionDate }),
    ],
  ];

  return (
    <Page width="sm">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card data-testid="verify-result">
        <Badge tone={document.outdated ? 'warning' : 'success'} data-testid="verify-status">
          {document.outdated ? t('outdated') : t('valid')}
        </Badge>
        {document.outdated ? (
          <p className="text-muted-foreground mt-2 text-sm">{t('outdatedHint')}</p>
        ) : null}

        <dl className="mt-4 space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-5 text-[15px] font-extrabold">{t('signatures')}</h2>
        {document.signatures.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-[13px] font-semibold">
            {t('noSignatures')}
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm" data-testid="verify-signatures">
            {document.signatures.map((signature) => (
              <li key={`${signature.signerName}-${signature.signedAt}`}>
                {t('signedBy', { name: signature.signerName, date: signature.signedAt })}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
