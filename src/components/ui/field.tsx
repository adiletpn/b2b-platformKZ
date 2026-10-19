import * as React from 'react';

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
