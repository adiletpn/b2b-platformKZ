'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, CheckCircle2, FileText, MapPin, Phone, Truck } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, IconBadge } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { OrderStatusBadge } from '@/components/order-status-badge';
import type { DeliveryRow } from '@/lib/deliveries/deliveries';

/**
 * Приложение водителя (разделы 1.2 и 3.5 ТЗ): куда везти, накладная в PDF,
 * отметка «доставлено» и фото подписанной бумажной накладной. Крупные кнопки — под палец.
 */
export function DeliveriesScreen({
  locale,
  title,
  initial,
  canUpdate,
}: {
  locale: 'ru' | 'kk';
  title: string;
  initial: DeliveryRow[];
  canUpdate: boolean;
}) {
  const t = useTranslations('deliveries');
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ orderId: string; key: string } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function delivered(orderId: string) {
    setPending(orderId);
    const response = await fetch(`/api/deliveries/${orderId}/delivered`, { method: 'POST' });
    setPending(null);
    setMessage({ orderId, key: response.ok ? 'delivered' : 'error' });
    router.refresh();
  }

  async function photo(orderId: string, file: File) {
    setPending(orderId);
    const form = new FormData();
    form.set('file', file);
    form.set('idempotencyKey', crypto.randomUUID());
    const response = await fetch(`/api/deliveries/${orderId}/photo`, {
      method: 'POST',
      body: form,
    });
    setPending(null);
    setMessage({ orderId, key: response.ok ? 'photoSaved' : 'photoError' });
    router.refresh();
  }

  return (
    <Page>
      <PageHeader title={title} description={t('subtitle')} />
      {initial.length === 0 ? (
        <EmptyState>
          <span data-testid="deliveries-empty">{t('empty')}</span>
        </EmptyState>
      ) : (
        <ul className="space-y-3" data-testid="deliveries-list">
          {initial.map((row) => (
            <li key={row.orderId}>
              <Card className="space-y-3" data-testid={`delivery-${row.number}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <IconBadge icon={Truck} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs">{row.number}</p>
                    <p className="font-semibold break-words">{row.storeName}</p>
                  </div>
                  <OrderStatusBadge status={row.status} testId="delivery-status" />
                </div>
                <div className="text-muted-foreground space-y-1 text-sm">
                  <p className="flex items-start gap-2">
                    <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span className="break-words">{row.address}</span>
                  </p>
                  {row.storePhone ? (
                    <a
                      href={`tel:${row.storePhone}`}
                      className="text-primary flex items-center gap-2"
                    >
                      <Phone aria-hidden className="size-4" />
                      {row.storePhone}
                    </a>
                  ) : null}
                  <p>
                    {t('total', { total: row.total })}
                    {row.deliveryDate ? ` · ${t('date', { date: row.deliveryDate })}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.waybillId ? (
                    <a
                      href={`/api/deliveries/${row.orderId}/waybill?locale=${locale}`}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({ variant: 'outline' })}
                      data-testid="delivery-waybill"
                    >
                      <FileText aria-hidden />
                      {t('waybill')}
                    </a>
                  ) : null}
                  {canUpdate && row.status === 'SHIPPED' ? (
                    <Button
                      disabled={pending === row.orderId}
                      data-testid="delivery-done"
                      onClick={() => void delivered(row.orderId)}
                    >
                      <CheckCircle2 aria-hidden />
                      {t('markDelivered')}
                    </Button>
                  ) : null}
                  {canUpdate ? (
                    <>
                      <input
                        ref={(element) => {
                          inputs.current[row.orderId] = element;
                        }}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        data-testid="delivery-photo-input"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void photo(row.orderId, file);
                        }}
                      />
                      <Button
                        variant="secondary"
                        disabled={pending === row.orderId}
                        data-testid="delivery-photo"
                        onClick={() => inputs.current[row.orderId]?.click()}
                      >
                        <Camera aria-hidden />
                        {row.photos > 0 ? t('photoMore', { count: row.photos }) : t('photo')}
                      </Button>
                    </>
                  ) : null}
                </div>
                {message?.orderId === row.orderId ? (
                  <p className="text-sm" role="status" data-testid="delivery-message">
                    {t(`messages.${message.key}` as 'messages.delivered')}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
