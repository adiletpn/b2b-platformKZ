'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardHint, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { NotYetButton } from '@/components/ui/not-yet';
import { qrMatrix, qrPath } from '@/lib/qr/qr';
import { money } from '@/lib/format';

export type OnlinePayment = {
  provider: string;
  amount: string;
  payUrl: string;
  qrPayload: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
};

const PROVIDERS = ['kaspi', 'halyk', 'freedom'] as const;
const ERRORS = ['wrong_status', 'not_found', 'not_mock', 'invalid_provider', 'failed'];

/** QR рисуется прямо в разметке: модуль без зависимостей, тот же, что в печатных формах. */
function QrImage({ text, label }: { text: string; label: string }) {
  const modules = useMemo(() => qrMatrix(text), [text]);
  if (!modules) return null;
  const side = modules.length + 8;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      className="size-44 rounded-2xl border border-black/10 bg-white"
      data-testid="online-payment-qr"
    >
      <path fill="#000" d={qrPath(modules)} />
    </svg>
  );
}

/** Раздел 3.6 ТЗ: онлайн-оплата заявки ссылкой и QR через платёжный шлюз. */
export function OnlinePaymentPanel({
  orderId,
  initial,
  mockGateway,
}: {
  orderId: string;
  initial: OnlinePayment | null;
  mockGateway: boolean;
}) {
  const t = useTranslations('payment.online');
  const router = useRouter();
  const [payment, setPayment] = useState<OnlinePayment | null>(
    initial?.status === 'PENDING' ? initial : null,
  );
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('kaspi');
  const [error, setError] = useState<string | null>(initial?.status === 'FAILED' ? 'failed' : null);
  const [pending, setPending] = useState(false);

  async function start() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/orders/${orderId}/online-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    const data = (await response.json()) as {
      status: string;
      payUrl?: string;
      qrPayload?: string;
      amount?: string;
    };
    setPending(false);

    if (data.status !== 'ok' || !data.payUrl || !data.qrPayload) {
      setError(ERRORS.includes(data.status) ? data.status : 'unknown');
      return;
    }
    setPayment({
      provider,
      amount: data.amount ?? '',
      payUrl: data.payUrl,
      qrPayload: data.qrPayload,
      status: 'PENDING',
    });
  }

  async function payInMock() {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/orders/${orderId}/online-payment/mock-pay`, {
      method: 'POST',
    });
    const data = (await response.json()) as { status: string };
    setPending(false);

    if (data.status !== 'ok') {
      setError(ERRORS.includes(data.status) ? data.status : 'unknown');
      return;
    }
    router.refresh();
  }

  const tSoon = useTranslations('common.notYetItems');
  return (
    <Card className="mt-5" data-testid="online-payment">
      <CardTitle>{t('title')}</CardTitle>
      <CardHint>{t('hint')}</CardHint>

      {payment ? (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          <QrImage text={payment.qrPayload} label={t('qr')} />
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <p>
              {t('provider')}:{' '}
              <span className="font-medium">
                {t(`providers.${payment.provider}` as 'providers.kaspi')}
              </span>
            </p>
            <p data-testid="online-payment-amount">
              {t('amount', { amount: money(payment.amount) })}
            </p>
            <p className="text-muted-foreground text-xs">{t('qr')}</p>
            <a
              href={payment.payUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary block font-mono text-xs break-all underline"
              data-testid="online-payment-link"
            >
              {payment.payUrl}
            </a>
            <NotYetButton className="sm:w-auto">{tSoon('bankApp')}</NotYetButton>
            <p className="text-muted-foreground text-xs">{t('waiting')}</p>
            {mockGateway ? (
              <div className="border-border rounded-2xl border-[1.5px] border-dashed p-3">
                <p className="text-muted-foreground text-xs">{t('mockHint')}</p>
                <Button
                  className="mt-2"
                  size="sm"
                  disabled={pending}
                  data-testid="online-payment-mock-pay"
                  onClick={() => void payInMock()}
                >
                  {t('mockPay')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <Field label={t('provider')}>
              <select
                className="border-border bg-card h-11 w-full rounded-[14px] border-[1.5px] px-3.5 font-medium"
                value={provider}
                data-testid="online-payment-provider"
                onChange={(event) => setProvider(event.target.value as typeof provider)}
              >
                {PROVIDERS.map((item) => (
                  <option key={item} value={item}>
                    {t(`providers.${item}`)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button
            disabled={pending}
            data-testid="online-payment-start"
            onClick={() => void start()}
          >
            {pending ? t('starting') : t('start')}
          </Button>
        </div>
      )}

      {error ? (
        <p className="text-danger mt-3 text-sm" role="alert" data-testid="online-payment-error">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </Card>
  );
}
