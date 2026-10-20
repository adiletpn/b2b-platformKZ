'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle, IconBadge } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { DisputedRatingRow } from '@/lib/ratings/rate';

/** Оспоренные отзывы (разделы 3.8 и 3.13 ТЗ): модератор скрывает отзыв или оставляет. */
export function RatingDisputesPanel({ initial }: { initial: DisputedRatingRow[] }) {
  const t = useTranslations('admin.ratingDisputes');
  const [rows, setRows] = useState(initial);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function resolve(id: string, decision: 'hide' | 'keep') {
    const response = await fetch('/api/admin/rating-disputes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, decision, resolution: comments[id] ?? '' }),
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
    <Card data-testid="rating-disputes-panel">
      <div className="flex items-start gap-3">
        <IconBadge icon={Star} tone="warning" />
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <CardHint>{t('hint')}</CardHint>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm" data-testid="rating-disputes-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="divide-border mt-3 divide-y text-sm">
          {rows.map((row) => (
            <li key={row.id} className="space-y-2 py-3" data-testid="rating-dispute-row">
              <p className="text-muted-foreground text-xs">
                {t('meta', {
                  author: row.authorName,
                  target: row.targetName,
                  number: row.orderNumber,
                  score: row.score,
                })}
              </p>
              {row.comment ? (
                <p className="bg-muted rounded-lg px-3 py-2 break-words">{row.comment}</p>
              ) : null}
              <p className="break-words">
                <span className="text-muted-foreground">{t('reason')}: </span>
                {row.reason}
              </p>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="h-9 min-w-0 flex-1"
                  placeholder={t('resolution')}
                  value={comments[row.id] ?? ''}
                  data-testid="rating-dispute-resolution"
                  onChange={(event) => setComments({ ...comments, [row.id]: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="rating-dispute-hide"
                  onClick={() => void resolve(row.id, 'hide')}
                >
                  {t('hide')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="rating-dispute-keep"
                  onClick={() => void resolve(row.id, 'keep')}
                >
                  {t('keep')}
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
