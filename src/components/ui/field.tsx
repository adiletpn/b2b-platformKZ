import * as React from 'react';
import { cn } from '@/lib/utils';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-muted-foreground mb-2 block text-[13px] font-bold">{label}</span>
      {children}
    </label>
  );
}

export function DemoHint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="border-primary/50 bg-primary-soft/50 rounded-2xl border-[1.5px] border-dashed p-3.5 text-sm"
      data-testid="demo-hint"
    >
      <p className="font-medium">{title}</p>
      <div className="text-muted-foreground mt-1">{children}</div>
    </div>
  );
}

/** Пояснение в форме: что произошло и что делать дальше. */
export function Notice({
  tone = 'info',
  className,
  children,
  ...props
}: { tone?: 'info' | 'warning' } & React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-3.5 text-sm',
        tone === 'warning'
          ? 'border-warning/40 bg-warning-soft'
          : 'border-primary/30 bg-primary-soft',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
