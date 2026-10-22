import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import {
  getReceivables,
  getStoreDebts,
  markOverdueOrders,
  paidThisMonth,
} from '@/lib/settlements/receivables';
import { storeDiscipline } from '@/lib/ratings/metrics';
import { Progress } from '@/components/ui/controls';
import { RemindButton } from './remind-button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { formatDate, money } from '@/lib/format';
import { prisma } from '@/lib/prisma';

/** Цвет метки платёжной дисциплины (раздел 3.8 ТЗ). */
const DISCIPLINE_TONE = {
  on_time: 'success',
  delays_up_to_7: 'warning',
  frequent_delays: 'danger',
} as const;

export default async function SettlementsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  // Фоновых задач в демо нет: просрочки пересчитываются при открытии отчёта.
  await markOverdueOrders();
  const companyId = active!.companyId;
  const [receivables, debts, paid, supplier] = await Promise.all([
    getReceivables(companyId),
    getStoreDebts(companyId),
    paidThisMonth(companyId),
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { creditLimit: true } }),
  ]);
  const disciplines = await Promise.all(debts.map((row) => storeDiscipline(row.storeId)));
  const overdueStores = debts.filter((row) => row.maxDaysOverdue > 0);
  const maxDays = Math.max(0, ...debts.map((row) => row.maxDaysOverdue));

  const t = await getTranslations('settlements');
  const tDiscipline = await getTranslations('ratings.discipline');

  return (
    <Page width="lg">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {/* Макет D06: три плашки — должны, просрочено, оплачено за месяц. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-muted-foreground text-[13px] font-bold">{t('owedToYou')}</p>
          <p
            className="mt-1.5 text-[28px] font-black tracking-[-0.02em] tabular-nums"
            data-testid="receivables-total"
          >
            {money(receivables.total)} ₸
          </p>
          <p className="text-muted-foreground text-[13px] font-semibold">
            {t('storesCount', { count: debts.length })}
          </p>
        </Card>
        <Card>
          <p className="text-muted-foreground text-[13px] font-bold">{t('overdue')}</p>
          <p
            className="text-danger mt-1.5 text-[28px] font-black tracking-[-0.02em] tabular-nums"
            data-testid="receivables-overdue"
          >
            {money(receivables.overdueTotal)} ₸
          </p>
          <p className="text-muted-foreground text-[13px] font-semibold">
            {t('overdueMeta', {
              stores: t('storesCount', { count: overdueStores.length }),
              days: maxDays,
            })}
          </p>
        </Card>
        <Card>
          <p className="text-muted-foreground text-[13px] font-bold">{t('paidMonth')}</p>
          <p
            className="mt-1.5 text-[28px] font-black tracking-[-0.02em] tabular-nums"
            data-testid="paid-month"
          >
            {money(paid.total)} ₸
          </p>
          <p className="text-muted-foreground text-[13px] font-semibold">
            {t('ordersCount', { count: paid.orders })}
          </p>
        </Card>
      </div>

      {debts.length > 0 ? (
        <Card className="mt-4 overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm" data-testid="store-debts">
              <thead className="text-left">
                <tr>
                  <th className="px-4 py-2.5">{t('store')}</th>
                  <th className="px-4 py-2.5">{t('discipline')}</th>
                  <th className="px-4 py-2.5 text-right">{t('debt')}</th>
                  <th className="px-4 py-2.5 text-right">{t('overdue')}</th>
                  <th className="px-4 py-2.5 text-right">{t('days')}</th>
                  <th className="px-4 py-2.5">{t('creditLimit')}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {debts.map((row, index) => (
                  <tr
                    key={row.storeId}
                    className={row.maxDaysOverdue > 0 ? 'bg-row-highlight' : undefined}
                    data-testid={`store-debt-${row.storeId}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-extrabold break-words">{row.storeName}</p>
                      {row.city ? (
                        <p className="text-muted-foreground text-xs font-semibold">{row.city}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={DISCIPLINE_TONE[disciplines[index]!]}>
                        {tDiscipline(disciplines[index]!)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-extrabold whitespace-nowrap tabular-nums">
                      {money(row.debt)} ₸
                    </td>
                    <td className="text-danger px-4 py-3 text-right font-extrabold whitespace-nowrap tabular-nums">
                      {row.maxDaysOverdue > 0 ? (
                        `${money(row.overdue)} ₸`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-danger px-4 py-3 text-right font-extrabold tabular-nums">
                      {row.maxDaysOverdue > 0 ? (
                        row.maxDaysOverdue
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="w-56 px-4 py-3">
                      {row.limitUsedPercent === null || !supplier.creditLimit ? (
                        <span className="text-muted-foreground text-xs font-semibold">
                          {t('noLimit')}
                        </span>
                      ) : (
                        <>
                          <Progress
                            value={row.limitUsedPercent}
                            tone={row.limitUsedPercent > 80 ? 'danger' : 'dark'}
                          />
                          <p className="text-muted-foreground mt-1.5 text-xs font-semibold">
                            {t('limitShare', {
                              percent: row.limitUsedPercent,
                              limit: money(supplier.creditLimit.toFixed(2)),
                            })}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.maxDaysOverdue > 0 ? <RemindButton storeId={row.storeId} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <h2 className="mt-6 mb-3 text-[17px] font-extrabold">{t('byOrders')}</h2>
      {receivables.rows.length === 0 ? (
        <div>
          <EmptyState>
            <span data-testid="receivables-empty">{t('empty')}</span>
          </EmptyState>
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
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
                    <td className="px-4 py-2.5 text-[13px] font-extrabold">{row.orderNumber}</td>
                    <td className="px-4 py-2.5 break-words">{row.storeName}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{row.dueDate ? formatDate(new Date(row.dueDate)) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-bold whitespace-nowrap tabular-nums">
                      {money(row.amount)} ₸
                    </td>
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
