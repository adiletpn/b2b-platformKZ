import * as React from 'react';
import { cn } from '@/lib/utils';

/** Общая рамка экрана: одинаковые поля и ширина на всех страницах. */
function Page({
  className,
  width = 'md',
  ...props
}: React.ComponentProps<'main'> & { width?: 'sm' | 'md' | 'lg' }) {
  const widths = { sm: 'max-w-xl', md: 'max-w-3xl', lg: 'max-w-5xl' };
  return (
    <main
      className={cn('mx-auto w-full px-4 py-6 sm:px-6 sm:py-8', widths[width], className)}
      {...props}
    />
  );
}

function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-black tracking-[-0.025em] break-words lg:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm font-semibold break-words">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
