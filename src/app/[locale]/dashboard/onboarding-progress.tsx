import { getTranslations } from 'next-intl/server';
import { Check, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Progress } from '@/components/ui/controls';
import type { OnboardingProgress } from '@/lib/registration/onboarding';

const LINKS: Record<string, string> = {
  requisites: '/requisites',
  location: '/requisites',
  zone: '/requisites',
  catalog: '/catalog',
  employees: '/employees',
};

/**
 * Мастер онбординга (раздел 3.11 ТЗ) в виде блока макета M13: оранжевая подложка,
 * процент заполнения и чек-лист с кружками. Невыполненный шаг — ссылка на нужный экран.
 */
export async function OnboardingWizard({ progress }: { progress: OnboardingProgress }) {
  const t = await getTranslations('onboardingWizard');
  if (progress.steps.length === 0 || progress.percent === 100) return null;

  return (
    <section className="bg-primary-soft rounded-[22px] p-[18px]" data-testid="onboarding-wizard">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-extrabold">{t('titleShort')}</h2>
        <span
          className="text-primary-text text-[15px] font-black tabular-nums"
          data-testid="profile-percent"
          aria-label={t('filled', { percent: progress.percent })}
        >
          {progress.percent}%
        </span>
      </div>
      <Progress value={progress.percent} tone="primary" height={6} className="mt-3 bg-white/70" />

      <ul className="mt-3.5 space-y-2.5" data-testid="onboarding-steps">
        {progress.steps.map((step) => (
          <li key={step.code} data-testid={`onboarding-step-${step.code}`}>
            {step.done ? (
              <span className="flex items-center gap-2.5 text-sm font-semibold">
                <span className="bg-primary grid size-[22px] shrink-0 place-items-center rounded-full">
                  <Check aria-hidden className="size-3.5 text-white" strokeWidth={3} />
                </span>
                <span className="text-muted-foreground line-through">
                  {t(`steps.${step.code}`)}
                </span>
              </span>
            ) : (
              <Link
                href={LINKS[step.code] ?? '/dashboard'}
                className="group flex items-center gap-2.5 text-sm font-bold"
                data-testid={`onboarding-go-${step.code}`}
              >
                <span className="border-primary/60 size-[22px] shrink-0 rounded-full border-2" />
                <span className="flex-1">{t(`steps.${step.code}`)}</span>
                <ChevronRight
                  aria-hidden
                  className="text-primary size-4 opacity-60 group-hover:opacity-100"
                />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
