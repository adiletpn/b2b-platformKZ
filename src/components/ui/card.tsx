import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('border-border bg-card shadow-card rounded-[20px] border p-4 sm:p-5', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-extrabold tracking-[-0.01em]', className)} {...props} />;
}

function CardHint({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground mt-1 text-xs font-semibold', className)} {...props} />;
}

const TONES = {
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-primary',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-muted text-foreground',
} as const;

/** Иконка в цветной плашке: заголовки карточек, показатели, пустые состояния. */
function IconBadge({
  icon: Icon,
  tone = 'primary',
  className,
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('grid size-11 shrink-0 place-items-center rounded-[14px]', TONES[tone], className)}
    >
      <Icon className="size-[20px]" />
    </span>
  );
}

/** Показатель кабинета: подпись, крупное число и пояснение. */
function StatCard({
  icon,
  tone,
  label,
  value,
  hint,
  className,
  ...props
}: {
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
} & Omit<React.ComponentProps<'section'>, 'children'>) {
  return (
    <Card
      className={cn('flex flex-col items-start gap-2 p-3.5 sm:flex-row sm:gap-3 sm:p-4', className)}
      {...props}
    >
      <IconBadge icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-bold">{label}</p>
        <p className="mt-0.5 text-xl font-black tracking-[-0.02em] tabular-nums sm:text-2xl">
          {value}
        </p>
        {hint ? <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p> : null}
      </div>
    </Card>
  );
}

export { Card, CardTitle, CardHint, IconBadge, StatCard };
