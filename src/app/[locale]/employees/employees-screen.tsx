'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';

type Employee = { id: string; phone: string; role: string; status: 'ACTIVE' | 'BLOCKED' };
type Invitation = { id: string; phone: string; role: string; expiresAt: string };
type AuditEntry = { id: string; action: string; createdAt: string };

export function EmployeesScreen({
  roles,
  employees,
  invitations,
  audit,
}: {
  roles: string[];
  employees: Employee[];
  invitations: Invitation[];
  audit: AuditEntry[];
}) {
  const t = useTranslations('employees');
  const tDashboard = useTranslations('dashboard');
  const router = useRouter();

  const [phone, setPhone] = useState('+7');
  const [role, setRole] = useState(roles.find((code) => code !== 'OWNER') ?? 'CASHIER');
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);
  const [pending, setPending] = useState(false);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setInvited(false);

    const response = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, role }),
    });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(data.status ?? data.error ?? 'unknown');
      return;
    }
    setInvited(true);
    setPhone('+7');
    router.refresh();
  }

  async function toggleBlock(employee: Employee) {
    const response = await fetch(`/api/employees/${employee.id}/block`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blocked: employee.status === 'ACTIVE' }),
    });
    const data = (await response.json()) as { status?: string };
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {tDashboard('title')}
        </Link>
      </header>
      <p className="text-muted-foreground mt-2 text-sm">{t('hint')}</p>

      <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={invite}>
        <div className="min-w-48 flex-1">
          <Field label={t('phone')}>
            <Input
              inputMode="tel"
              value={phone}
              data-testid="invite-phone"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
        </div>
        <Field label={t('role')}>
          <select
            className="border-border bg-card h-11 rounded-lg border px-3"
            value={role}
            data-testid="invite-role"
            onChange={(event) => setRole(event.target.value)}
          >
            {roles
              .filter((code) => code !== 'OWNER')
              .map((code) => (
                <option key={code} value={code}>
                  {t(`roles.${code}` as 'roles.CASHIER')}
                </option>
              ))}
          </select>
        </Field>
        <Button type="submit" disabled={pending} data-testid="invite-employee">
          {pending ? t('inviting') : t('invite')}
        </Button>
      </form>

      {invited ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="invite-sent">
          {t('invited')}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert" data-testid="employees-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}

      <section className="border-border bg-card mt-5 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('phone')}</th>
              <th className="px-3 py-2 font-medium">{t('role')}</th>
              <th className="px-3 py-2 font-medium">{t('statusLabel')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y" data-testid="employees-table">
            {employees.map((employee) => (
              <tr key={employee.id} data-testid={`employee-${employee.id}`}>
                <td className="px-3 py-2 font-mono text-xs">{employee.phone}</td>
                <td className="px-3 py-2">{t(`roles.${employee.role}` as 'roles.CASHIER')}</td>
                <td className="px-3 py-2" data-testid={`employee-status-${employee.id}`}>
                  {t(`statuses.${employee.status}`)}
                </td>
                <td className="px-3 py-2 text-right">
                  {employee.role === 'OWNER' ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid={`employee-toggle-${employee.id}`}
                      onClick={() => void toggleBlock(employee)}
                    >
                      {employee.status === 'ACTIVE' ? t('block') : t('unblock')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {invitations.length > 0 ? (
        <section className="border-border mt-4 rounded-lg border border-dashed p-4">
          <h2 className="text-muted-foreground text-sm font-medium">{t('pending')}</h2>
          <ul className="mt-2 space-y-1 text-sm" data-testid="invitations">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap justify-between gap-2">
                <span className="font-mono text-xs">{invitation.phone}</span>
                <span>{t(`roles.${invitation.role}` as 'roles.CASHIER')}</span>
                <span className="text-muted-foreground text-xs">
                  {t('expires')}: {invitation.expiresAt}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-muted-foreground text-sm font-medium">{t('auditTitle')}</h2>
        {audit.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">{t('auditEmpty')}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm" data-testid="audit-log">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2">
                <span>{t(`actions.${entry.action}` as 'actions.employee_invited')}</span>
                <span className="text-muted-foreground text-xs">{entry.createdAt}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
