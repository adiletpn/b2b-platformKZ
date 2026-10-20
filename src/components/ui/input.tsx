import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'border-border bg-card focus-visible:border-primary focus-visible:ring-primary/15 h-11 w-full rounded-lg border px-3 text-base transition-shadow outline-none focus-visible:ring-4',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
