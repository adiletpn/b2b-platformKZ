import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import type { OnboardingProgress } from '@/lib/registration/onboarding';

const LINKS: Record<string, string> = {
  requisites: '/requisites',
  location: '/requisites',
  zone: '/requisites',
  catalog: '/catalog',
  employees: '/employees',
};

/** Мастер онбординга: подсказки и индикатор заполненности профиля (раздел 3.11 ТЗ). */
export async function OnboardingWizard({ progress }: { progress: OnboardingProgress }) {
  const t = await getTranslations('onboardingWizard');
  if (progress.steps.length === 0 || progress.percent === 100) return null;

  return (
    <Card className="mt-4" data-testid="onboarding-wizard">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm">{t('title')}</CardTitle>
        <span className="text-muted-foreground text-sm tabular-nums" data-testid="profile-percent">
          {t('filled', { percent: progress.percent })}
        </span>
      </div>

      <div className="bg-muted mt-2 h-2 overflow-hidden rounded-full">
        <div className="bg-primary h-full" style={{ width: `${progress.percent}%` }} />
      </div>

      <ul className="mt-3 space-y-2 text-sm" data-testid="onboarding-steps">
        {progress.steps.map((step) => (
          <li
            key={step.code}
            className="flex flex-wrap items-center justify-between gap-2"
            data-testid={`onboarding-step-${step.code}`}
          >
            <span className={step.done ? 'text-muted-foreground line-through' : ''}>
              {t(`steps.${step.code}`)}
            </span>
            {step.done ? (
              <span className="text-muted-foreground text-xs">{t('done')}</span>
            ) : (
              <Link
                href={LINKS[step.code] ?? '/dashboard'}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid={`onboarding-go-${step.code}`}
              >
                {t('go')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
