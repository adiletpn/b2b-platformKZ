'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Page, PageHeader } from '@/components/ui/page';
import { PERMISSION_ACTIONS, PERMISSION_SECTIONS } from '@/lib/employees/permission-matrix';
import { money } from '@/lib/format';

type Role = { id: string; code: string; name: string; isTemplate: boolean };
type Location = { id: string; address: string };
type Employee = {
  id: string;
  phone: string;
  role: string;
  roleId: string | null;
  status: 'ACTIVE' | 'BLOCKED';
  allowedLocationIds: string[];
  orderLimit: string;
  maxDiscount: string;
};
type Invitation = { id: string; phone: string; role: string; expiresAt: string };
type Company = { id: string; name: string; active: boolean };
type AuditEntry = { id: string; action: string; actorPhone: string; createdAt: string };

type Cell = { section: string; action: string };

export function EmployeesScreen({
  roles,
  locations,
  employees,
  invitations,
  audit,
  companies,
  isOwner,
}: {
  roles: Role[];
  locations: Location[];
  employees: Employee[];
  invitations: Invitation[];
  audit: AuditEntry[];
  companies: Company[];
  isOwner: boolean;
}) {
  const t = useTranslations('employees');
  const router = useRouter();

  const [phone, setPhone] = useState('+7');
  const [role, setRole] = useState(
    roles.find((item) => item.isTemplate && item.code !== 'OWNER')?.code ?? 'CASHIER',
  );
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);
  const [pending, setPending] = useState(false);

  const [roleNameRu, setRoleNameRu] = useState('');
  const [roleNameKk, setRoleNameKk] = useState('');
  const [cells, setCells] = useState<Cell[]>([]);
  const [roleCreated, setRoleCreated] = useState(false);

  const [transfer, setTransfer] = useState<{ id: string; code: string } | null>(null);
  const [transferTo, setTransferTo] = useState('');
  const [transferCode, setTransferCode] = useState('');
  const [transferred, setTransferred] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [accessSaved, setAccessSaved] = useState(false);
  const [actor, setActor] = useState('');

  function roleLabel(code: string) {
    const found = roles.find((item) => item.code === code);
    if (found) return found.name;
    return t(`roles.${code}` as 'roles.CASHIER');
  }

  async function send(url: string, body: unknown, method = 'POST', refresh = true) {
    setPending(true);
    setError(null);
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { status?: string; error?: string };
    setPending(false);
    if (data.status !== 'ok') {
      setError(data.status ?? data.error ?? 'unknown');
      return false;
    }
    if (refresh) router.refresh();
    return true;
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setInvited(false);
    if (await send('/api/employees', { phone, role })) {
      setInvited(true);
      setPhone('+7');
    }
  }

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    setRoleCreated(false);
    const ok = await send('/api/employees/roles', {
      nameRu: roleNameRu,
      nameKk: roleNameKk,
      permissions: cells,
    });
    if (ok) {
      setRoleCreated(true);
      setRoleNameRu('');
      setRoleNameKk('');
      setCells([]);
    }
  }

  function toggleCell(section: string, action: string) {
    setCells((current) =>
      current.some((cell) => cell.section === section && cell.action === action)
        ? current.filter((cell) => !(cell.section === section && cell.action === action))
        : [...current, { section, action }],
    );
  }

  async function requestTransfer() {
    setTransferred(false);
    setError(null);
    const response = await fetch('/api/company/owner', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ membershipId: transferTo }),
    });
    const data = (await response.json()) as { status?: string; transferId?: string; code?: string };
    if (data.status !== 'ok' || !data.transferId) {
      setError(data.status ?? 'unknown');
      return;
    }
    // У мока SMS код приходит в ответе и показывается на экране.
    setTransfer({ id: data.transferId, code: data.code ?? '' });
  }

  async function confirmTransfer() {
    if (!transfer) return;
    // Без обновления: прежний Владелец теряет доступ к экрану, а итог должен остаться виден.
    const ok = await send(
      '/api/company/owner',
      { transferId: transfer.id, code: transferCode },
      'POST',
      false,
    );
    if (ok) {
      setTransfer(null);
      setTransferCode('');
      setTransferred(true);
    }
  }

  async function switchCompany(companyId: string) {
    if (await send('/api/company/switch', { companyId })) router.refresh();
  }

  async function toggleBlock(employee: Employee) {
    await send(`/api/employees/${employee.id}/block`, { blocked: employee.status === 'ACTIVE' });
  }

  async function saveAccess(employee: Employee, form: FormData) {
    setAccessSaved(false);
    const ok = await send(
      `/api/employees/${employee.id}/access`,
      {
        roleId: String(form.get('roleId') ?? '') || null,
        allowedLocationIds: locations
          .map((location) => location.id)
          .filter((id) => form.get(`location-${id}`) === 'on'),
        orderLimit: String(form.get('orderLimit') ?? ''),
        maxDiscount: String(form.get('maxDiscount') ?? ''),
      },
      'PUT',
    );
    if (ok) {
      setAccessSaved(true);
      setEditing(null);
    }
  }

  const visibleAudit = actor
    ? audit.filter((entry) => entry.actorPhone.includes(actor))
    : audit.slice(0, 20);

  return (
    <Page width="md">
      <PageHeader title={t('title')} description={t('hint')} />

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
            className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
            value={role}
            data-testid="invite-role"
            onChange={(event) => setRole(event.target.value)}
          >
            {roles
              .filter((item) => item.code !== 'OWNER')
              .map((item) => (
                <option key={item.id} value={item.code}>
                  {item.name}
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
      {transferred ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="transfer-done">
          {t('ownerTransferDone')}
        </p>
      ) : null}
      {accessSaved ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="access-saved">
          {t('accessSaved')}
        </p>
      ) : null}
      {roleCreated ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="role-created">
          {t('roleCreated')}
        </p>
      ) : null}
      {error ? (
        <p
          className="text-danger mt-2 text-sm font-semibold"
          role="alert"
          data-testid="employees-error"
        >
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}

      <section className="border-border bg-card shadow-card mt-5 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('phone')}</th>
              <th className="px-3 py-2 font-medium">{t('role')}</th>
              <th className="px-3 py-2 font-medium">{t('orderLimit')}</th>
              <th className="px-3 py-2 font-medium">{t('statusLabel')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y" data-testid="employees-table">
            {employees.map((employee) => (
              <tr key={employee.id} data-testid={`employee-${employee.id}`}>
                <td className="px-3 py-2 text-[13px] font-bold tabular-nums">{employee.phone}</td>
                <td className="px-3 py-2">{roleLabel(employee.role)}</td>
                <td
                  className="px-3 py-2 tabular-nums"
                  data-testid={`employee-limit-${employee.id}`}
                >
                  {employee.orderLimit ? `${money(employee.orderLimit)} ₸` : t('noLimit')}
                </td>
                <td className="px-3 py-2" data-testid={`employee-status-${employee.id}`}>
                  {t(`statuses.${employee.status}`)}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {employee.role === 'OWNER' ? null : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`employee-access-${employee.id}`}
                        onClick={() => setEditing(editing === employee.id ? null : employee.id)}
                      >
                        {t('accessTitle')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`employee-toggle-${employee.id}`}
                        onClick={() => void toggleBlock(employee)}
                      >
                        {employee.status === 'ACTIVE' ? t('block') : t('unblock')}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {employees
        .filter((employee) => employee.id === editing)
        .map((employee) => (
          <form
            key={employee.id}
            className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
            data-testid="access-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAccess(employee, new FormData(event.currentTarget));
            }}
          >
            <h2 className="text-lg font-medium">{t('accessTitle')}</h2>
            <p className="text-muted-foreground mt-1 text-[13px] font-semibold">
              {t('employee')}: {employee.phone} · {t('accessHint')}
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label={t('role')}>
                <select
                  name="roleId"
                  className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                  defaultValue={employee.roleId ?? ''}
                  data-testid="access-role"
                >
                  <option value="">{roleLabel(employee.role)}</option>
                  {roles
                    .filter((item) => !item.isTemplate)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={t('orderLimit')}>
                <Input
                  name="orderLimit"
                  inputMode="decimal"
                  defaultValue={employee.orderLimit}
                  data-testid="access-order-limit"
                />
              </Field>
              <Field label={t('maxDiscount')}>
                <Input
                  name="maxDiscount"
                  inputMode="decimal"
                  defaultValue={employee.maxDiscount}
                  data-testid="access-max-discount"
                />
              </Field>
            </div>

            {locations.length > 0 ? (
              <fieldset className="mt-3">
                <legend className="text-muted-foreground text-sm font-medium">
                  {t('allowedLocations')}
                </legend>
                <p className="text-muted-foreground text-xs font-semibold">{t('allLocations')}</p>
                <div className="mt-2 space-y-1">
                  {locations.map((location) => (
                    <label key={location.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={`location-${location.id}`}
                        defaultChecked={employee.allowedLocationIds.includes(location.id)}
                        data-testid={`access-location-${location.id}`}
                      />
                      <span>{location.address}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <Button type="submit" className="mt-4" disabled={pending} data-testid="access-save">
              {t('saveAccess')}
            </Button>
          </form>
        ))}

      {isOwner && employees.some((employee) => employee.role !== 'OWNER') ? (
        <section
          className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
          data-testid="owner-transfer"
        >
          <h2 className="text-lg font-medium">{t('ownerTransferTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-[13px] font-semibold">
            {t('ownerTransferHint')}
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label={t('employee')}>
              <select
                className="border-border bg-card h-11 rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={transferTo}
                data-testid="transfer-employee"
                onChange={(event) => setTransferTo(event.target.value)}
              >
                <option value="">—</option>
                {employees
                  .filter((employee) => employee.role !== 'OWNER' && employee.status === 'ACTIVE')
                  .map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.phone}
                    </option>
                  ))}
              </select>
            </Field>
            <Button
              variant="outline"
              disabled={pending || !transferTo}
              data-testid="transfer-request"
              onClick={() => void requestTransfer()}
            >
              {t('ownerTransferRequest')}
            </Button>
          </div>

          {transfer ? (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <p className="text-muted-foreground text-sm font-medium">
                {transfer.code ? (
                  <>
                    {t('ownerTransferDemoCode')}:{' '}
                    <span className="tabular-nums" data-testid="transfer-demo-code">
                      {transfer.code}
                    </span>
                  </>
                ) : (
                  t('ownerTransferSmsSent')
                )}
              </p>
              <Field label={t('ownerTransferCode')}>
                <Input
                  inputMode="numeric"
                  value={transferCode}
                  data-testid="transfer-code"
                  onChange={(event) => setTransferCode(event.target.value)}
                />
              </Field>
              <Button
                disabled={pending}
                data-testid="transfer-confirm"
                onClick={() => void confirmTransfer()}
              >
                {t('ownerTransferConfirm')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {companies.length > 1 ? (
        <section className="border-border mt-4 rounded-2xl border-[1.5px] border-dashed p-4">
          <h2 className="text-[15px] font-extrabold">{t('companySwitchTitle')}</h2>
          <ul className="mt-2 space-y-1 text-sm" data-testid="my-companies">
            {companies.map((company) => (
              <li key={company.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-words">{company.name}</span>
                {company.active ? (
                  <span className="text-muted-foreground text-xs font-semibold">
                    {t('companyActive')}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`switch-company-${company.id}`}
                    onClick={() => void switchCompany(company.id)}
                  >
                    {t('companySwitch')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5"
        onSubmit={createRole}
      >
        <h2 className="text-lg font-medium">{t('customRoleTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-[13px] font-semibold">
          {t('customRoleHint')}
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-44 flex-1">
            <Field label={t('roleNameRu')}>
              <Input
                value={roleNameRu}
                data-testid="role-name-ru"
                onChange={(event) => setRoleNameRu(event.target.value)}
              />
            </Field>
          </div>
          <div className="min-w-44 flex-1">
            <Field label={t('roleNameKk')}>
              <Input
                value={roleNameKk}
                data-testid="role-name-kk"
                onChange={(event) => setRoleNameKk(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="px-2 py-2 font-medium">{t('section')}</th>
                {PERMISSION_ACTIONS.map((action) => (
                  <th key={action} className="px-2 py-2 font-medium">
                    {t(`permissionActions.${action}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border divide-y" data-testid="permission-matrix">
              {PERMISSION_SECTIONS.map((section) => (
                <tr key={section}>
                  <td className="px-2 py-2">{t(`sections.${section}`)}</td>
                  {PERMISSION_ACTIONS.map((action) => (
                    <td key={action} className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={`${t(`sections.${section}`)} ${t(`permissionActions.${action}`)}`}
                        data-testid={`cell-${section}-${action}`}
                        checked={cells.some(
                          (cell) => cell.section === section && cell.action === action,
                        )}
                        onChange={() => toggleCell(section, action)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button type="submit" className="mt-4" disabled={pending} data-testid="create-role">
          {pending ? t('creatingRole') : t('createRole')}
        </Button>
      </form>

      {invitations.length > 0 ? (
        <section className="border-border mt-4 rounded-2xl border-[1.5px] border-dashed p-4">
          <h2 className="text-[15px] font-extrabold">{t('pending')}</h2>
          <ul className="mt-2 space-y-1 text-sm" data-testid="invitations">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-[13px] font-bold tabular-nums">{invitation.phone}</span>
                <span>{roleLabel(invitation.role)}</span>
                <span className="text-muted-foreground text-xs font-semibold">
                  {t('expires')}: {invitation.expiresAt}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="border-border bg-card shadow-card mt-6 rounded-xl border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('auditTitle')}</h2>
          <Input
            value={actor}
            className="h-9 w-full sm:w-56"
            placeholder={t('employee')}
            aria-label={t('employee')}
            data-testid="audit-filter"
            onChange={(event) => setActor(event.target.value)}
          />
        </div>
        {visibleAudit.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">{t('auditEmpty')}</p>
        ) : (
          <ul className="divide-border mt-3 divide-y text-sm" data-testid="audit-log">
            {visibleAudit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{t(`actions.${entry.action}` as 'actions.employee_invited')}</span>
                <span className="text-muted-foreground text-[13px] font-bold tabular-nums">
                  {entry.actorPhone}
                </span>
                <span className="text-muted-foreground text-xs font-semibold">
                  {entry.createdAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
