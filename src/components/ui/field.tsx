import * as React from 'react';
import { cn } from '@/lib/utils';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function DemoHint({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="border-primary/50 bg-primary/5 rounded-lg border border-dashed p-3 text-sm"
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
        'rounded-lg border p-3 text-sm',
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
