import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BarChart3, ShoppingBag, TrendingUp, Truck } from 'lucide-react';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';
import { parsePeriod, storeAnalytics, supplierAnalytics } from '@/lib/analytics/analytics';
import { kzDayKey, money } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardTitle, StatCard } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { BarChart } from '@/components/bar-chart';

/**
 * Аналитика (этап 3 ТЗ). Магазину — продажи и прибыль, ABC, оборачиваемость, рекомендации
 * закупок; поставщику — оборот по магазинам и товарам, выполнение заявок, топ магазинов.
 * Прибыль видна только с правом на закупочные цены (раздел 3.12 ТЗ).
 */
export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await getAccess();
  if (!access) redirect({ href: '/login', locale });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: access!.companyId } });
  const storeAllowed =
    company.type !== 'SUPPLIER' && (await hasPermission(access!, 'PURCHASE_PRICES', 'VIEW'));
  const supplierAllowed =
    company.type !== 'STORE' && (await hasPermission(access!, 'SWIPE_ORDERS', 'VIEW'));
  if (!storeAllowed && !supplierAllowed) redirect({ href: '/dashboard', locale });

  const query = await searchParams;
  const period = parsePeriod(query.from, query.to);
  const [store, supplier] = await Promise.all([
    storeAllowed ? storeAnalytics(access!.companyId, period, access!.allowedLocationIds) : null,
    supplierAllowed ? supplierAnalytics(access!.companyId, period) : null,
  ]);

  const t = await getTranslations('analytics');
  const name = (row: { nameRu: string; nameKk: string }) =>
    (locale === 'kk' ? row.nameKk : row.nameRu) || t('noCategory');
  const from = kzDayKey(period.from);
  const to = kzDayKey(period.to);
  const table = 'w-full min-w-[420px] text-sm';
  const th = 'text-muted-foreground px-3 py-2 text-left font-medium';
  const td = 'px-3 py-2';
  const num = 'px-3 py-2 text-right tabular-nums';

  return (
    <Page width="lg">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <a
            href={`/api/analytics/xlsx?from=${from}&to=${to}&locale=${locale}`}
            className={buttonVariants({ variant: 'outline' })}
            data-testid="analytics-xlsx"
          >
            {t('downloadXlsx')}
          </a>
        }
      />

      <form className="mb-4 flex flex-wrap items-end gap-2" data-testid="analytics-period">
        <Field label={t('from')}>
          <Input type="date" name="from" defaultValue={from} className="w-40" />
        </Field>
        <Field label={t('to')}>
          <Input type="date" name="to" defaultValue={to} className="w-40" />
        </Field>
        <Button type="submit" variant="outline">
          {t('apply')}
        </Button>
      </form>

      {store ? (
        <section className="space-y-4" data-testid="analytics-store">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard icon={ShoppingBag} label={t('revenue')} value={`${money(store.revenue)} ₸`} />
            <StatCard
              icon={TrendingUp}
              tone="success"
              label={t('profit')}
              value={`${money(store.profit)} ₸`}
            />
            <StatCard icon={BarChart3} label={t('receipts')} value={store.receipts} />
          </div>

          <Card>
            <CardTitle className="text-sm">{t('byDay')}</CardTitle>
            {store.byDay.length === 0 ? (
              <EmptyState>{t('noSales')}</EmptyState>
            ) : (
              <div className="mt-3">
                <BarChart
                  testId="analytics-chart"
                  title={t('byDay')}
                  seriesLabels={[t('revenue'), t('profit')]}
                  data={store.byDay.map((row) => ({
                    label: row.day.slice(5),
                    value: Number(row.revenue),
                    second: Number(row.profit),
                  }))}
                />
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="overflow-x-auto">
              <CardTitle className="text-sm">{t('byCategory')}</CardTitle>
              <table className={table} data-testid="analytics-categories">
                <thead>
                  <tr>
                    <th className={th}>{t('category')}</th>
                    <th className={`${th} text-right`}>{t('revenue')}</th>
                    <th className={`${th} text-right`}>{t('profit')}</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {store.byCategory.map((row) => (
                    <tr key={row.nameRu}>
                      <td className={td}>{name(row)}</td>
                      <td className={num}>{row.revenue}</td>
                      <td className={num}>{row.profit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="overflow-x-auto">
              <CardTitle className="text-sm">{t('abc')}</CardTitle>
              <table className={table} data-testid="analytics-abc">
                <thead>
                  <tr>
                    <th className={th}>{t('product')}</th>
                    <th className={`${th} text-right`}>{t('revenue')}</th>
                    <th className={`${th} text-right`}>{t('share')}</th>
                    <th className={th}>{t('group')}</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {store.abc.map((row) => (
                    <tr key={row.productId}>
                      <td className={td}>{name(row)}</td>
                      <td className={num}>{row.revenue}</td>
                      <td className={num}>{row.share}%</td>
                      <td className={td}>
                        <Badge
                          tone={
                            row.group === 'A' ? 'success' : row.group === 'B' ? 'info' : 'neutral'
                          }
                        >
                          {row.group}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card className="overflow-x-auto">
            <CardTitle className="text-sm">{t('turnover')}</CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('staleHint', { days: store.staleDays })}
            </p>
            <table className={table} data-testid="analytics-turnover">
              <thead>
                <tr>
                  <th className={th}>{t('product')}</th>
                  <th className={`${th} text-right`}>{t('stock')}</th>
                  <th className={`${th} text-right`}>{t('sold')}</th>
                  <th className={`${th} text-right`}>{t('daysOfStock')}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {store.turnover.map((row) => (
                  <tr key={row.productId}>
                    <td className={td}>
                      {name(row)}{' '}
                      {row.stale ? (
                        <Badge tone="warning" data-testid="analytics-stale">
                          {t('stale')}
                        </Badge>
                      ) : null}
                    </td>
                    <td className={num}>{row.stock}</td>
                    <td className={num}>{row.sold}</td>
                    <td className={num}>{row.daysOfStock ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <CardTitle className="text-sm">{t('recommendations')}</CardTitle>
            {store.recommendations.length === 0 ? (
              <p className="text-muted-foreground mt-2 text-sm">{t('noRecommendations')}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm" data-testid="analytics-recommendations">
                {store.recommendations.map((row) => (
                  <li key={row.productId} className="flex flex-wrap justify-between gap-2">
                    <span>{name(row)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {t('recommendation', {
                        suggested: row.suggested,
                        days: row.daysLeft,
                        supplier: row.supplierName ?? '—',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      ) : null}

      {supplier ? (
        <section
          className={store ? 'mt-8 space-y-4' : 'space-y-4'}
          data-testid="analytics-supplier"
        >
          {store ? <h2 className="text-lg font-semibold">{t('supplierTitle')}</h2> : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard
              icon={Truck}
              label={t('turnoverTotal')}
              value={`${money(supplier.turnover)} ₸`}
            />
            <StatCard icon={BarChart3} label={t('ordersShipped')} value={supplier.orders} />
            <StatCard
              icon={TrendingUp}
              tone="success"
              label={t('fulfillment')}
              value={supplier.fulfillmentShare ? `${supplier.fulfillmentShare}%` : '—'}
              hint={t('fulfillmentHint', {
                done: supplier.fulfilled,
                failed: supplier.notFulfilled,
              })}
            />
          </div>

          <Card>
            <CardTitle className="text-sm">{t('topStores')}</CardTitle>
            {supplier.topStores.length === 0 ? (
              <EmptyState>{t('noOrders')}</EmptyState>
            ) : (
              <div className="mt-3">
                <BarChart
                  testId="analytics-top-stores"
                  title={t('topStores')}
                  seriesLabels={[t('turnoverTotal')]}
                  data={supplier.topStores.map((row) => ({
                    label: row.name.slice(0, 14),
                    value: Number(row.amount),
                  }))}
                />
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="overflow-x-auto">
              <CardTitle className="text-sm">{t('byStore')}</CardTitle>
              <table className={table} data-testid="analytics-stores">
                <thead>
                  <tr>
                    <th className={th}>{t('store')}</th>
                    <th className={`${th} text-right`}>{t('orders')}</th>
                    <th className={`${th} text-right`}>{t('turnoverTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {supplier.byStore.map((row) => (
                    <tr key={row.storeId}>
                      <td className={td}>{row.name}</td>
                      <td className={num}>{row.orders}</td>
                      <td className={num}>{row.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card className="overflow-x-auto">
              <CardTitle className="text-sm">{t('byProduct')}</CardTitle>
              <table className={table} data-testid="analytics-products">
                <thead>
                  <tr>
                    <th className={th}>{t('product')}</th>
                    <th className={`${th} text-right`}>{t('quantity')}</th>
                    <th className={`${th} text-right`}>{t('turnoverTotal')}</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {supplier.byProduct.map((row) => (
                    <tr key={row.nameRu}>
                      <td className={td}>{name(row)}</td>
                      <td className={num}>{row.quantity}</td>
                      <td className={num}>{row.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </section>
      ) : null}
    </Page>
  );
}
