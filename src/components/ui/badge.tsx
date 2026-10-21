import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs leading-none font-bold whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-foreground',
        info: 'bg-accent-soft text-accent',
        success: 'bg-success-soft text-success',
        warning: 'bg-primary-soft text-primary-text',
        danger: 'bg-danger-soft text-danger',
        solid: 'bg-primary text-white',
        dark: 'bg-foreground text-background',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}

export { Badge, badgeVariants };
