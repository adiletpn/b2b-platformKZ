'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  FileSpreadsheet,
  LifeBuoy,
  Megaphone,
  Plug,
  Search,
  SlidersHorizontal,
  UserCog,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { LucideIcon } from 'lucide-react';
import type { UserRow } from '@/lib/admin/users';
import type { TicketRow, TicketView } from '@/lib/support/tickets';

function Header({ icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <IconBadge icon={icon} />
      <div>
        <CardTitle>{title}</CardTitle>
        <CardHint>{hint}</CardHint>
      </div>
    </div>
  );
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => ({}))) as Record<string, unknown> & { status?: string };
}

/** Пользователи: поиск по телефону и ФИО, сброс сессий, блокировка (раздел 3.13 ТЗ). */
export function UsersPanel() {
  const t = useTranslations('admin.users');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function search() {
    const response = await fetch(`/api/admin/users?q=${encodeURIComponent(query)}`);
    if (response.ok) setUsers(((await response.json()) as { users: UserRow[] }).users);
  }

  async function act(userId: string, action: 'reset' | 'block' | 'unblock') {
    const data = await postJson('/api/admin/users', {
      userId,
      action,
      reason: reasons[userId] ?? '',
    });
    setMessage(data.status === 'ok' ? `done.${action}` : `errors.${data.status ?? 'unknown'}`);
    if (data.status === 'ok') await search();
  }

  return (
    <Card data-testid="admin-users">
      <Header icon={UserCog} title={t('title')} hint={t('hint')} />
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Input
          value={query}
          placeholder={t('search')}
          data-testid="admin-users-query"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          aria-label={t('find')}
          data-testid="admin-users-find"
        >
          <Search aria-hidden />
        </Button>
      </form>
      {users && users.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('notFound')}</p>
      ) : null}
      <ul className="divide-border mt-2 divide-y text-sm" data-testid="admin-users-list">
        {(users ?? []).map((user) => (
          <li key={user.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums">{user.phone}</span>
              {user.name ? <span>{user.name}</span> : null}
              {user.blocked ? <Badge tone="danger">{t('blocked')}</Badge> : null}
              <span className="text-muted-foreground text-xs">
                {t('sessions', { count: user.sessions })}
              </span>
            </div>
            <ul className="text-muted-foreground text-xs">
              {user.companies.map((company) => (
                <li key={`${company.name}-${company.role}`}>
                  {company.name} · {company.role} · {company.status}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void act(user.id, 'reset')}>
                {t('reset')}
              </Button>
              {user.blocked ? (
                <Button variant="outline" size="sm" onClick={() => void act(user.id, 'unblock')}>
                  {t('unblock')}
                </Button>
              ) : (
                <>
                  <Input
                    className="h-9 w-48"
                    placeholder={t('reason')}
                    value={reasons[user.id] ?? ''}
                    data-testid="admin-user-reason"
                    onChange={(event) => setReasons({ ...reasons, [user.id]: event.target.value })}
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    data-testid="admin-user-block"
                    onClick={() => void act(user.id, 'block')}
                  >
                    {t('block')}
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {message ? (
        <p className="mt-2 text-sm" role="status" data-testid="admin-users-message">
          {t(message as 'done.reset')}
        </p>
      ) : null}
    </Card>
  );
}

const TICKET_TONES = { OPEN: 'warning', IN_PROGRESS: 'info', CLOSED: 'success' } as const;

/** Обращения в поддержку: ответственный, статус, переписка (раздел 3.13 ТЗ). */
export function TicketsPanel({ initial }: { initial: TicketRow[] }) {
  const t = useTranslations('admin.tickets');
  const tStatus = useTranslations('support.status');
  const [tickets, setTickets] = useState(initial);
  const [open, setOpen] = useState<TicketView | null>(null);
  const [reply, setReply] = useState('');

  async function reload() {
    const response = await fetch('/api/admin/tickets');
    if (response.ok) setTickets(((await response.json()) as { tickets: TicketRow[] }).tickets);
  }
  async function show(id: string) {
    const response = await fetch(`/api/admin/tickets/${id}`);
    if (response.ok) setOpen(((await response.json()) as { ticket: TicketView }).ticket);
  }
  async function act(body: Record<string, unknown>) {
    if (!open) return;
    const data = await postJson('/api/admin/tickets', { id: open.id, ...body });
    if (data.status === 'ok') {
      setReply('');
      await show(open.id);
      await reload();
    }
  }

  return (
    <Card data-testid="admin-tickets">
      <Header icon={LifeBuoy} title={t('title')} hint={t('hint')} />
      {tickets.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('empty')}</p>
      ) : null}
      <ul className="divide-border mt-2 divide-y text-sm">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <button
              type="button"
              className="hover:bg-muted/60 flex w-full flex-wrap items-center gap-2 py-2 text-left"
              data-testid="admin-ticket"
              onClick={() => void show(ticket.id)}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{ticket.subject}</span>
              <span className="text-muted-foreground text-xs">{ticket.companyName}</span>
              <Badge tone={TICKET_TONES[ticket.status]}>{tStatus(ticket.status)}</Badge>
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <div
          className="border-border mt-3 space-y-2 rounded-2xl border p-3"
          data-testid="admin-ticket-thread"
        >
          <p className="font-medium">{open.subject}</p>
          <p className="text-muted-foreground text-xs">
            {open.companyName} · {open.assignee ?? t('unassigned')}
          </p>
          <ul className="space-y-1.5 text-sm">
            {open.messages.map((message) => (
              <li key={message.id} className={message.fromAdmin ? 'text-primary' : ''}>
                <span className="text-muted-foreground text-xs">{message.createdAt} · </span>
                {message.text}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Input
              className="h-9 min-w-0 flex-1"
              value={reply}
              placeholder={t('reply')}
              data-testid="admin-ticket-reply"
              onChange={(event) => setReply(event.target.value)}
            />
            <Button size="sm" data-testid="admin-ticket-send" onClick={() => void act({ reply })}>
              {t('send')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void act({ assignToMe: true })}>
              {t('assign')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void act({ status: 'CLOSED' })}>
              {t('close')}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** Отчёты в Excel: компании, заявки, обороты по городам (раздел 3.13 ТЗ). */
export function ReportsPanel() {
  const t = useTranslations('admin.reports');
  const locale = useLocale();
  const [period, setPeriod] = useState(() => {
    const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
    return { from: `${today.slice(0, 8)}01`, to: today };
  });
  return (
    <Card data-testid="admin-reports">
      <Header icon={FileSpreadsheet} title={t('title')} hint={t('hint')} />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-sm">
        <Field label={t('from')}>
          <Input
            type="date"
            value={period.from}
            onChange={(event) => setPeriod({ ...period, from: event.target.value })}
          />
        </Field>
        <Field label={t('to')}>
          <Input
            type="date"
            value={period.to}
            onChange={(event) => setPeriod({ ...period, to: event.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['companies', 'orders', 'cities'] as const).map((kind) => (
          <a
            key={kind}
            href={`/api/admin/reports?kind=${kind}&from=${period.from}&to=${period.to}&locale=${locale}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid={`admin-report-${kind}`}
          >
            {t(`kinds.${kind}`)}
          </a>
        ))}
      </div>
    </Card>
  );
}

/** Рассылка по сегменту: город, тип компании, тариф (раздел 3.13 ТЗ). */
export function BroadcastPanel({
  cities,
  plans,
}: {
  cities: { id: string; name: string }[];
  plans: { code: string; name: string }[];
}) {
  const t = useTranslations('admin.broadcast');
  const tType = useTranslations('companyType');
  const [form, setForm] = useState({ text: '', cityId: '', type: '', planCode: '' });
  const [result, setResult] = useState<string | null>(null);

  async function send() {
    const data = await postJson('/api/admin/broadcasts', form);
    setResult(
      data.status === 'ok' ? t('sent', { count: Number(data.recipients ?? 0) }) : t('invalid'),
    );
    if (data.status === 'ok') setForm({ ...form, text: '' });
  }

  const select =
    'border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium';
  return (
    <Card data-testid="admin-broadcast">
      <Header icon={Megaphone} title={t('title')} hint={t('hint')} />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('city')}>
          <select
            className={select}
            value={form.cityId}
            onChange={(event) => setForm({ ...form, cityId: event.target.value })}
          >
            <option value="">{t('any')}</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('type')}>
          <select
            className={select}
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value })}
          >
            <option value="">{t('any')}</option>
            {(['STORE', 'SUPPLIER', 'BOTH'] as const).map((type) => (
              <option key={type} value={type}>
                {tType(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('plan')}>
          <select
            className={select}
            value={form.planCode}
            onChange={(event) => setForm({ ...form, planCode: event.target.value })}
          >
            <option value="">{t('any')}</option>
            {plans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t('text')}>
          <textarea
            className="border-border bg-card min-h-20 w-full rounded-[14px] border-[1.5px] p-3.5 text-base font-medium"
            value={form.text}
            data-testid="admin-broadcast-text"
            onChange={(event) => setForm({ ...form, text: event.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button data-testid="admin-broadcast-send" onClick={() => void send()}>
          {t('send')}
        </Button>
        {result ? (
          <span className="text-sm" role="status" data-testid="admin-broadcast-result">
            {result}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/** Интеграции: какие сервисы на боевых ключах, какие — моки (раздел 3.13 ТЗ). */
/** Флаги платформы, которые суперадмин переключает сам (раздел 3.13 ТЗ). */
export function PlatformFlagsPanel({ initial }: { initial: Record<string, boolean> }) {
  const t = useTranslations('admin.flags');
  const [flags, setFlags] = useState(initial);
  const [failed, setFailed] = useState(false);

  async function toggle(key: string, value: boolean) {
    setFailed(false);
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, value: String(value) }),
    });
    if (!response.ok) {
      setFailed(true);
      return;
    }
    setFlags((current) => ({ ...current, [key]: value }));
  }

  return (
    <Card data-testid="admin-flags">
      <Header icon={SlidersHorizontal} title={t('title')} hint={t('hint')} />
      <ul className="divide-border mt-3 divide-y text-sm">
        {Object.entries(flags).map(([key, value]) => (
          <li key={key} className="py-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={value}
                data-testid={`flag-${key}`}
                onChange={(event) => void toggle(key, event.target.checked)}
              />
              <span>
                <span className="font-medium">
                  {t(`items.${key}.title` as 'items.hide_demo_companies.title')}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {t(`items.${key}.hint` as 'items.hide_demo_companies.hint')}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {failed ? (
        <p className="text-danger mt-2 text-sm" role="alert">
          {t('failed')}
        </p>
      ) : null}
    </Card>
  );
}

export function IntegrationsPanel({
  rows,
}: {
  rows: { key: string; env: string; live: boolean }[];
}) {
  const t = useTranslations('admin.integrations');
  return (
    <Card data-testid="admin-integrations">
      <Header icon={Plug} title={t('title')} hint={t('hint')} />
      <ul className="divide-border mt-3 divide-y text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{t(`items.${row.key}` as 'items.sms')}</span>
            <span className="flex items-center gap-2">
              <code className="text-muted-foreground text-xs">{row.env}</code>
              <Badge tone={row.live ? 'success' : 'neutral'}>
                {row.live ? t('live') : t('mock')}
              </Badge>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
