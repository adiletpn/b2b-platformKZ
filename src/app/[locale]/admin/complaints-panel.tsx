'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ComplaintRow } from '@/lib/chat/extras';

/** Модерация жалоб на сообщения чата (раздел 3.13 ТЗ): решение с комментарием. */
export function ComplaintsPanel({ initial }: { initial: ComplaintRow[] }) {
  const t = useTranslations('admin.complaints');
  const [rows, setRows] = useState(initial);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string) {
    const response = await fetch('/api/admin/complaints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, resolution: comments[id] ?? '' }),
    });
    const data = (await response.json()) as { status?: string };
    if (data.status !== 'ok') {
      setError(data.status === 'comment_required' ? 'comment_required' : 'unknown');
      return;
    }
    setError(null);
    setRows((current) => current.filter((row) => row.id !== id));
  }

  return (
    <Card data-testid="complaints-panel">
      <div className="flex items-start gap-3">
        <IconBadge icon={Flag} tone="danger" />
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardHint>{t('hint')}</CardHint>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm" data-testid="complaints-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-border mt-3 divide-y text-sm">
          {rows.map((row) => (
            <li key={row.id} className="space-y-2 py-3" data-testid="complaint-row">
              <p className="text-muted-foreground text-xs font-semibold">
                {t('meta', {
                  from: row.complainantName,
                  about: row.authorName,
                  date: row.createdAt,
                })}
              </p>
              <p className="bg-muted rounded-2xl px-3 py-2 break-words">{row.messageText}</p>
              <p className="break-words">
                <span className="text-muted-foreground">{t('reason')}: </span>
                {row.reason}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="h-9 min-w-0 flex-1"
                  placeholder={t('resolution')}
                  value={comments[row.id] ?? ''}
                  data-testid="complaint-resolution"
                  onChange={(event) => setComments({ ...comments, [row.id]: event.target.value })}
                />
                <Button
                  size="sm"
                  data-testid="complaint-resolve"
                  onClick={() => void resolve(row.id)}
                >
                  {t('resolve')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="text-danger mt-2 text-sm" role="alert">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </Card>
  );
}
