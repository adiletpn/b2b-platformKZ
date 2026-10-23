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
  /** Оспаривание отзыва (раздел 3.8 ТЗ). */
  dispute: 'none' | 'pending' | 'hidden' | 'kept';
};

const DISPUTE_ERRORS = ['reason_required', 'already_disputed', 'not_found'];

export function RatingReviews({ reviews }: { reviews: Review[] }) {
  const t = useTranslations('ratings');
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [disputeError, setDisputeError] = useState<string | null>(null);

  async function dispute(id: string) {
    setDisputeError(null);
    const response = await fetch(`/api/ratings/${id}/dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    const data = (await response.json()) as { status?: string };
    if (data.status !== 'ok') {
      setDisputeError(
        data.status && DISPUTE_ERRORS.includes(data.status) ? data.status : 'unknown',
      );
      return;
    }
    setDisputing(null);
    setReason('');
    router.refresh();
  }

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
      <h2 className="text-[15px] font-extrabold">{t('reviews')}</h2>

      {reviews.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm" data-testid="no-reviews">
          {t('noReviews')}
        </p>
      ) : (
        <ul className="mt-2 space-y-3" data-testid="reviews">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="border-border bg-card rounded-[14px] border-[1.5px] p-3.5 text-sm font-medium"
              data-testid={`review-${review.id}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-[13px] font-bold tabular-nums">{review.orderNumber}</span>
                <span className="font-medium tabular-nums">{review.score}</span>
              </div>
              {review.comment ? <p className="mt-1 break-words">{review.comment}</p> : null}
              {review.dispute !== 'none' ? (
                <p
                  className="text-muted-foreground mt-1 text-xs"
                  data-testid="review-dispute-state"
                >
                  {t(review.dispute === 'pending' ? 'disputed' : review.dispute)}
                </p>
              ) : disputing === review.id ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input
                    className="h-9 min-w-40 flex-1"
                    placeholder={t('disputePlaceholder')}
                    value={reason}
                    data-testid="review-dispute-reason"
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="review-dispute-send"
                    onClick={() => void dispute(review.id)}
                  >
                    {t('disputeSend')}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground mt-1 text-xs underline"
                  data-testid={`review-dispute-${review.id}`}
                  onClick={() => {
                    setDisputing(review.id);
                    setDisputeError(null);
                  }}
                >
                  {t('dispute')}
                </button>
              )}

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

      {disputeError ? (
        <p
          className="text-danger mt-2 text-sm font-semibold"
          role="alert"
          data-testid="dispute-error"
        >
          {t(`disputeErrors.${disputeError}` as 'disputeErrors.unknown')}
        </p>
      ) : null}
      {error ? (
        <p
          className="text-danger mt-2 text-sm font-semibold"
          role="alert"
          data-testid="reviews-error"
        >
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </section>
  );
}
