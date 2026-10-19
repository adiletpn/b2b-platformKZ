import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { getCompanyRating } from '@/lib/ratings/metrics';
import { prisma } from '@/lib/prisma';
import { buttonVariants } from '@/components/ui/button';
import { RatingReviews } from './rating-reviews';
import { Page } from '@/components/ui/page';

export default async function RatingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const companyId = active!.companyId;
  const [rating, reviews] = await Promise.all([
    getCompanyRating(companyId),
    prisma.rating.findMany({
      where: { targetCompanyId: companyId },
      include: { order: { select: { number: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const t = await getTranslations('ratings');
  const tDashboard = await getTranslations('dashboard');

  return (
    <Page width="md">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {tDashboard('title')}
        </Link>
      </header>

      <section className="border-border bg-card shadow-card mt-5 rounded-xl border p-4 sm:p-5">
        <h2 className="text-sm font-medium">{t('myRating')}</h2>
        <p className="mt-2 text-3xl font-semibold tabular-nums" data-testid="manual-score">
          {rating.manualScore ?? t('noScore')}
        </p>
        <p className="text-muted-foreground mt-1 text-sm" data-testid="ratings-count">
          {t('ratingsCount', { count: rating.ratingsCount })}
        </p>
        {rating.fewRatings ? (
          <p
            className="bg-muted mt-2 inline-block rounded px-2 py-1 text-xs"
            data-testid="few-ratings"
          >
            {t('fewRatings')}
          </p>
        ) : null}
      </section>

      <section className="border-border bg-card shadow-card mt-4 rounded-xl border p-4 sm:p-5">
        <h2 className="text-sm font-medium">{t('autoTitle')}</h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('autoHint')}</p>

        <dl className="mt-3 space-y-1 text-sm">
          {rating.supplier ? (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('fulfilledShare')}</dt>
                <dd className="tabular-nums" data-testid="metric-fulfilled">
                  {rating.supplier.fulfilledShare}%
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('onTimeShare')}</dt>
                <dd className="tabular-nums">{rating.supplier.onTimeShare}%</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('discrepancyShare')}</dt>
                <dd className="tabular-nums">{rating.supplier.discrepancyShare}%</dd>
              </div>
            </>
          ) : null}

          {rating.store ? (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('paymentDiscipline')}</dt>
                <dd data-testid="payment-discipline">
                  {t(`discipline.${rating.store.discipline}`)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('averageDelay')}</dt>
                <dd className="tabular-nums">{rating.store.averagePaymentDelayDays}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('cancelledShare')}</dt>
                <dd className="tabular-nums">{rating.store.cancelledShare}%</dd>
              </div>
            </>
          ) : null}
        </dl>
      </section>

      <RatingReviews
        reviews={reviews.map((review) => ({
          id: review.id,
          orderNumber: review.order.number,
          score: review.score.toFixed(2),
          comment: review.comment,
          reply: review.reply,
        }))}
      />
    </Page>
  );
}
