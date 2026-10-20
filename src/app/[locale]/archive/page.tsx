import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { searchDocuments } from '@/lib/archive/search';
import { ArchiveScreen } from './archive-screen';

export default async function ArchivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const documents = await searchDocuments(active!.companyId);
  const t = await getTranslations('archive');
  const access = await getAccess();
  const canSign = access ? await hasPermission(access, 'DOCUMENTS_PAYMENTS', 'SIGN') : false;

  return (
    <ArchiveScreen
      locale={locale === 'kk' ? 'kk' : 'ru'}
      initialDocuments={documents}
      title={t('title')}
      canSign={canSign}
    />
  );
}
