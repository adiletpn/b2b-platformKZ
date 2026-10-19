import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { listDemoBins } from '@/mocks/bin-registry';
import { OnboardingForm } from './onboarding-form';

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/login', locale });

  const cities = await prisma.city.findMany({ orderBy: { nameRu: 'asc' } });

  return (
    <OnboardingForm
      cities={cities.map((city) => ({
        id: city.id,
        name: locale === 'kk' ? city.nameKk : city.nameRu,
      }))}
      demoBins={listDemoBins().map((entry) => ({ bin: entry.bin, name: entry.name }))}
    />
  );
}
