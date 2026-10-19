'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

type QueueItem = { id: string; companyName: string; bin: string };
type AuditItem = {
  id: string;
  action: string;
  admin: string;
  reason: string | null;
  createdAt: string;
};

export function AdminPanel({
  role,
  queue,
  audit,
  companies,
  activeImpersonation,
}: {
  role: string;
  queue: QueueItem[];
  audit: AuditItem[];
  companies: { id: string; name: string }[];
  activeImpersonation: { id: string; companyName: string } | null;
}) {
  const t = useTranslations('admin');
  const router = useRouter();

  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [impersonation, setImpersonation] = useState({
    companyId: companies[0]?.id ?? '',
    reason: '',
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

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
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
          className="mt-4 rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
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

      <section className="border-border bg-card mt-5 rounded-lg border p-4">
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
                  <p className="text-muted-foreground font-mono text-xs">
                    {t('bin')}: {item.bin}
                  </p>
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
        <section className="border-border bg-card mt-4 rounded-lg border p-4">
          <h2 className="text-lg font-medium">{t('impersonationTitle')}</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label={t('company')}>
              <select
                className="border-border bg-card h-11 rounded-lg border px-3"
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
        <p className="mt-3 text-sm text-red-600" role="alert" data-testid="admin-panel-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}

      <section className="mt-6">
        <h2 className="text-muted-foreground text-sm font-medium">{t('auditTitle')}</h2>
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
                <span className="text-muted-foreground text-xs">
                  {entry.admin}, {entry.createdAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
