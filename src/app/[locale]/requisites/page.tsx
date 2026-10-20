import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';
import { RequisitesForm } from './requisites-form';
import { PaymentTermsForm } from './payment-terms-form';

export default async function RequisitesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: active!.companyId } });

  return (
    <RequisitesForm
      extra={
        company.type !== 'STORE' ? (
          <PaymentTermsForm
            initial={{
              paymentTerms: company.paymentTerms,
              deferralDays: company.deferralDays ? String(company.deferralDays) : '',
              creditLimit: company.creditLimit?.toFixed(2) ?? '',
            }}
          />
        ) : null
      }
      initial={{
        iik: company.iik ?? '',
        bik: company.bik ?? '',
        bankName: company.bankName ?? '',
      }}
      initialChannels={company.notificationChannels}
      initialCostMethod={company.costMethod}
    />
  );
}
