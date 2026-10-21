import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Кнопки по макету Arbafind: «пилюли», основная — оранжевый градиент с тенью. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full text-sm font-extrabold whitespace-nowrap transition-[background-color,box-shadow,opacity,filter,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-cta text-white shadow-cta hover:brightness-[0.96]',
        secondary: 'bg-muted text-foreground hover:brightness-[0.96]',
        outline: 'border-[1.5px] border-border bg-card text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        danger: 'border-[1.5px] border-danger/30 bg-card text-danger hover:bg-danger-soft',
        accent: 'bg-card text-primary-text shadow-cta hover:brightness-[0.97]',
        dark: 'bg-foreground text-background hover:brightness-110',
        success: 'bg-success text-white hover:brightness-[0.96]',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-9 px-4 text-[13px] [&_svg]:size-4',
        lg: 'h-[54px] px-6 text-base',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
