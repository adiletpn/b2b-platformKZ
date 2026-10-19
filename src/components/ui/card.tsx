import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('border-border bg-card shadow-card rounded-xl border p-4 sm:p-5', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold', className)} {...props} />;
}

function CardHint({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground mt-1 text-xs', className)} {...props} />;
}

export { Card, CardTitle, CardHint };
