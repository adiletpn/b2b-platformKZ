import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { permissionFlags } from '@/lib/auth/permissions';
import { searchDocuments } from '@/lib/archive/search';
import { listAttachments } from '@/lib/files/attachments';
import { prisma } from '@/lib/prisma';
import { ArchiveScreen } from './archive-screen';

export default async function ArchivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const documents = await searchDocuments(active!.companyId);
  const t = await getTranslations('archive');
  const can = await permissionFlags('DOCUMENTS_PAYMENTS', ['SIGN', 'CREATE', 'DELETE', 'EXPORT']);
  const [catalog, stock, company] = await Promise.all([
    permissionFlags('CATALOG', ['EXPORT']),
    permissionFlags('STOCK', ['EXPORT']),
    prisma.company.findUnique({ where: { id: active!.companyId }, select: { type: true } }),
  ]);

  return (
    <ArchiveScreen
      locale={locale === 'kk' ? 'kk' : 'ru'}
      initialDocuments={documents}
      title={t('title')}
      canSign={can.SIGN}
      exports={{
        documents: can.EXPORT,
        // CSV каталога нужен поставщику, CSV остатков — магазину.
        catalog: catalog.EXPORT && company?.type !== 'STORE',
        stock: stock.EXPORT && company?.type !== 'SUPPLIER',
      }}
      files={{
        initial: (await listAttachments(active!.companyId)) ?? [],
        canUpload: can.CREATE,
        canDelete: can.DELETE,
      }}
    />
  );
}
