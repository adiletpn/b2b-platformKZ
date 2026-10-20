'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** Окно печати открывается сразу: кассир выбирает чековый принтер в диалоге браузера. */
export function PrintButton({ label }: { label: string }) {
  useEffect(() => {
    window.print();
  }, []);
  return (
    <Button className="print:hidden" data-testid="receipt-print" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
