import * as React from 'react';
import { cn } from '@/lib/utils';
import { HydrationMark } from '@/components/hydration-mark';

/**
 * Общая рамка экрана по макету: на телефоне поля 20 px, на компьютере контент во всю
 * ширину с полями 28–32 px. `sm` и `md` — узкие формы (вход, реквизиты), им ширина ограничена.
 */
function Page({
  className,
  width = 'md',
  ...props
}: React.ComponentProps<'main'> & { width?: 'sm' | 'md' | 'lg' }) {
  const widths = { sm: 'lg:max-w-2xl', md: 'lg:max-w-5xl', lg: '' };
  return (
    <main
      className={cn('w-full px-5 pt-1.5 pb-6 lg:px-8 lg:pt-0 lg:pb-8', className)}
      data-page
      {...props}
    >
      <div className={cn('lg:mx-0', widths[width])}>{props.children}</div>
      <HydrationMark name="pageHydrated" />
    </main>
  );
}

/**
 * Заголовок экрана. На компьютере — верхняя полоса 80 px с нижней границей во всю ширину
 * (макет D01–D10), на телефоне — крупный заголовок 28/900 (макет M06, M07, M13).
 */
function PageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: React.ReactNode;
  /** Слева от заголовка: круглая кнопка «назад» на экранах деталей (макет M08, M09). */
  leading?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-border mb-4 flex flex-wrap items-center justify-between gap-3 pt-1.5 lg:-mx-8 lg:mb-6 lg:min-h-20 lg:border-b lg:px-8 lg:py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-black tracking-[-0.025em] break-words lg:text-2xl lg:tracking-[-0.02em]">
            {title}
          </h1>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-[13px] font-semibold break-words">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-border text-muted-foreground rounded-[20px] border-[1.5px] border-dashed px-4 py-10 text-center text-sm font-semibold">
      {children}
    </p>
  );
}

export { Page, PageHeader, EmptyState };
