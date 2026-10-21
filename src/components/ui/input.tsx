import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'border-border bg-card placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:ring-primary/15 h-11 w-full rounded-[14px] border-[1.5px] px-4 text-base font-medium transition-shadow outline-none focus-visible:ring-4',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
