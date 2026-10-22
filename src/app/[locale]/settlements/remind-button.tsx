'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** «Напомнить» магазину о просрочке (макет D06). Повтор — не раньше чем через сутки. */
export function RemindButton({ storeId }: { storeId: string }) {
  const t = useTranslations('settlements');
  const [state, setState] = useState<'idle' | 'pending' | 'sent' | 'too_soon' | 'failed'>('idle');

  async function remind() {
    setState('pending');
    const response = await fetch('/api/settlements/remind', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storeId }),
    });
    const data = (await response.json().catch(() => ({}))) as { status?: string };
    setState(data.status === 'sent' ? 'sent' : data.status === 'too_soon' ? 'too_soon' : 'failed');
  }

  if (state === 'sent' || state === 'too_soon') {
    return (
      <span
        className="text-muted-foreground inline-flex items-center gap-1.5 text-[13px] font-bold"
        data-testid={`remind-done-${storeId}`}
      >
        <Check aria-hidden className="size-4" />
        {t(state === 'sent' ? 'reminded' : 'remindedRecently')}
      </span>
    );
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={state === 'pending'}
      data-testid={`remind-${storeId}`}
      onClick={() => void remind()}
    >
      <Bell aria-hidden />
      {t('remind')}
    </Button>
  );
}
