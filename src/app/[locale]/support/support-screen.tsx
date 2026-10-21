'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LifeBuoy, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import type { TicketRow, TicketView } from '@/lib/support/tickets';

const TONES = { OPEN: 'warning', IN_PROGRESS: 'info', CLOSED: 'success' } as const;

/** Обращения в поддержку платформы (раздел 3.13 ТЗ): тема, переписка, статус. */
export function SupportScreen({ initial }: { initial: TicketRow[] }) {
  const t = useTranslations('support');
  const [tickets, setTickets] = useState(initial);
  const [form, setForm] = useState({ subject: '', text: '' });
  const [open, setOpen] = useState<TicketView | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function reload() {
    const response = await fetch('/api/support');
    if (response.ok) setTickets(((await response.json()) as { tickets: TicketRow[] }).tickets);
  }

  async function show(id: string) {
    const response = await fetch(`/api/support/${id}`);
    if (response.ok) setOpen(((await response.json()) as { ticket: TicketView }).ticket);
  }

  async function create() {
    setPending(true);
    const response = await fetch('/api/support', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = (await response.json()) as { status?: string; id?: string };
    setPending(false);
    if (data.status !== 'ok') {
      setError('invalid');
      return;
    }
    setError(null);
    setForm({ subject: '', text: '' });
    await reload();
    await show(data.id!);
  }

  async function send() {
    if (!open) return;
    setPending(true);
    const response = await fetch(`/api/support/${open.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: reply }),
    });
    setPending(false);
    if (!response.ok) {
      setError('invalid');
      return;
    }
    setReply('');
    setError(null);
    await show(open.id);
    await reload();
  }

  return (
    <Page width="lg">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card data-testid="support-new">
            <div className="flex items-start gap-3">
              <IconBadge icon={LifeBuoy} />
              <div>
                <CardTitle>{t('newTitle')}</CardTitle>
                <CardHint>{t('newHint')}</CardHint>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              <Field label={t('subject')}>
                <Input
                  value={form.subject}
                  data-testid="support-subject"
                  onChange={(event) => setForm({ ...form, subject: event.target.value })}
                />
              </Field>
              <Field label={t('text')}>
                <textarea
                  className="border-border bg-card focus-visible:border-primary min-h-28 w-full rounded-2xl border p-3 text-base outline-none"
                  value={form.text}
                  data-testid="support-text"
                  onChange={(event) => setForm({ ...form, text: event.target.value })}
                />
              </Field>
              <Button disabled={pending} data-testid="support-create" onClick={() => void create()}>
                {t('create')}
              </Button>
            </div>
          </Card>

          {tickets.length === 0 ? (
            <EmptyState>{t('empty')}</EmptyState>
          ) : (
            <Card className="p-0">
              <ul className="divide-border divide-y" data-testid="support-list">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      className={cn(
                        'hover:bg-muted/60 w-full px-4 py-3 text-left',
                        open?.id === ticket.id && 'bg-primary-soft/60',
                      )}
                      onClick={() => void show(ticket.id)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{ticket.subject}</span>
                        <Badge tone={TONES[ticket.status]}>{t(`status.${ticket.status}`)}</Badge>
                      </span>
                      <span className="text-muted-foreground text-xs">{ticket.updatedAt}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card className="flex min-h-80 flex-col" data-testid="support-thread">
          {open ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="break-words">{open.subject}</CardTitle>
                <Badge tone={TONES[open.status]} data-testid="support-status">
                  {t(`status.${open.status}`)}
                </Badge>
              </div>
              <ul className="mt-4 flex-1 space-y-2">
                {open.messages.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words',
                      message.fromAdmin ? 'bg-muted' : 'bg-primary text-primary-foreground ml-auto',
                    )}
                    data-testid={message.fromAdmin ? 'support-answer' : 'support-question'}
                  >
                    {message.fromAdmin ? (
                      <span className="text-muted-foreground mb-0.5 block text-[0.7rem]">
                        {t('platform')}
                      </span>
                    ) : null}
                    {message.text}
                    <span className="mt-0.5 block text-[0.65rem] opacity-70">
                      {message.createdAt}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Input
                  value={reply}
                  placeholder={t('reply')}
                  data-testid="support-reply"
                  onChange={(event) => setReply(event.target.value)}
                />
                <Button disabled={pending} aria-label={t('send')} onClick={() => void send()}>
                  <Send aria-hidden />
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t('select')}</p>
          )}
          {error ? (
            <p className="text-danger mt-2 text-sm" role="alert">
              {t('errors.invalid')}
            </p>
          ) : null}
        </Card>
      </div>
    </Page>
  );
}
