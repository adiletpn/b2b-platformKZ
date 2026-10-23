'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { NotYetBadge } from '@/components/ui/not-yet';
import { Card, CardTitle } from '@/components/ui/card';
import type { DashboardMetrics, DisputeRow, DisputeResolution } from '@/lib/admin/dashboard';
import type { PlanRow, SubscriptionRow } from '@/lib/admin/tariffs';
import type { ReferenceData, ReferenceKind } from '@/lib/admin/reference';
import { Page } from '@/components/ui/page';
import { money } from '@/lib/format';

type QueueItem = {
  id: string;
  companyName: string;
  bin: string;
  legalAddress: string;
  /** false — название и адрес ввёл пользователь, в реестре БИН их нет. */
  fromRegistry: boolean;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
};
type AuditItem = {
  id: string;
  action: string;
  admin: string;
  reason: string | null;
  createdAt: string;
};

export function AdminPanel({
  role,
  metrics,
  disputes,
  queue,
  audit,
  companies,
  activeImpersonation,
  plans,
  subscriptions,
  reference,
}: {
  role: string;
  metrics: DashboardMetrics;
  disputes: DisputeRow[];
  queue: QueueItem[];
  audit: AuditItem[];
  plans: PlanRow[];
  subscriptions: SubscriptionRow[];
  reference: ReferenceData;
  companies: { id: string; name: string }[];
  activeImpersonation: { id: string; companyName: string } | null;
}) {
  const t = useTranslations('admin');
  const tSoon = useTranslations('common.notYetItems');
  const router = useRouter();

  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [disputeForm, setDisputeForm] = useState<
    Record<string, { resolution: DisputeResolution; comment: string }>
  >({});
  const [impersonation, setImpersonation] = useState({
    companyId: companies[0]?.id ?? '',
    reason: '',
  });
  const [subscriptionForm, setSubscriptionForm] = useState({
    companyId: companies[0]?.id ?? '',
    planCode: plans[0]?.code ?? '',
    months: '1',
  });
  const [referenceForm, setReferenceForm] = useState({
    kind: 'unit' as ReferenceKind,
    code: '',
    nameRu: '',
    nameKk: '',
    rate: '',
    isDefault: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function post(path: string, body: unknown) {
    setPending(true);
    setError(null);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status ?? data.error ?? 'unknown');
      return;
    }
    router.refresh();
  }

  const canImpersonate = role === 'SUPERADMIN' || role === 'SUPPORT';
  const canBill = role === 'SUPERADMIN' || role === 'FINANCE';
  const canEditReference = role === 'SUPERADMIN' || role === 'CONTENT_MANAGER';

  return (
    <Page width="lg">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <span className="text-muted-foreground flex items-center gap-3 text-sm">
          <span>
            {t('roleLabel')}: <span data-testid="admin-role">{role}</span>
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="admin-logout"
            onClick={async () => {
              await fetch('/api/admin/logout', { method: 'POST' });
              router.refresh();
            }}
          >
            {t('logout')}
          </Button>
        </span>
      </header>

      {activeImpersonation ? (
        <div
          className="bg-warning-soft text-primary-text mt-4 rounded-2xl border p-3.5 text-sm font-semibold"
          data-testid="impersonation-banner"
        >
          {t('impersonationBanner', { company: activeImpersonation.companyName })}
          <Button
            variant="ghost"
            size="sm"
            className="ml-3"
            disabled={pending}
            data-testid="impersonation-stop"
            onClick={() =>
              void post('/api/admin/impersonation', { stopId: activeImpersonation.id })
            }
          >
            {t('impersonationStop')}
          </Button>
        </div>
      ) : null}

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="admin-metrics">
        {(
          [
            ['newCompanies', String(metrics.newCompaniesToday)],
            ['ordersToday', String(metrics.ordersToday)],
            ['gmvToday', `${money(metrics.gmvToday)} ₸`],
            ['gmvMonth', `${money(metrics.gmvMonth)} ₸`],
            ['activeStores', String(metrics.activeStores)],
            ['activeSuppliers', String(metrics.activeSuppliers)],
            ['conversion', `${metrics.conversion}%`],
            ['openDisputes', String(metrics.openDisputes)],
          ] as const
        ).map(([key, value]) => (
          <Card key={key} className="p-3 sm:p-4">
            <p className="text-muted-foreground text-xs font-semibold">{t(key)}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums" data-testid={`metric-${key}`}>
              {value}
            </p>
          </Card>
        ))}
      </section>

      {metrics.byCity.length > 0 ? (
        <Card className="mt-4">
          <CardTitle className="text-[15px]">{t('byCity')}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm" data-testid="admin-cities">
            {metrics.byCity.map((row) => (
              <li key={row.city} className="flex justify-between gap-3">
                <span>{row.city}</span>
                <span className="tabular-nums">
                  {row.orders} · {money(row.gmv)} ₸
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <section className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5">
        <h2 className="text-lg font-medium">{t('disputesTitle')}</h2>

        {disputes.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm" data-testid="disputes-empty">
            {t('disputesEmpty')}
          </p>
        ) : (
          <ul className="mt-3 space-y-3" data-testid="admin-disputes">
            {disputes.map((dispute) => (
              <li
                key={dispute.orderId}
                className="border-border flex flex-wrap items-end gap-3 border-b pb-3 last:border-0"
                data-testid={`dispute-${dispute.number}`}
              >
                <div className="min-w-48 flex-1">
                  <p className="text-[13px] font-bold tabular-nums">{dispute.number}</p>
                  <p className="text-sm break-words">
                    {dispute.storeName} — {dispute.supplierName}
                  </p>
                  <p className="text-muted-foreground text-xs break-words">
                    {t('disputeReason')}: {dispute.reason ?? '—'}
                  </p>
                </div>

                <Field label={t('resolution')}>
                  <select
                    className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                    value={disputeForm[dispute.orderId]?.resolution ?? 'AWAITING_PAYMENT'}
                    data-testid={`dispute-resolution-${dispute.number}`}
                    onChange={(event) =>
                      setDisputeForm((current) => ({
                        ...current,
                        [dispute.orderId]: {
                          resolution: event.target.value as DisputeResolution,
                          comment: current[dispute.orderId]?.comment ?? '',
                        },
                      }))
                    }
                  >
                    {(['AWAITING_PAYMENT', 'PAID', 'CANCELLED'] as const).map((value) => (
                      <option key={value} value={value}>
                        {t(`resolutions.${value}`)}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="min-w-40 flex-1">
                  <Field label={t('resolutionComment')}>
                    <Input
                      value={disputeForm[dispute.orderId]?.comment ?? ''}
                      data-testid={`dispute-comment-${dispute.number}`}
                      onChange={(event) =>
                        setDisputeForm((current) => ({
                          ...current,
                          [dispute.orderId]: {
                            resolution: current[dispute.orderId]?.resolution ?? 'AWAITING_PAYMENT',
                            comment: event.target.value,
                          },
                        }))
                      }
                    />
                  </Field>
                </div>

                <Button
                  size="sm"
                  disabled={pending}
                  data-testid={`dispute-resolve-${dispute.number}`}
                  onClick={() =>
                    void post('/api/admin/disputes', {
                      orderId: dispute.orderId,
                      resolution: disputeForm[dispute.orderId]?.resolution ?? 'AWAITING_PAYMENT',
                      comment: disputeForm[dispute.orderId]?.comment ?? '',
                    })
                  }
                >
                  {t('resolve')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5">
        <h2 className="text-lg font-medium">{t('queueTitle')}</h2>

        {queue.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm" data-testid="queue-empty">
            {t('queueEmpty')}
          </p>
        ) : (
          <ul className="mt-3 space-y-3" data-testid="moderation-queue">
            {queue.map((item) => (
              <li
                key={item.id}
                className="border-border flex flex-wrap items-end gap-3 border-b pb-3 last:border-0"
                data-testid={`queue-item-${item.id}`}
              >
                <div className="min-w-48 flex-1">
                  <p className="font-medium break-words">{item.companyName}</p>
                  <p className="text-muted-foreground text-[13px] font-bold tabular-nums">
                    {t('bin')}: {item.bin}
                  </p>
                  <p className="text-muted-foreground text-xs break-words">{item.legalAddress}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {item.fromRegistry ? null : (
                      <Badge tone="warning" data-testid={`queue-manual-${item.id}`}>
                        {t('notFromRegistry')}
                      </Badge>
                    )}
                    {item.status === 'APPROVED' ? (
                      <Badge tone="info">{t('autoApproved')}</Badge>
                    ) : null}
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold">
                      {tSoon('ecpCheck')}
                      <NotYetBadge />
                    </span>
                  </div>
                </div>

                <div className="min-w-40 flex-1">
                  <Field label={t('reason')}>
                    <Input
                      value={reasons[item.id] ?? ''}
                      data-testid={`queue-reason-${item.id}`}
                      onChange={(event) =>
                        setReasons((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                  </Field>
                </div>

                <Button
                  size="sm"
                  disabled={pending}
                  data-testid={`queue-approve-${item.id}`}
                  onClick={() => void post(`/api/admin/moderation/${item.id}`, { approve: true })}
                >
                  {t('approve')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  data-testid={`queue-reject-${item.id}`}
                  onClick={() =>
                    void post(`/api/admin/moderation/${item.id}`, {
                      approve: false,
                      reason: reasons[item.id] ?? '',
                    })
                  }
                >
                  {t('reject')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canImpersonate ? (
        <section className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5">
          <h2 className="text-lg font-medium">{t('impersonationTitle')}</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label={t('company')}>
              <select
                className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={impersonation.companyId}
                data-testid="impersonation-company"
                onChange={(event) =>
                  setImpersonation((current) => ({ ...current, companyId: event.target.value }))
                }
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="min-w-48 flex-1">
              <Field label={t('impersonationReason')}>
                <Input
                  value={impersonation.reason}
                  data-testid="impersonation-reason"
                  onChange={(event) =>
                    setImpersonation((current) => ({ ...current, reason: event.target.value }))
                  }
                />
              </Field>
            </div>
            <Button
              disabled={pending}
              data-testid="impersonation-start"
              onClick={() => void post('/api/admin/impersonation', impersonation)}
            >
              {t('impersonationStart')}
            </Button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p
          className="text-danger mt-3 text-sm font-semibold"
          role="alert"
          data-testid="admin-panel-error"
        >
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}

      {canBill ? (
        <section
          className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
          data-testid="tariffs"
        >
          <h2 className="text-lg font-medium">{t('tariffsTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-[13px] font-semibold">{t('tariffsHint')}</p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="px-2 py-2 font-medium">{t('plan')}</th>
                  <th className="px-2 py-2 font-medium">{t('planPrice')}</th>
                  <th className="px-2 py-2 font-medium">{t('planLimits')}</th>
                  <th className="px-2 py-2 font-medium">{t('planTrial')}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y" data-testid="plans-table">
                {plans.map((plan) => (
                  <tr key={plan.id} data-testid={`plan-${plan.code}`}>
                    <td className="px-2 py-2">{plan.code}</td>
                    <td className="px-2 py-2 tabular-nums">{money(plan.priceMonthly)} ₸</td>
                    <td className="px-2 py-2 text-xs">
                      {[plan.maxLocations, plan.maxEmployees, plan.maxProducts]
                        .map((value) => value ?? '∞')
                        .join(' · ')}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{plan.trialDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label={t('company')}>
              <select
                className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={subscriptionForm.companyId}
                data-testid="subscription-company"
                onChange={(event) =>
                  setSubscriptionForm((current) => ({ ...current, companyId: event.target.value }))
                }
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('plan')}>
              <select
                className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={subscriptionForm.planCode}
                data-testid="subscription-plan"
                onChange={(event) =>
                  setSubscriptionForm((current) => ({ ...current, planCode: event.target.value }))
                }
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.code}>
                    {plan.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('planMonths')}>
              <Input
                className="w-24"
                inputMode="numeric"
                value={subscriptionForm.months}
                data-testid="subscription-months"
                onChange={(event) =>
                  setSubscriptionForm((current) => ({ ...current, months: event.target.value }))
                }
              />
            </Field>
            <Button
              disabled={pending}
              data-testid="subscription-save"
              onClick={() =>
                void post('/api/admin/subscriptions', {
                  companyId: subscriptionForm.companyId,
                  planCode: subscriptionForm.planCode,
                  months: Number(subscriptionForm.months) || 0,
                })
              }
            >
              {t('planAssign')}
            </Button>
          </div>

          <ul className="mt-3 space-y-1 text-sm" data-testid="subscriptions">
            {subscriptions
              .filter((row) => row.planCode !== null)
              .map((row) => (
                <li key={row.companyId} className="flex flex-wrap justify-between gap-2">
                  <span className="break-words">{row.companyName}</span>
                  <span className="text-muted-foreground text-xs font-semibold">
                    {row.planCode} ·{' '}
                    {t(`subscriptionStatus.${row.status}` as 'subscriptionStatus.TRIAL')} ·{' '}
                    {money(row.amount ?? '0')} ₸
                  </span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section
        className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
        data-testid="reference"
      >
        <h2 className="text-lg font-medium">{t('referenceTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-[13px] font-semibold">{t('referenceHint')}</p>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          {(
            [
              ['vatRates', reference.vatRates],
              ['units', reference.units],
              ['categories', reference.categories],
              ['cities', reference.cities],
            ] as const
          ).map(([key, rows]) => (
            <div key={key}>
              <dt className="text-muted-foreground text-xs font-semibold">
                {t(`reference.${key}`)}
              </dt>
              <dd className="tabular-nums" data-testid={`reference-count-${key}`}>
                {rows.length}
              </dd>
            </div>
          ))}
        </dl>

        {canEditReference ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label={t('referenceKind')}>
              <select
                className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={referenceForm.kind}
                data-testid="reference-kind"
                onChange={(event) =>
                  setReferenceForm((current) => ({
                    ...current,
                    kind: event.target.value as ReferenceKind,
                  }))
                }
              >
                {(['vatRate', 'unit', 'category'] as const).map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`referenceKinds.${kind}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('referenceCode')}>
              <Input
                className="w-28"
                value={referenceForm.code}
                data-testid="reference-code"
                onChange={(event) =>
                  setReferenceForm((current) => ({ ...current, code: event.target.value }))
                }
              />
            </Field>
            <Field label={t('nameRu')}>
              <Input
                value={referenceForm.nameRu}
                data-testid="reference-name-ru"
                onChange={(event) =>
                  setReferenceForm((current) => ({ ...current, nameRu: event.target.value }))
                }
              />
            </Field>
            <Field label={t('nameKk')}>
              <Input
                value={referenceForm.nameKk}
                data-testid="reference-name-kk"
                onChange={(event) =>
                  setReferenceForm((current) => ({ ...current, nameKk: event.target.value }))
                }
              />
            </Field>
            {referenceForm.kind === 'vatRate' ? (
              <Field label={t('referenceRate')}>
                <Input
                  className="w-24"
                  inputMode="decimal"
                  value={referenceForm.rate}
                  data-testid="reference-rate"
                  onChange={(event) =>
                    setReferenceForm((current) => ({ ...current, rate: event.target.value }))
                  }
                />
              </Field>
            ) : null}
            <Button
              disabled={pending}
              data-testid="reference-save"
              onClick={() => void post('/api/admin/reference', referenceForm)}
            >
              {t('referenceSave')}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="text-[15px] font-extrabold">{t('auditTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('auditHint')}</p>

        {audit.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">{t('auditEmpty')}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm" data-testid="admin-audit">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2">
                <span className="break-words">
                  {t(`actions.${entry.action}` as 'actions.admin_signed_in')}
                  {entry.reason ? ` — ${entry.reason}` : ''}
                </span>
                <span className="text-muted-foreground text-xs font-semibold">
                  {entry.admin}, {entry.createdAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
