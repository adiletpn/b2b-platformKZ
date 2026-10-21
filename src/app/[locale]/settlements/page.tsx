import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getReceivables, markOverdueOrders } from '@/lib/settlements/receivables';
import { Badge } from '@/components/ui/badge';
import { Card, CardHint, CardTitle } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { money } from '@/lib/format';

export default async function SettlementsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  // Фоновых задач в демо нет: просрочки пересчитываются при открытии отчёта.
  await markOverdueOrders();
  const receivables = await getReceivables(active!.companyId);

  const t = await getTranslations('settlements');

  return (
    <Page width="lg">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle className="text-sm">{t('total')}</CardTitle>
          <p className="mt-2 text-2xl font-semibold tabular-nums" data-testid="receivables-total">
            {money(receivables.total)} ₸
          </p>
        </Card>
        <Card>
          <CardTitle className="text-sm">{t('overdueTotal')}</CardTitle>
          <p
            className="text-danger mt-2 text-2xl font-semibold tabular-nums"
            data-testid="receivables-overdue"
          >
            {money(receivables.overdueTotal)} ₸
          </p>
          <CardHint>{t('overdueHint')}</CardHint>
        </Card>
      </div>

      {receivables.rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState>
            <span data-testid="receivables-empty">{t('empty')}</span>
          </EmptyState>
        </div>
      ) : (
        <Card className="mt-4 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-muted-foreground border-border bg-muted/50 border-b text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('order')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('store')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('dueDate')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('amount')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('overdueDays')}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y" data-testid="receivables-table">
                {receivables.rows.map((row) => (
                  <tr key={row.orderId}>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.orderNumber}</td>
                    <td className="px-4 py-2.5 break-words">{row.storeName}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{row.dueDate ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.amount}</td>
                    <td className="px-4 py-2.5 text-right">
                      {row.daysOverdue > 0 ? (
                        <Badge tone="danger">{row.daysOverdue}</Badge>
                      ) : (
                        <Badge tone="success">{t('onTime')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Page>
  );
}
