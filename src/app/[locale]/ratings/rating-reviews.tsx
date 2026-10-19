'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Review = {
  id: string;
  orderNumber: string;
  score: string;
  comment: string | null;
  reply: string | null;
};

export function RatingReviews({ reviews }: { reviews: Review[] }) {
  const t = useTranslations('ratings');
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function reply(id: string) {
    setError(null);
    const response = await fetch(`/api/ratings/${id}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reply: drafts[id] ?? '' }),
    });
    const data = (await response.json()) as { status?: string };
    if (data.status !== 'ok') {
      setError(data.status ?? 'unknown');
      return;
    }
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="text-muted-foreground text-sm font-medium">{t('reviews')}</h2>

      {reviews.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="no-reviews">
          {t('noReviews')}
        </p>
      ) : (
        <ul className="mt-2 space-y-3" data-testid="reviews">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="border-border bg-card rounded-lg border p-3 text-sm"
              data-testid={`review-${review.id}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-mono text-xs">{review.orderNumber}</span>
                <span className="font-medium tabular-nums">{review.score}</span>
              </div>
              {review.comment ? <p className="mt-1 break-words">{review.comment}</p> : null}

              {review.reply ? (
                <p className="text-muted-foreground mt-2 text-xs break-words">↳ {review.reply}</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    className="h-9 min-w-40 flex-1"
                    placeholder={t('replyPlaceholder')}
                    value={drafts[review.id] ?? ''}
                    data-testid={`reply-input-${review.id}`}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [review.id]: event.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`reply-send-${review.id}`}
                    onClick={() => void reply(review.id)}
                  >
                    {t('reply')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p className="mt-2 text-sm text-red-600" role="alert" data-testid="reviews-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </section>
  );
}
