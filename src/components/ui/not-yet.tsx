import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Метка «Пока не добавлено» для элементов макета, которые ждут внешнего сервиса. */
export function NotYetBadge({ className }: { className?: string }) {
  const t = useTranslations('common');
  return (
    <span
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-bold whitespace-nowrap',
        className,
      )}
      data-testid="not-yet"
    >
      <Clock3 aria-hidden className="size-3" />
      {t('notYet')}
    </span>
  );
}

/** Кнопка из макета без работающего действия: видна, но выключена и подписана. */
export function NotYetButton({
  icon,
  children,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled
      className={cn(
        'border-border text-muted-foreground flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border-[1.5px] border-dashed px-5 text-sm font-extrabold',
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
      <NotYetBadge />
    </button>
  );
}

/** Блок макета, которого пока нет: заголовок, пояснение и метка. */
export function NotYetCard({
  icon,
  title,
  description,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border flex items-start gap-3 rounded-[20px] border-[1.5px] border-dashed p-4',
        className,
      )}
    >
      {icon ? (
        <span className="bg-muted text-muted-foreground grid size-11 shrink-0 place-items-center rounded-[14px]">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[15px] font-extrabold">{title}</p>
          <NotYetBadge />
        </div>
        {description ? (
          <p className="text-muted-foreground mt-1 text-[13px] font-medium">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
